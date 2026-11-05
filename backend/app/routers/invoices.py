"""Invoices and credit notes."""
import secrets
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx
from app.plans import enforce
from app.common import Item, clean_items, esc, money, next_number, totals, valid_currency
from app.db import get_db, now, today
from app.mailer import layout, send
from app.ratelimit import rate_limit
from app.render import document_email
from app.routers.business import client_snapshot, get_business
from app.routers.catalog import apply_stock

router = APIRouter(tags=["invoices"])

STATUSES = ("draft", "sent", "paid", "overdue")
CLIENT_FIELDS = ("client_name", "client_company", "client_email", "client_afm", "client_country",
                 "client_address", "client_city", "client_postal_code")


class InvoiceInput(BaseModel):
    client_id: Optional[str] = None
    client_name: Optional[str] = ""
    client_company: Optional[str] = ""
    client_email: Optional[str] = ""
    client_afm: Optional[str] = ""
    client_country: Optional[str] = "GR"
    items: List[Item] = []
    tax_rate: float = 24
    notes: Optional[str] = ""
    status: Optional[str] = "draft"
    issue_date: Optional[str] = None
    due_date: Optional[str] = None
    currency: Optional[str] = "EUR"
    recurring: Optional[str] = "none"
    source_document_id: Optional[str] = None
    withholding_category: Optional[int] = 0
    stamp_category: Optional[int] = 0
    iban: Optional[str] = ""
    language: Optional[str] = ""
    delivery: Optional[dict] = None


def clean_delivery(d: Optional[dict]) -> Optional[dict]:
    """Optional delivery-note part of a sales invoice (Τιμολόγιο - Δελτίο Αποστολής)."""
    if not d or not d.get("enabled"):
        return None
    addr = lambda a: {k: str((a or {}).get(k) or "").strip()[:150] for k in ("street", "number", "postal_code", "city")}  # noqa: E731
    purpose = int(d.get("move_purpose") or 1)
    return {"move_purpose": purpose if purpose in gt.MOVE_PURPOSES else 1, "loading_address": addr(d.get("loading_address")),
            "delivery_address": addr(d.get("delivery_address")), "dispatch_date": _check_date(d.get("dispatch_date"), "Dispatch date") or today(),
            "dispatch_time": str(d.get("dispatch_time") or "")[:5], "vehicle_number": str(d.get("vehicle_number") or "").strip().upper()[:20]}


def is_locked(inv: dict) -> bool:
    """A real AADE MARK makes the invoice immutable — corrections go through credit notes or cancellation."""
    md = inv.get("mydata") or {}
    return bool(md.get("mark")) and md.get("state") in ("transmitted", "cancelled") and not md.get("simulated")


def _check_date(v: Optional[str], field: str) -> Optional[str]:
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{field} must be a date (YYYY-MM-DD)")


async def _fields(data: InvoiceInput, ctx: Ctx) -> dict:
    items = clean_items(data.items)
    if data.tax_rate < 0 or data.tax_rate > 100:
        raise HTTPException(status_code=400, detail="VAT rate must be between 0 and 100")
    wcat = data.withholding_category if data.withholding_category in gt.WITHHOLDING else 0
    scat = data.stamp_category if data.stamp_category in gt.STAMP_DUTY else 0
    t = gt.document_totals(items, data.tax_rate, wcat, scat)
    net, vat, total = t["net"], t["vat"], t["payable"]
    party = await client_snapshot(ctx.org_id, data.client_id) if data.client_id else {
        "client_id": None, **{k: (getattr(data, k, "") or "").strip()[:300] for k in CLIENT_FIELDS if hasattr(data, k)}}
    party.setdefault("client_country", "GR")
    if not (party.get("client_name") or "").strip():
        raise HTTPException(status_code=400, detail="Choose a client or enter a client name")
    issue = _check_date(data.issue_date, "Issue date") or today()
    due = _check_date(data.due_date, "Due date")
    if due and due < issue:
        raise HTTPException(status_code=400, detail="Due date cannot be before the issue date")
    return {**party, "items": items, "tax_rate": data.tax_rate, "subtotal": net, "tax": vat, "total": total,
            "withholding_category": wcat, "stamp_category": scat, "withheld": t["withheld"], "stamp_duty": t["stamp_duty"], "gross": t["gross"],
            "iban": gt.normalize_iban(data.iban or ""), "language": data.language if data.language in ("el", "en") else "",
            "delivery": clean_delivery(data.delivery),
            "notes": (data.notes or "").strip()[:2000], "issue_date": issue, "due_date": due,
            "currency": valid_currency(data.currency), "recurring": data.recurring if data.recurring in ("none", "monthly") else "none"}


async def sync_stock(inv: dict):
    """Goods leave stock once an invoice is issued (not while it's a draft), and come back if it's deleted or credited."""
    issued = inv.get("status") != "draft" and inv.get("kind") in ("invoice", "receipt", None)
    if issued and not inv.get("stock_applied"):
        await apply_stock(inv["org_id"], inv, -1, "sale")
        await get_db().invoices.update_one({"id": inv["id"]}, {"$set": {"stock_applied": True}})
    elif not issued and inv.get("stock_applied"):
        await apply_stock(inv["org_id"], inv, +1, "sale reversed")
        await get_db().invoices.update_one({"id": inv["id"]}, {"$set": {"stock_applied": False}})


async def _get(org_id: str, invoice_id: str) -> dict:
    inv = await get_db().invoices.find_one({"id": invoice_id, "org_id": org_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


@router.get("/invoices")
async def list_invoices(ctx: Ctx = Depends(get_ctx)):
    return await get_db().invoices.find({"org_id": ctx.org_id}, {"_id": 0}).sort("created_at", -1).to_list(5000)


@router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    return await _get(ctx.org_id, invoice_id)


@router.post("/invoices")
async def create_invoice(data: InvoiceInput, ctx: Ctx = Depends(get_ctx)):
    await enforce(ctx.org_id, "invoices_month")
    f = await _fields(data, ctx)
    status = data.status if data.status in STATUSES else "draft"
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "kind": "invoice", "number": await next_number(ctx.org_id, "invoice", "INV"),
           **f, "status": status, "source_document_id": data.source_document_id,
           "next_recurring_at": (datetime.now(timezone.utc) + timedelta(days=30)).isoformat() if f["recurring"] == "monthly" else None,
           "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().invoices.insert_one({**doc})
    await sync_stock(doc)
    return await _get(ctx.org_id, doc["id"])


@router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, data: InvoiceInput, ctx: Ctx = Depends(get_ctx)):
    old = await _get(ctx.org_id, invoice_id)
    if is_locked(old):
        raise HTTPException(status_code=409, detail="This invoice was reported to AADE and is locked. Issue a credit note to correct it.")
    if old.get("kind") == "credit_note":
        raise HTTPException(status_code=400, detail="Credit notes can't be edited — delete it and create a new one")
    f = await _fields(data, ctx)
    status = data.status if data.status in STATUSES else old.get("status", "draft")
    if old.get("stock_applied"):  # lines may have changed: put the old quantities back first
        await apply_stock(ctx.org_id, old, +1, "invoice edited")
        await get_db().invoices.update_one({"id": invoice_id}, {"$set": {"stock_applied": False}})
    if f["recurring"] == "monthly":
        f["next_recurring_at"] = old.get("next_recurring_at") or (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    else:
        f["next_recurring_at"] = None
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": {**f, "status": status, "updated_at": now(),
                                                                     **({"paid_at": now()} if status == "paid" and old.get("status") != "paid" else {})}})
    await sync_stock(await _get(ctx.org_id, invoice_id))
    return await _get(ctx.org_id, invoice_id)


class StatusInput(BaseModel):
    status: str


@router.put("/invoices/{invoice_id}/status")
async def set_status(invoice_id: str, data: StatusInput, ctx: Ctx = Depends(get_ctx)):
    inv = await _get(ctx.org_id, invoice_id)
    if inv.get("kind") == "credit_note":
        raise HTTPException(status_code=400, detail="Credit notes have no payment status")
    if data.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    sets = {"status": data.status, "updated_at": now()}
    if data.status == "paid" and inv.get("status") != "paid":
        sets["paid_at"] = now()
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": sets})
    await sync_stock(await _get(ctx.org_id, invoice_id))
    return await _get(ctx.org_id, invoice_id)


@router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    inv = await _get(ctx.org_id, invoice_id)
    if is_locked(inv):
        raise HTTPException(status_code=409, detail="Invoices reported to AADE must be kept for your records")
    if inv.get("stock_applied"):
        await apply_stock(ctx.org_id, inv, +1, "invoice deleted")
    await get_db().invoices.delete_one({"id": invoice_id})
    return {"ok": True}


async def _ensure_token(inv: dict) -> str:
    if inv.get("public_token"):
        return inv["public_token"]
    token = secrets.token_urlsafe(24)
    await get_db().invoices.update_one({"id": inv["id"]}, {"$set": {"public_token": token}})
    return token


@router.post("/invoices/{invoice_id}/share")
async def share(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    inv = await _get(ctx.org_id, invoice_id)
    return {"url": f"{config.PUBLIC_URL}/i/{await _ensure_token(inv)}"}


@router.post("/invoices/{invoice_id}/send")
async def send_invoice(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    inv = await _get(ctx.org_id, invoice_id)
    to = (inv.get("client_email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail="Add the client's email first")
    biz = await get_business(ctx.org_id)
    url = f"{config.PUBLIC_URL}/i/{await _ensure_token(inv)}"
    is_credit = inv.get("kind") == "credit_note"
    kind = "credit_note" if is_credit else "invoice"
    intro = (f"Please find credit note {esc(inv['number'])} for invoice {esc(inv.get('credit_of_number'))}." if is_credit
             else f"Here is invoice {esc(inv['number'])} for {money(inv['total'], inv.get('currency'))}.")
    html = layout(f"{'Credit note' if is_credit else 'Invoice'} from {biz.get('business_name') or config.APP_NAME}",
                  document_email(inv, biz, kind, intro), "View online", url, biz.get("business_name", ""))
    sent = await send(to, f"{'Credit note' if is_credit else 'Invoice'} {inv['number']} — {biz.get('business_name') or ''}".strip(" —"),
                      html, biz.get("business_email", ""))
    sets = {"sent_at": now(), "updated_at": now()}
    if inv.get("status") == "draft":
        sets["status"] = "sent"
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": sets})
    return {"emailed": sent, "url": url, "invoice": await _get(ctx.org_id, invoice_id)}


@router.get("/public/invoices/{token}")
async def public_invoice(token: str, request: Request):
    rate_limit(request, "public-invoice", 240)
    inv = await get_db().invoices.find_one({"public_token": token}, {"_id": 0})
    if not inv or inv.get("status") == "draft":
        raise HTTPException(status_code=404, detail="Invoice not found")
    biz = await get_business(inv["org_id"])
    keep = ("number", "kind", "issue_date", "due_date", "items", "tax_rate", "subtotal", "tax", "total", "currency", "notes", "status",
            "client_name", "client_company", "credit_of_number", "withholding_category", "stamp_category", "withheld", "stamp_duty", "gross",
            "iban", "language", "paid_amount", "balance") + CLIENT_FIELDS
    md = inv.get("mydata") or {}
    return {"invoice": {k: inv.get(k) for k in keep},
            "mydata": {k: md.get(k) for k in ("mark", "uid", "qr_url", "simulated", "state")} if md.get("state") == "transmitted" else None,
            "business": {k: biz.get(k, "") for k in ("business_name", "business_email", "business_phone", "address", "city", "afm", "doy",
                                                     "invoice_template", "brand_color", "invoice_footer",
                                                     "website", "logo", "iban", "payment_instructions")}}


@router.post("/invoices/{invoice_id}/duplicate")
async def duplicate_invoice(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    """A fresh draft with the same client, lines and VAT — dated today, new number, nothing reported yet."""
    await enforce(ctx.org_id, "invoices_month")
    src = await _get(ctx.org_id, invoice_id)
    if src.get("kind") == "credit_note":
        raise HTTPException(status_code=400, detail="Credit notes can't be duplicated")
    is_receipt = src.get("kind") == "receipt"
    keep = ("client_id", "items", "tax_rate", "subtotal", "tax", "total", "notes", "currency", "withholding_category", "stamp_category", "withheld", "stamp_duty", "gross", "iban", "language") + CLIENT_FIELDS
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "kind": src.get("kind") or "invoice",
           "number": await next_number(ctx.org_id, "receipt" if is_receipt else "invoice", "REC" if is_receipt else "INV"),
           **{k: src.get(k) for k in keep}, "status": "draft", "issue_date": today(), "due_date": None, "recurring": "none",
           "next_recurring_at": None, "duplicated_from": src["id"], "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().invoices.insert_one({**doc})
    return doc


# ------------------------------------------------------------------ part payments

PAY_METHODS = ("bank_transfer", "cash", "card", "cheque", "other")


class PaymentInput(BaseModel):
    amount: float
    date: Optional[str] = None
    method: Optional[str] = "bank_transfer"
    note: Optional[str] = ""


async def _apply_payments(inv: dict) -> dict:
    """Recompute paid amount, balance and status from the payments list."""
    paid = round(sum(p["amount"] for p in inv.get("payments") or []), 2)
    balance = round((inv.get("total") or 0) - paid, 2)
    sets = {"paid_amount": paid, "balance": max(balance, 0), "updated_at": now()}
    if balance <= 0.005 and inv.get("payments"):
        sets["status"] = "paid"
        if inv.get("status") != "paid":
            sets["paid_at"] = now()
    elif inv.get("status") == "paid":  # a payment was removed
        sets["status"] = "overdue" if inv.get("due_date") and inv["due_date"] < today() else "sent"
    await get_db().invoices.update_one({"id": inv["id"]}, {"$set": sets})
    return await _get(inv["org_id"], inv["id"])


@router.post("/invoices/{invoice_id}/payments")
async def add_payment(invoice_id: str, data: PaymentInput, ctx: Ctx = Depends(get_ctx)):
    inv = await _get(ctx.org_id, invoice_id)
    if inv.get("kind") in ("credit_note", "receipt"):
        raise HTTPException(status_code=400, detail="Payments are recorded on invoices only")
    if inv.get("status") == "draft":
        raise HTTPException(status_code=400, detail="Issue the invoice before recording payments")
    amount = round(data.amount or 0, 2)
    owed = round((inv.get("total") or 0) - sum(p["amount"] for p in inv.get("payments") or []), 2)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Enter the amount received")
    if amount > owed + 0.005:
        raise HTTPException(status_code=400, detail=f"That's more than what's still owed ({money(owed, inv.get('currency'))})")
    pay = {"id": str(uuid.uuid4()), "amount": amount, "date": _check_date(data.date, "Payment date") or today(),
           "method": data.method if data.method in PAY_METHODS else "other", "note": (data.note or "").strip()[:200],
           "recorded_by": ctx.user_id, "created_at": now()}
    await get_db().invoices.update_one({"id": invoice_id}, {"$push": {"payments": pay}})
    return await _apply_payments(await _get(ctx.org_id, invoice_id))


@router.delete("/invoices/{invoice_id}/payments/{payment_id}")
async def delete_payment(invoice_id: str, payment_id: str, ctx: Ctx = Depends(get_ctx)):
    await _get(ctx.org_id, invoice_id)
    await get_db().invoices.update_one({"id": invoice_id}, {"$pull": {"payments": {"id": payment_id}}})
    return await _apply_payments(await _get(ctx.org_id, invoice_id))


# ------------------------------------------------------------------ client statement (καρτέλα πελάτη)

@router.get("/clients/{client_id}/statement")
async def client_statement(client_id: str, start: Optional[str] = None, end: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    client = await d.clients.find_one({"id": client_id, "org_id": ctx.org_id}, {"_id": 0})
    if not client:
        raise HTTPException(status_code=404, detail="Client not found")
    s = _check_date(start, "Start") or "0000-01-01"
    e = _check_date(end, "End") or "9999-12-31"
    docs = await d.invoices.find({"org_id": ctx.org_id, "client_id": client_id, "status": {"$ne": "draft"}, "currency": {"$in": ["EUR", None]}},
                                 {"_id": 0}).to_list(5000)
    events = []
    for i in docs:
        if i.get("kind") == "credit_note":
            events.append({"date": i["issue_date"], "kind": "credit_note", "ref": i["number"], "text": f"Credit note for {i.get('credit_of_number')}",
                           "debit": 0, "credit": i["total"]})
        else:
            events.append({"date": i["issue_date"], "kind": i.get("kind") or "invoice", "ref": i["number"], "text": "Invoice" if i.get("kind") != "receipt" else "Receipt",
                           "debit": i["total"], "credit": 0, "due": i.get("due_date")})
            pays = i.get("payments") or []
            for p in pays:
                events.append({"date": p["date"], "kind": "payment", "ref": i["number"], "text": f"Payment ({p['method'].replace('_', ' ')})", "debit": 0, "credit": p["amount"]})
            if not pays and i.get("status") == "paid":
                events.append({"date": (i.get("paid_at") or i["issue_date"])[:10], "kind": "payment", "ref": i["number"], "text": "Payment", "debit": 0, "credit": i["total"]})
    events.sort(key=lambda x: (x["date"], 0 if x["kind"] != "payment" else 1))
    opening = round(sum(x["debit"] - x["credit"] for x in events if x["date"] < s), 2)
    rows, bal = [], opening
    for x in events:
        if s <= x["date"] <= e:
            bal = round(bal + x["debit"] - x["credit"], 2)
            rows.append({**x, "balance": bal})
    return {"client": {k: client.get(k, "") for k in ("id", "name", "company", "afm", "email", "address", "city", "postal_code", "language")},
            "start": None if s == "0000-01-01" else s, "end": None if e == "9999-12-31" else e,
            "opening": opening, "rows": rows, "closing": bal,
            "invoiced": round(sum(r["debit"] for r in rows), 2), "received": round(sum(r["credit"] for r in rows), 2)}


# ------------------------------------------------------------------ retail receipts (myDATA 11.1 / 11.2)

RETAIL_CUSTOMER = "Retail customer"


class ReceiptInput(BaseModel):
    items: List[Item]
    tax_rate: float = 24
    kind: str = "goods"          # goods -> 11.1 ΑΛΠ, services -> 11.2 ΑΠΥ
    payment: str = "card"        # cash | card
    customer_email: Optional[str] = ""
    send_to_mydata: bool = True


@router.post("/receipts")
async def create_receipt(data: ReceiptInput, ctx: Ctx = Depends(get_ctx)):
    """Counter sale in one step: number it, mark it paid, report it to myDATA (when set up) and optionally email it."""
    await enforce(ctx.org_id, "invoices_month")
    items = clean_items(data.items)
    if not items or any(i["qty"] <= 0 or i["unit_price"] <= 0 for i in items):
        raise HTTPException(status_code=400, detail="Add at least one item with a price")
    if data.tax_rate not in gt.VAT_CATEGORIES:
        raise HTTPException(status_code=400, detail="Choose a Greek VAT rate")
    net, vat, total = totals(items, data.tax_rate)
    itype = "11.2" if data.kind == "services" else "11.1"
    pm = 3 if data.payment == "cash" else 7
    terminal = data.payment == "terminal"  # paid on the linked card terminal first, then reported (see pos.py)
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "kind": "receipt", "number": await next_number(ctx.org_id, "receipt", "REC"),
           "client_id": None, "client_name": RETAIL_CUSTOMER, "client_company": "", "client_email": (data.customer_email or "").strip()[:200],
           "client_afm": "", "client_country": "GR", "client_address": "", "client_city": "", "client_postal_code": "",
           "items": items, "tax_rate": data.tax_rate, "subtotal": net, "tax": vat, "total": total, "notes": "", "currency": "EUR",
           "issue_date": today(), "due_date": None, "recurring": "none", "next_recurring_at": None,
           "status": "draft" if terminal else "paid", "paid_at": None if terminal else now(),
           "payment": "cash" if data.payment == "cash" else "card", "mydata": {"invoice_type": itype, "payment_method": pm},
           "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().invoices.insert_one({**doc})
    await sync_stock(doc)
    out = {"receipt": doc, "mydata": None, "mydata_error": None, "awaiting_terminal": terminal}
    if data.send_to_mydata and not terminal:
        from app.routers import mydata as md_router  # local import: mydata imports this module
        settings = await md_router._settings(ctx.org_id)
        if settings.get("vat_number"):
            try:
                out["receipt"] = await md_router.submit(doc["id"], md_router.MyDataInput(invoice_type=itype, payment_method=pm), ctx)
                out["mydata"] = (out["receipt"].get("mydata") or {}).get("mark")
            except HTTPException as e:
                det = e.detail
                out["mydata_error"] = det.get("message") if isinstance(det, dict) else str(det)
                out["receipt"] = await _get(ctx.org_id, doc["id"])
        else:
            out["mydata_error"] = "Set up e-Invoicing to report receipts to myDATA"
    return out


# ------------------------------------------------------------------ credit notes (myDATA 5.1)

class CreditNoteInput(BaseModel):
    reason: str
    items: Optional[List[Item]] = None


def _net(items: list) -> float:
    return totals(items, 0)[0]


@router.post("/invoices/{invoice_id}/credit-note")
async def create_credit_note(invoice_id: str, data: CreditNoteInput, ctx: Ctx = Depends(get_ctx)):
    orig = await _get(ctx.org_id, invoice_id)
    omd = orig.get("mydata") or {}
    if orig.get("kind") == "credit_note":
        raise HTTPException(status_code=400, detail="You cannot credit a credit note")
    if omd.get("state") != "transmitted" or not omd.get("mark"):
        raise HTTPException(status_code=400, detail="Only invoices reported to myDATA can be credited — unreported invoices can simply be edited")
    if omd.get("invoice_type") in gt.RETAIL_TYPES:
        raise HTTPException(status_code=400, detail="Retail receipts can't be credited here yet")
    reason = (data.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Give a reason — it is printed on the credit note")
    items = ([{k: i[k] for k in ("description", "qty", "unit_price", "product_id") if k in i} for i in orig.get("items") or []]
             if data.items is None else [i for i in clean_items(data.items) if i["qty"] > 0 and i["unit_price"] > 0])
    if not items:
        raise HTTPException(status_code=400, detail="Add at least one line to credit")
    prev = await get_db().invoices.find({"org_id": ctx.org_id, "kind": "credit_note", "credit_of": invoice_id,
                                         "mydata.state": {"$ne": "cancelled"}}, {"_id": 0, "items": 1}).to_list(500)
    remaining = round(_net(orig.get("items") or []) - sum(_net(p.get("items") or []) for p in prev), 2)
    if _net(items) > remaining + 0.001:
        raise HTTPException(status_code=400, detail=f"Credit exceeds what is left on the invoice (net €{remaining:,.2f})")
    t = gt.document_totals(items, orig.get("tax_rate") or 0, orig.get("withholding_category") or 0, orig.get("stamp_category") or 0)
    net, vat, total = t["net"], t["vat"], t["payable"]
    cls_cat, cls_type = gt.DEFAULT_CLASSIFICATION.get(omd.get("invoice_type"), gt.DEFAULT_CLASSIFICATION["5.1"])
    md = {k: omd.get(k) for k in ("payment_method", "counterpart_vat", "counterpart_country", "counterpart_branch", "counterpart_name",
                                   "counterpart_street", "counterpart_city", "counterpart_postal_code", "vat_exemption_category")}
    md.update({"invoice_type": "5.1", "correlated_mark": omd["mark"],
               "classification_category": omd.get("classification_category") or cls_cat,
               "classification_type": omd.get("classification_type") or cls_type})
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "kind": "credit_note", "credit_of": invoice_id,
           "credit_of_number": orig["number"], "number": await next_number(ctx.org_id, "credit_note", "CN"),
           **{k: orig.get(k) for k in ("client_id",) + CLIENT_FIELDS}, "items": items, "tax_rate": orig.get("tax_rate") or 0,
           "withholding_category": orig.get("withholding_category") or 0, "stamp_category": orig.get("stamp_category") or 0,
           "withheld": t["withheld"], "stamp_duty": t["stamp_duty"], "gross": t["gross"],
           "subtotal": net, "tax": vat, "total": total, "notes": reason[:1000], "status": "credited", "currency": "EUR",
           "issue_date": today(), "due_date": None, "recurring": "none", "mydata": md,
           "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().invoices.insert_one({**doc})
    await apply_stock(ctx.org_id, doc, +1, "credit note")
    return doc


# ------------------------------------------------------------------ scheduled jobs

async def flag_overdue() -> int:
    d = get_db()
    r = await d.invoices.update_many({"status": "sent", "kind": {"$ne": "credit_note"}, "due_date": {"$ne": None, "$lt": today()}},
                                     {"$set": {"status": "overdue", "updated_at": now()}})
    return r.modified_count


async def run_recurring() -> int:
    d = get_db()
    created = 0
    due = await d.invoices.find({"recurring": "monthly", "next_recurring_at": {"$ne": None, "$lt": now()}}, {"_id": 0}).to_list(500)
    for inv in due:
        # Claim the run first so two workers can't both create the copy.
        nxt_dt = datetime.fromisoformat(inv["next_recurring_at"]) + timedelta(days=30)
        if nxt_dt < datetime.now(timezone.utc):  # long gap (e.g. server was down): one copy, then resume monthly
            nxt_dt = datetime.now(timezone.utc) + timedelta(days=30)
        nxt = nxt_dt.isoformat()
        claim = await d.invoices.update_one({"id": inv["id"], "next_recurring_at": inv["next_recurring_at"]}, {"$set": {"next_recurring_at": nxt}})
        if not claim.modified_count:
            continue
        copy = {k: inv.get(k) for k in ("org_id", "client_id", "items", "tax_rate", "subtotal", "tax", "total", "notes", "currency", "withholding_category", "stamp_category", "withheld", "stamp_duty", "gross", "iban", "language") + CLIENT_FIELDS}
        copy.update({"id": str(uuid.uuid4()), "kind": "invoice", "number": await next_number(inv["org_id"], "invoice", "INV"),
                     "status": "draft", "issue_date": today(), "due_date": None, "recurring": "none", "next_recurring_at": None,
                     "recurring_from": inv["id"], "created_at": now(), "updated_at": now()})
        await d.invoices.insert_one(copy)
        created += 1
    return created
