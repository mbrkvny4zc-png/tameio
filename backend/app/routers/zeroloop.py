"""Zeroloop connector: clears invoices that cancel out between businesses.

Tameio is a client of Zeroloop's Connector API (see Zeroloop's docs/connector-api.md):

1. Connect: the owner approves on Zeroloop (OAuth-style). We keep an encrypted
   connection token per business.
2. Sync: we send only OPEN B2B items: unpaid invoices to clients with an ΑΦΜ,
   and unpaid expenses from suppliers with an ΑΦΜ. Counterparty, number, myDATA
   ΜΑΡΚ, dates and open amount. Never lines, products or the rest of the books.
3. Set-offs: when Zeroloop clears an item, it sends a signed event (and we also
   pull, as a fallback). We book it as a payment with method "set_off"
   (συμψηφισμός), so balances, client statements and exports stay right.

Disabled unless ZEROLOOP_URL, ZEROLOOP_CLIENT_ID, ZEROLOOP_CLIENT_SECRET and
ZEROLOOP_WEBHOOK_SECRET are set.
"""
import hashlib
import hmac
import re
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now, today
from app.routers.business import get_business
from app.routers.mydata import _cipher

router = APIRouter(tags=["zeroloop"])

TIMEOUT = 20


def enabled() -> bool:
    return bool(config.ZEROLOOP_URL and config.ZEROLOOP_CLIENT_ID and config.ZEROLOOP_CLIENT_SECRET and config.ZEROLOOP_WEBHOOK_SECRET)


def _redirect_uri() -> str:
    return f"{config.PUBLIC_URL}/api/zeroloop/callback"


async def _http(method: str, path: str, token: Optional[str] = None, json=None, form=None) -> dict:
    """One call to Zeroloop. Tests replace this function."""
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    async with httpx.AsyncClient(timeout=TIMEOUT) as c:
        r = await c.request(method, config.ZEROLOOP_URL.rstrip("/") + path, headers=headers, json=json, data=form)
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400:
        raise HTTPException(status_code=502 if r.status_code >= 500 else 400, detail=f"Zeroloop: {data.get('error') or r.status_code}")
    return data


async def _token(org_id: str) -> Optional[str]:
    doc = await get_db().zeroloop.find_one({"org_id": org_id}, {"_id": 0, "token_enc": 1})
    if not doc or not doc.get("token_enc"):
        return None
    return (await _cipher()).decrypt(doc["token_enc"].encode()).decode()


# ------------------------------------------------------------------ open items

def _afm_or_vat(afm: str, country: str = "GR") -> str:
    a = gt.normalize_afm(afm or "")
    if not a:
        return ""
    return a if (country or "GR").upper() in ("GR", "EL", "") else f"{country.upper()}{a}"


def _zeroloop_settled(payments: list) -> float:
    return round(sum(p["amount"] for p in payments or [] if p.get("source") == "zeroloop"), 2)


async def open_items(org_id: str) -> list:
    """Everything still unpaid between this business and other businesses (with a ΑΦΜ)."""
    d = get_db()
    items = []
    for inv in await d.invoices.find({"org_id": org_id, "kind": {"$in": ["invoice", None]}, "status": {"$in": ["sent", "overdue"]}}, {"_id": 0}).to_list(20000):
        md = inv.get("mydata") or {}
        if md.get("state") == "cancelled":
            continue
        vat = _afm_or_vat(inv.get("client_afm"), inv.get("client_country") or "GR")
        total = round(inv.get("total") or 0, 2)
        paid = round(sum(p["amount"] for p in inv.get("payments") or []), 2)
        open_ = round(max(0, total - paid), 2)
        if not vat or total <= 0 or open_ <= 0:
            continue
        items.append({
            "external_id": f"inv:{inv['id']}", "direction": "receivable", "counterparty_vat": vat,
            "counterparty_name": inv.get("client_company") or inv.get("client_name") or "",
            "number": inv.get("number"), "mark": md.get("mark") if md.get("state") == "transmitted" else None,
            "currency": inv.get("currency") or "EUR", "issue_date": (inv.get("issue_date") or "")[:10] or None,
            "due_date": (inv.get("due_date") or "")[:10] or None, "amount": total, "open": open_,
            "zeroloop_settled": _zeroloop_settled(inv.get("payments")),
        })
    for e in await d.expenses.find({"org_id": org_id, "payment_status": "unpaid"}, {"_id": 0}).to_list(20000):
        vat = _afm_or_vat(e.get("vendor_afm"))
        total = round(e.get("total") or 0, 2)
        settled = round(sum(s["amount"] for s in e.get("zeroloop_setoffs") or []), 2)
        open_ = round(max(0, total - settled), 2)
        if not vat or total <= 0 or open_ <= 0:
            continue
        items.append({
            "external_id": f"exp:{e['id']}", "direction": "payable", "counterparty_vat": vat, "counterparty_name": e.get("vendor_name") or "",
            "number": e.get("document_number") or e.get("number"), "mark": e.get("mark") or None, "currency": e.get("currency") or "EUR",
            "issue_date": (e.get("date") or "")[:10] or None, "due_date": None, "amount": total, "open": open_, "zeroloop_settled": settled,
        })
    return items


# ------------------------------------------------------------------ set-offs → payments

async def apply_setoff(org_id: str, external_id: str, amount: float, setoff_id: int, proposal_id: str, kind: str,
                       settled_by: str = "set_off", reference: str = "") -> bool:
    """Book one Zeroloop settlement on an invoice or expense. Idempotent per setoff_id.

    settled_by "set_off": a set-off (συμψηφισμός). settled_by "payment": in a missing link, this
    business's own bill or invoice was settled by the bank transfer between payer and payee."""
    from app.routers.invoices import _apply_payments  # avoid a circular import at load time
    d = get_db()
    amount = round(float(amount), 2)
    cash = settled_by == "payment"
    method = "bank_transfer" if cash else "set_off"
    what = "missing link" if kind == "chain" else "clearing"
    note = (f"Zeroloop {what} {reference or proposal_id}: paid directly by bank transfer" if cash else f"Zeroloop {what} {proposal_id}")
    if external_id.startswith("inv:"):
        inv = await d.invoices.find_one({"org_id": org_id, "id": external_id[4:]}, {"_id": 0})
        if not inv or any(p.get("setoff_id") == setoff_id for p in inv.get("payments") or []):
            return False
        owed = round((inv.get("total") or 0) - sum(p["amount"] for p in inv.get("payments") or []), 2)
        amt = min(amount, max(owed, 0))
        if amt <= 0:
            return False
        pay = {"id": str(uuid.uuid4()), "amount": amt, "date": today(), "method": method, "note": note, "source": "zeroloop",
               "setoff_id": setoff_id, "proposal_id": proposal_id, "recorded_by": "zeroloop", "created_at": now()}
        await d.invoices.update_one({"id": inv["id"]}, {"$push": {"payments": pay}})
        await _apply_payments(await d.invoices.find_one({"id": inv["id"]}, {"_id": 0}))
        return True
    if external_id.startswith("exp:"):
        e = await d.expenses.find_one({"org_id": org_id, "id": external_id[4:]}, {"_id": 0})
        if not e or any(s.get("setoff_id") == setoff_id for s in e.get("zeroloop_setoffs") or []):
            return False
        entry = {"setoff_id": setoff_id, "amount": amount, "date": today(), "proposal_id": proposal_id, "kind": kind, "settled_by": settled_by, "created_at": now()}
        settled = round(sum(s["amount"] for s in e.get("zeroloop_setoffs") or []) + amount, 2)
        sets = {"updated_at": now()}
        if settled >= round(e.get("total") or 0, 2) - 0.005:
            sets.update({"payment_status": "paid", "payment_method": "bank_transfer" if cash else "set_off"})
        await d.expenses.update_one({"id": e["id"]}, {"$push": {"zeroloop_setoffs": entry}, "$set": sets})
        return True
    return False


async def pull_setoffs(org_id: str) -> int:
    doc = await get_db().zeroloop.find_one({"org_id": org_id}, {"_id": 0})
    token = await _token(org_id)
    if not doc or not token:
        return 0
    since = doc.get("last_setoff_id") or 0
    data = await _http("GET", f"/api/connect/v1/setoffs?since={since}", token)
    n = 0
    top = since
    for s in data.get("setoffs") or []:
        if await apply_setoff(org_id, s["external_id"], s["amount"], s["setoff_id"], s["proposal_id"], s.get("kind") or "loop",
                              s.get("settled_by") or "set_off", s.get("reference") or ""):
            n += 1
        top = max(top, s["setoff_id"])
    if top != since:
        await get_db().zeroloop.update_one({"org_id": org_id}, {"$set": {"last_setoff_id": top}})
    return n


async def sync_org(org_id: str) -> dict:
    """Book any set-offs we haven't seen, then send a full snapshot of open items."""
    token = await _token(org_id)
    if not token:
        raise HTTPException(status_code=400, detail="Connect Zeroloop first")
    booked = await pull_setoffs(org_id)
    items = await open_items(org_id)
    biz = await get_business(org_id)
    iban = biz.get("iban") or next((a.get("iban") for a in biz.get("bank_accounts") or [] if a.get("iban")), "")
    body = {"complete": True, "items": items, **({"profile": {"iban": iban}} if iban else {})}
    res = await _http("PUT", "/api/connect/v1/open-items", token, json=body)
    summary = {k: res.get(k, 0) for k in ("received", "invoices_created", "invoices_matched", "invoices_updated", "outside", "closed")}
    summary["setoffs_booked"] = booked
    summary["mismatches"] = len(res.get("mismatches") or [])
    await get_db().zeroloop.update_one({"org_id": org_id}, {"$set": {"last_sync_at": now(), "last_sync": summary, "last_error": None}})
    return summary


ZL_REF = re.compile(r"\bZL[\s\-_.]?([A-Z2-9]{6})\b", re.IGNORECASE)


async def report_bank_payments(org_id: str, rows: list) -> int:
    """After a bank statement import: tell Zeroloop about incoming payments carrying a Zeroloop
    reference (missing-link payments to this business). Returns how many it confirmed."""
    if not enabled():
        return 0
    token = await _token(org_id)
    if not token:
        return 0
    payments = []
    for r in rows:
        if (r.get("amount") or 0) <= 0:
            continue
        for m in ZL_REF.finditer(r.get("description") or ""):
            payments.append({"reference": f"ZL-{m.group(1).upper()}", "amount": r["amount"], "date": r.get("date")})
    if not payments:
        return 0
    res = await _http("POST", "/api/connect/v1/payments/received", token, json={"payments": payments[:500]})
    confirmed = sum(1 for x in res.get("results") or [] if x.get("status") == "confirmed")
    if confirmed:
        await get_db().zeroloop.update_one({"org_id": org_id}, {"$inc": {"payments_confirmed": confirmed}})
    return confirmed


async def sync_all() -> int:
    """Background job: every connected business."""
    if not enabled():
        return 0
    n = 0
    for doc in await get_db().zeroloop.find({"token_enc": {"$ne": None}}, {"_id": 0, "org_id": 1}).to_list(10000):
        try:
            await sync_org(doc["org_id"])
            n += 1
        except Exception as e:  # noqa: BLE001 — one business failing must not stop the others
            await get_db().zeroloop.update_one({"org_id": doc["org_id"]}, {"$set": {"last_error": str(getattr(e, "detail", e))[:300]}})
    return n


# ------------------------------------------------------------------ endpoints

def _need_enabled():
    if not enabled():
        raise HTTPException(status_code=400, detail="Zeroloop isn't set up on this server yet")


@router.get("/zeroloop")
async def status(ctx: Ctx = Depends(get_ctx)):
    doc = await get_db().zeroloop.find_one({"org_id": ctx.org_id}, {"_id": 0, "token_enc": 0, "state": 0}) or {}
    out = {"enabled": enabled(), "connected": bool(doc.get("member")), **{k: doc.get(k) for k in ("member", "connected_at", "last_sync_at", "last_sync", "last_error")}}
    if out["connected"] and enabled():
        try:
            out["summary"] = (await _http("GET", "/api/connect/v1/summary", await _token(ctx.org_id))).get("summary")
        except HTTPException:
            out["summary"] = None
    return out


@router.post("/zeroloop/connect")
async def connect(ctx: Ctx = Depends(get_ctx)):
    _need_enabled()
    require_role(ctx, "owner", "admin")
    biz = await get_business(ctx.org_id)
    if not gt.normalize_afm(biz.get("afm") or ""):
        raise HTTPException(status_code=400, detail="Add your business's ΑΦΜ in Settings first")
    state = secrets.token_urlsafe(24)
    expires = (datetime.now(timezone.utc) + timedelta(minutes=20)).isoformat()
    await get_db().zeroloop.update_one({"org_id": ctx.org_id}, {"$set": {"org_id": ctx.org_id, "state": {"value": state, "user_id": ctx.user_id, "expires_at": expires}}}, upsert=True)
    from urllib.parse import urlencode
    q = urlencode({"client_id": config.ZEROLOOP_CLIENT_ID, "redirect_uri": _redirect_uri(), "state": state,
                   "business_name": biz.get("business_name") or "", "vat_number": gt.normalize_afm(biz.get("afm") or ""), "email": biz.get("business_email") or ""})
    return {"url": f"{config.ZEROLOOP_URL.rstrip('/')}/connect?{q}"}


@router.get("/zeroloop/callback", include_in_schema=False)
async def callback(state: str = "", code: str = "", error: str = ""):
    """Zeroloop sends the browser back here. The state ties it to the business that started it."""
    back = f"{config.PUBLIC_URL}/app/settings?tab=connections"
    d = get_db()
    doc = await d.zeroloop.find_one({"state.value": state}, {"_id": 0}) if state else None
    if not doc or doc["state"]["expires_at"] < datetime.now(timezone.utc).isoformat():
        return RedirectResponse(f"{back}&zeroloop=expired", status_code=303)
    await d.zeroloop.update_one({"org_id": doc["org_id"]}, {"$unset": {"state": ""}})
    if error or not code:
        return RedirectResponse(f"{back}&zeroloop=cancelled", status_code=303)
    try:
        tok = await _http("POST", "/api/connect/token", form={"grant_type": "authorization_code", "code": code, "client_id": config.ZEROLOOP_CLIENT_ID,
                                                              "client_secret": config.ZEROLOOP_CLIENT_SECRET, "redirect_uri": _redirect_uri()})
    except HTTPException:
        return RedirectResponse(f"{back}&zeroloop=failed", status_code=303)
    enc = (await _cipher()).encrypt(tok["access_token"].encode()).decode()
    await d.zeroloop.update_one({"org_id": doc["org_id"]}, {"$set": {
        "token_enc": enc, "connection_id": tok.get("connection_id"), "member": tok.get("member"), "connected_at": now(),
        "connected_by": doc["state"]["user_id"], "last_setoff_id": 0, "last_error": None}})
    try:
        await sync_org(doc["org_id"])
    except HTTPException as e:
        await d.zeroloop.update_one({"org_id": doc["org_id"]}, {"$set": {"last_error": str(e.detail)[:300]}})
    return RedirectResponse(f"{back}&zeroloop=connected", status_code=303)


@router.post("/zeroloop/sync")
async def sync_now(ctx: Ctx = Depends(get_ctx)):
    _need_enabled()
    require_role(ctx, "owner", "admin", "accountant")
    return await sync_org(ctx.org_id)


@router.post("/zeroloop/open")
async def open_zeroloop(ctx: Ctx = Depends(get_ctx)):
    """A single-use sign-in link to this business's Zeroloop console."""
    _need_enabled()
    token = await _token(ctx.org_id)
    if not token:
        raise HTTPException(status_code=400, detail="Connect Zeroloop first")
    return await _http("POST", "/api/connect/v1/login-link", token)


@router.post("/zeroloop/disconnect")
async def disconnect(ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    token = await _token(ctx.org_id)
    if token and enabled():
        try:
            await _http("DELETE", "/api/connect/v1/connection", token)
        except HTTPException:
            pass  # already revoked on Zeroloop's side
    await get_db().zeroloop.delete_one({"org_id": ctx.org_id})
    return {"ok": True}


def verify_signature(header: str, body: bytes, secret: str, tolerance: int = 300) -> bool:
    try:
        parts = dict(p.split("=", 1) for p in (header or "").split(","))
        t, sig = int(parts["t"]), parts["v1"]
    except (KeyError, ValueError):
        return False
    if abs(time.time() - t) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig)


@router.post("/public/zeroloop/webhook", include_in_schema=False)
async def webhook(request: Request):
    if not enabled():
        raise HTTPException(status_code=404, detail="Not found")
    body = await request.body()
    if not verify_signature(request.headers.get("zeroloop-signature", ""), body, config.ZEROLOOP_WEBHOOK_SECRET):
        raise HTTPException(status_code=401, detail="Bad signature")
    import json
    evt = json.loads(body)
    if evt.get("type") != "setoffs.created":
        return {"ok": True, "ignored": True}
    doc = await get_db().zeroloop.find_one({"connection_id": evt.get("connection_id")}, {"_id": 0, "org_id": 1, "last_setoff_id": 1})
    if not doc:
        return {"ok": True, "ignored": True}  # disconnected meanwhile; nothing to book
    p = evt.get("proposal") or {}
    n = 0
    for it in evt.get("items") or []:
        if await apply_setoff(doc["org_id"], it["external_id"], it["amount"], it["setoff_id"], p.get("id", ""), p.get("kind") or "loop",
                              it.get("settled_by") or "set_off", p.get("reference") or ""):
            n += 1
    return {"ok": True, "booked": n}
