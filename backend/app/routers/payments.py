"""Getting paid: Viva Wallet card payments on invoices, and automatic payment reminders.

Viva Wallet Smart Checkout: we create a payment order for the invoice amount, send the
client to Viva's hosted page, and when Viva redirects back with a transaction id we
verify it server-side (status, order code and amount) before marking the invoice paid.
Credentials belong to each business (money goes to their own Viva account).
"""
import base64
import uuid
from datetime import date
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.auth import Ctx, get_ctx, require_role
from app.common import esc, money
from app.db import get_db, now, today
from app.mailer import layout, send
from app.notify import notify
from app.ratelimit import rate_limit
from app.routers.business import get_business
from app.routers.mydata import _cipher

router = APIRouter(tags=["payments"])

VIVA_HOSTS = {
    "demo": {"accounts": "https://demo-accounts.vivapayments.com", "api": "https://demo-api.vivapayments.com", "checkout": "https://demo.vivapayments.com"},
    "live": {"accounts": "https://accounts.vivapayments.com", "api": "https://api.vivapayments.com", "checkout": "https://www.vivapayments.com"},
}


# ------------------------------------------------------------------ settings

class VivaInput(BaseModel):
    enabled: bool = False
    environment: str = "demo"
    client_id: Optional[str] = ""
    client_secret: Optional[str] = None  # None = keep
    source_code: Optional[str] = ""


async def _viva(org_id: str) -> dict:
    return await get_db().viva_settings.find_one({"org_id": org_id}, {"_id": 0}) or {}


def _public_viva(v: dict) -> dict:
    return {"enabled": bool(v.get("enabled")), "environment": v.get("environment", "demo"), "client_id": v.get("client_id", ""),
            "source_code": v.get("source_code", ""), "has_secret": bool(v.get("client_secret_enc")),
            "return_url": f"{config.PUBLIC_URL}/i/paid"}


@router.get("/payments/viva")
async def read_viva(ctx: Ctx = Depends(get_ctx)):
    return _public_viva(await _viva(ctx.org_id))


@router.put("/payments/viva")
async def save_viva(data: VivaInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    env = data.environment if data.environment in VIVA_HOSTS else "demo"
    sets = {"enabled": data.enabled, "environment": env, "client_id": (data.client_id or "").strip(), "source_code": (data.source_code or "").strip(), "updated_at": now()}
    if data.client_secret is not None:
        sets["client_secret_enc"] = (await _cipher()).encrypt(data.client_secret.strip().encode()).decode() if data.client_secret.strip() else ""
    merged = {**await _viva(ctx.org_id), **sets}
    if data.enabled and not (merged.get("client_id") and merged.get("client_secret_enc") and merged.get("source_code")):
        raise HTTPException(status_code=400, detail="Add the Viva client ID, client secret and payment source code to turn card payments on")
    await get_db().viva_settings.update_one({"org_id": ctx.org_id}, {"$set": sets}, upsert=True)
    return _public_viva(await _viva(ctx.org_id))


# ------------------------------------------------------------------ Viva API

async def _viva_token(v: dict) -> str:
    secret = (await _cipher()).decrypt(v["client_secret_enc"].encode()).decode()
    basic = base64.b64encode(f"{v['client_id']}:{secret}".encode()).decode()
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{VIVA_HOSTS[v['environment']]['accounts']}/connect/token", data={"grant_type": "client_credentials"},
                         headers={"Authorization": f"Basic {basic}"})
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Card payments are temporarily unavailable (payment provider login failed)")
    return r.json()["access_token"]


async def viva_create_order(v: dict, amount_cents: int, description: str, reference: str, email: str, name: str) -> str:
    token = await _viva_token(v)
    body = {"amount": amount_cents, "customerTrns": description[:2048], "merchantTrns": reference, "sourceCode": v["source_code"],
            "customer": {"email": email or None, "fullName": name or None, "requestLang": "el-GR"}, "paymentTimeout": 1800}
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.post(f"{VIVA_HOSTS[v['environment']]['api']}/checkout/v2/orders", json=body, headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200 or "orderCode" not in r.json():
        raise HTTPException(status_code=502, detail="Couldn't start the card payment — please try again")
    return str(r.json()["orderCode"])


async def viva_get_transaction(v: dict, transaction_id: str) -> dict:
    token = await _viva_token(v)
    async with httpx.AsyncClient(timeout=20) as c:
        r = await c.get(f"{VIVA_HOSTS[v['environment']]['api']}/checkout/v2/transactions/{transaction_id}", headers={"Authorization": f"Bearer {token}"})
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail="Couldn't confirm the payment yet — refresh in a minute")
    return r.json()


# ------------------------------------------------------------------ public payment flow

async def _payable(token: str) -> tuple:
    inv = await get_db().invoices.find_one({"public_token": token}, {"_id": 0})
    if not inv or inv.get("status") == "draft" or inv.get("kind") == "credit_note":
        raise HTTPException(status_code=404, detail="Invoice not found")
    v = await _viva(inv["org_id"])
    return inv, v


@router.get("/public/invoices/{token}/payment-options")
async def payment_options(token: str):
    inv, v = await _payable(token)
    return {"card": bool(v.get("enabled")) and inv.get("currency", "EUR") == "EUR" and inv.get("status") != "paid"}


@router.post("/public/invoices/{token}/pay")
async def start_payment(token: str, request: Request):
    rate_limit(request, "viva-pay", 30)
    inv, v = await _payable(token)
    if inv.get("status") == "paid":
        raise HTTPException(status_code=409, detail="This invoice is already paid")
    if not v.get("enabled"):
        raise HTTPException(status_code=400, detail="Card payments aren't available for this invoice")
    if inv.get("currency", "EUR") != "EUR":
        raise HTTPException(status_code=400, detail="Card payments are available for euro invoices only")
    cents = int(round(inv["total"] * 100))
    biz = await get_business(inv["org_id"])
    order = await viva_create_order(v, cents, f"{biz.get('business_name', '')} — {inv['number']}", inv["id"], inv.get("client_email", ""), inv.get("client_name", ""))
    await get_db().payment_attempts.insert_one({"id": str(uuid.uuid4()), "org_id": inv["org_id"], "invoice_id": inv["id"], "token": token,
                                                "order_code": order, "amount_cents": cents, "provider": "viva", "environment": v["environment"],
                                                "status": "started", "created_at": now()})
    return {"redirect_url": f"{VIVA_HOSTS[v['environment']]['checkout']}/web/checkout?ref={order}"}


class ConfirmInput(BaseModel):
    t: str
    s: str


@router.post("/public/payments/viva/confirm")
async def confirm_payment(data: ConfirmInput, request: Request):
    """Viva redirects the client to /i/paid?t=<transactionId>&s=<orderCode>; we verify with Viva before believing it."""
    rate_limit(request, "viva-confirm", 60)
    d = get_db()
    attempt = await d.payment_attempts.find_one({"order_code": data.s}, {"_id": 0})
    if not attempt:
        raise HTTPException(status_code=404, detail="Payment not found")
    inv = await d.invoices.find_one({"id": attempt["invoice_id"]}, {"_id": 0})
    if attempt["status"] == "paid" or (inv or {}).get("status") == "paid":
        return {"status": "paid", "token": attempt["token"]}
    v = await _viva(attempt["org_id"])
    tx = await viva_get_transaction(v, data.t)
    ok = (str(tx.get("statusId")) == "F" and str(tx.get("orderCode")) == attempt["order_code"]
          and int(round(float(tx.get("amount", 0)) * 100)) >= attempt["amount_cents"])
    if not ok:
        await d.payment_attempts.update_one({"order_code": data.s}, {"$set": {"status": "failed", "transaction_id": data.t, "checked_at": now()}})
        return {"status": "not_paid", "token": attempt["token"]}
    await d.payment_attempts.update_one({"order_code": data.s}, {"$set": {"status": "paid", "transaction_id": data.t, "paid_at": now()}})
    await d.invoices.update_one({"id": inv["id"]}, {"$set": {"status": "paid", "paid_at": now(), "paid_via": "viva", "updated_at": now()}})
    await notify(inv["org_id"], "payment", f"{inv.get('client_name')} paid {inv['number']} by card ({money(inv['total'])})", "/app/invoices?filter=paid")
    return {"status": "paid", "token": attempt["token"]}


# ------------------------------------------------------------------ payment reminders

class ReminderSettings(BaseModel):
    enabled: bool = False
    days: List[int] = [3, 10, 21]
    message: Optional[str] = ""


async def reminder_settings(org_id: str) -> dict:
    doc = await get_db().reminder_settings.find_one({"org_id": org_id}, {"_id": 0}) or {}
    return {"enabled": doc.get("enabled", False), "days": doc.get("days", [3, 10, 21]), "message": doc.get("message", "")}


@router.get("/payments/reminders")
async def read_reminders(ctx: Ctx = Depends(get_ctx)):
    return await reminder_settings(ctx.org_id)


@router.put("/payments/reminders")
async def save_reminders(data: ReminderSettings, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    days = sorted({d for d in data.days if 0 <= d <= 120})[:5]
    if data.enabled and not days:
        raise HTTPException(status_code=400, detail="Add at least one reminder day")
    await get_db().reminder_settings.update_one({"org_id": ctx.org_id}, {"$set": {"enabled": data.enabled, "days": days,
                                                                                 "message": (data.message or "").strip()[:600]}}, upsert=True)
    return await reminder_settings(ctx.org_id)


async def _send_reminder(inv: dict, days_late: int, custom: str = "") -> bool:
    from app.routers.invoices import _ensure_token
    biz = await get_business(inv["org_id"])
    url = f"{config.PUBLIC_URL}/i/{await _ensure_token(inv)}"
    when = f"was due on {inv['due_date']}" if inv.get("due_date") else "is still open"
    body = (f'<p style="color:#3A4358;font-size:14px;">Hello {esc(inv.get("client_name"))},</p>'
            f'<p style="color:#3A4358;font-size:14px;">A friendly reminder that invoice <b>{esc(inv["number"])}</b> for <b>{money(inv["total"], inv.get("currency"))}</b> {when}.'
            " If you've already paid, thank you — please ignore this email.</p>"
            + (f'<p style="color:#3A4358;font-size:14px;">{esc(custom)}</p>' if custom else ""))
    return await send(inv["client_email"], f"Reminder: invoice {inv['number']} — {biz.get('business_name', '')}",
                      layout("Payment reminder", body, "View and pay", url, biz.get("business_name", "")), biz.get("business_email", ""))


@router.post("/invoices/{invoice_id}/remind")
async def remind_now(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    inv = await d.invoices.find_one({"id": invoice_id, "org_id": ctx.org_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    if inv.get("status") not in ("sent", "overdue"):
        raise HTTPException(status_code=400, detail="Only unpaid invoices get reminders")
    if not inv.get("client_email"):
        raise HTTPException(status_code=400, detail="Add the client's email first")
    s = await reminder_settings(ctx.org_id)
    emailed = await _send_reminder(inv, 0, s["message"])
    await d.invoices.update_one({"id": invoice_id}, {"$push": {"reminders": {"at": now(), "manual": True, "emailed": emailed}}})
    return {"emailed": emailed}


async def send_due_reminders(today_iso: Optional[str] = None) -> int:
    """Scheduler: for each business with reminders on, email overdue clients once per configured day."""
    d = get_db()
    today_d = date.fromisoformat(today_iso or today())
    count = 0
    async for st in d.reminder_settings.find({"enabled": True}, {"_id": 0}):
        open_invoices = await d.invoices.find({"org_id": st["org_id"], "status": {"$in": ["sent", "overdue"]}, "kind": {"$ne": "credit_note"},
                                               "due_date": {"$ne": None, "$lt": today_d.isoformat()}, "client_email": {"$nin": ["", None]}}, {"_id": 0}).to_list(2000)
        for inv in open_invoices:
            late = (today_d - date.fromisoformat(inv["due_date"])).days
            done = {r.get("day") for r in inv.get("reminders", []) if not r.get("manual")}
            due = [x for x in st.get("days", []) if x <= late and x not in done]
            if not due:
                continue
            # one email even if several reminder days were missed (catch-up)
            emailed = await _send_reminder(inv, late, st.get("message", ""))
            await d.invoices.update_one({"id": inv["id"]}, {"$push": {"reminders": {"$each": [{"day": x, "at": now(), "emailed": emailed} for x in due]}}})
            count += 1
    return count
