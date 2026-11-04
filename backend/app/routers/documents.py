"""Quotes, sales orders and purchase orders, with conversions between them."""
import secrets
import uuid
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.auth import Ctx, get_ctx
from app.plans import enforce
from app.common import Item, clean_items, esc, money, next_number, totals, valid_currency
from app.db import get_db, now, today
from app.mailer import layout, send
from app.notify import notify
from app.ratelimit import rate_limit
from app.render import document_email
from app.routers.business import client_snapshot, get_business

router = APIRouter(tags=["documents"])

TYPES = {
    "quote": {"prefix": "QT", "statuses": ("draft", "sent", "accepted", "declined", "expired")},
    "sales_order": {"prefix": "SO", "statuses": ("draft", "confirmed", "fulfilled", "cancelled")},
    "purchase_order": {"prefix": "PO", "statuses": ("draft", "sent", "received", "cancelled")},
}
CONVERSIONS = {"quote": ("sales_order", "invoice"), "sales_order": ("invoice",), "purchase_order": ("expense",)}


class DocInput(BaseModel):
    doc_type: str
    client_id: Optional[str] = None
    supplier_id: Optional[str] = None
    party_name: Optional[str] = ""
    party_email: Optional[str] = ""
    items: List[Item] = []
    tax_rate: float = 24
    notes: Optional[str] = ""
    status: Optional[str] = "draft"
    issue_date: Optional[str] = None
    valid_until: Optional[str] = None
    currency: Optional[str] = "EUR"


def _date(v: Optional[str]) -> Optional[str]:
    if not v:
        return None
    try:
        return date.fromisoformat(v[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")


async def _party(ctx: Ctx, data: DocInput) -> dict:
    if data.doc_type == "purchase_order":
        if data.supplier_id:
            s = await get_db().suppliers.find_one({"id": data.supplier_id, "org_id": ctx.org_id}, {"_id": 0})
            if not s:
                raise HTTPException(status_code=400, detail="Supplier not found")
            return {"supplier_id": s["id"], "supplier_name": s["name"], "supplier_email": s.get("email", ""), "supplier_afm": s.get("afm", "")}
        name = (data.party_name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Choose a supplier or enter a supplier name")
        return {"supplier_id": None, "supplier_name": name[:300], "supplier_email": (data.party_email or "").strip()[:300], "supplier_afm": ""}
    if data.client_id:
        return await client_snapshot(ctx.org_id, data.client_id)
    name = (data.party_name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Choose a client or enter a client name")
    return {"client_id": None, "client_name": name[:300], "client_email": (data.party_email or "").strip()[:300], "client_country": "GR"}


async def _fields(ctx: Ctx, data: DocInput) -> dict:
    if data.doc_type not in TYPES:
        raise HTTPException(status_code=400, detail="Unknown document type")
    items = clean_items(data.items)
    net, vat, total = totals(items, data.tax_rate)
    return {**await _party(ctx, data), "items": items, "tax_rate": data.tax_rate, "subtotal": net, "tax": vat, "total": total,
            "notes": (data.notes or "").strip()[:2000], "issue_date": _date(data.issue_date) or today(),
            "valid_until": _date(data.valid_until), "currency": valid_currency(data.currency)}


async def _get(org_id: str, doc_id: str) -> dict:
    d = await get_db().documents.find_one({"id": doc_id, "org_id": org_id}, {"_id": 0})
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    return d


@router.get("/documents")
async def list_documents(type: str, ctx: Ctx = Depends(get_ctx)):
    if type not in TYPES:
        raise HTTPException(status_code=400, detail="Unknown document type")
    return await get_db().documents.find({"org_id": ctx.org_id, "doc_type": type}, {"_id": 0}).sort("created_at", -1).to_list(5000)


@router.post("/documents")
async def create_document(data: DocInput, ctx: Ctx = Depends(get_ctx)):
    f = await _fields(ctx, data)
    t = TYPES[data.doc_type]
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "doc_type": data.doc_type,
           "number": await next_number(ctx.org_id, data.doc_type, t["prefix"]), **f,
           "status": data.status if data.status in t["statuses"] else "draft", "converted": {},
           "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().documents.insert_one({**doc})
    return doc


@router.put("/documents/{doc_id}")
async def update_document(doc_id: str, data: DocInput, ctx: Ctx = Depends(get_ctx)):
    old = await _get(ctx.org_id, doc_id)
    if data.doc_type != old["doc_type"]:
        raise HTTPException(status_code=400, detail="Document type can't be changed")
    if old["doc_type"] == "quote" and old.get("status") in ("accepted", "declined"):
        raise HTTPException(status_code=409, detail="The client already responded to this quote — create a new one instead")
    f = await _fields(ctx, data)
    status = data.status if data.status in TYPES[old["doc_type"]]["statuses"] else old["status"]
    await get_db().documents.update_one({"id": doc_id}, {"$set": {**f, "status": status, "updated_at": now()}})
    return await _get(ctx.org_id, doc_id)


class StatusInput(BaseModel):
    status: str


@router.put("/documents/{doc_id}/status")
async def set_status(doc_id: str, data: StatusInput, ctx: Ctx = Depends(get_ctx)):
    d = await _get(ctx.org_id, doc_id)
    if data.status not in TYPES[d["doc_type"]]["statuses"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    await get_db().documents.update_one({"id": doc_id}, {"$set": {"status": data.status, "updated_at": now()}})
    return await _get(ctx.org_id, doc_id)


@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, ctx: Ctx = Depends(get_ctx)):
    await _get(ctx.org_id, doc_id)
    await get_db().documents.delete_one({"id": doc_id})
    return {"ok": True}


class ConvertInput(BaseModel):
    to: str


@router.post("/documents/{doc_id}/convert")
async def convert(doc_id: str, data: ConvertInput, ctx: Ctx = Depends(get_ctx)):
    src = await _get(ctx.org_id, doc_id)
    if data.to not in CONVERSIONS.get(src["doc_type"], ()):
        raise HTTPException(status_code=400, detail=f"A {src['doc_type'].replace('_', ' ')} can't be converted to {data.to}")
    if (src.get("converted") or {}).get(data.to):
        raise HTTPException(status_code=409, detail=f"Already converted — see {src['converted'][data.to]['number']}")
    if src.get("status") in ("declined", "cancelled"):
        raise HTTPException(status_code=400, detail="Declined or cancelled documents can't be converted")
    d = get_db()
    base = {"org_id": ctx.org_id, "items": src["items"], "tax_rate": src["tax_rate"], "subtotal": src["subtotal"], "tax": src["tax"],
            "total": src["total"], "currency": src.get("currency", "EUR"), "notes": src.get("notes", ""), "issue_date": today(),
            "source_document_id": src["id"], "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    party = {k: v for k, v in src.items() if k.startswith("client_")}
    new_id = str(uuid.uuid4())
    if data.to == "invoice":
        await enforce(ctx.org_id, "invoices_month")
        number = await next_number(ctx.org_id, "invoice", "INV")
        await d.invoices.insert_one({"id": new_id, "kind": "invoice", "number": number, **base, **party, "status": "draft",
                                     "due_date": None, "recurring": "none", "next_recurring_at": None})
    elif data.to == "sales_order":
        number = await next_number(ctx.org_id, "sales_order", "SO")
        await d.documents.insert_one({"id": new_id, "doc_type": "sales_order", "number": number, **base, **party,
                                      "status": "confirmed", "valid_until": None, "converted": {}})
    else:  # purchase order -> expense
        number = await next_number(ctx.org_id, "expense", "EXP")
        await d.expenses.insert_one({"id": new_id, "number": number, "org_id": ctx.org_id, "date": today(),
                                     "vendor_name": src.get("supplier_name", ""), "vendor_afm": src.get("supplier_afm", ""),
                                     "supplier_id": src.get("supplier_id"), "category": "materials",
                                     "description": f"{src['number']}: " + "; ".join(i["description"] for i in src["items"])[:300],
                                     "net": src["subtotal"], "vat": src["tax"], "total": src["total"], "vat_rate": src["tax_rate"],
                                     "currency": src.get("currency", "EUR"), "payment_status": "unpaid", "source": "purchase_order",
                                     "source_document_id": src["id"], "created_by": ctx.user_id, "created_at": now(), "updated_at": now()})
    sets = {f"converted.{data.to}": {"id": new_id, "number": number}, "updated_at": now()}
    if src["doc_type"] == "quote" and src["status"] in ("draft", "sent"):
        sets["status"] = "accepted"
    if src["doc_type"] == "purchase_order" and src["status"] in ("draft", "sent"):
        sets["status"] = "received"
    await d.documents.update_one({"id": doc_id}, {"$set": sets})
    return {"id": new_id, "number": number, "to": data.to, "source": await _get(ctx.org_id, doc_id)}


@router.post("/documents/{doc_id}/send")
async def send_document(doc_id: str, ctx: Ctx = Depends(get_ctx)):
    doc = await _get(ctx.org_id, doc_id)
    is_po = doc["doc_type"] == "purchase_order"
    to = (doc.get("supplier_email" if is_po else "client_email") or "").strip()
    if not to:
        raise HTTPException(status_code=400, detail=f"Add the {'supplier' if is_po else 'client'}'s email first")
    biz = await get_business(ctx.org_id)
    url = ""
    if doc["doc_type"] == "quote":
        token = doc.get("public_token") or secrets.token_urlsafe(24)
        await get_db().documents.update_one({"id": doc_id}, {"$set": {"public_token": token}})
        url = f"{config.PUBLIC_URL}/q/{token}"
    title = {"quote": "Quote", "sales_order": "Order confirmation", "purchase_order": "Purchase order"}[doc["doc_type"]]
    intro = {"quote": f"Here is our quote {esc(doc['number'])} for {money(doc['total'], doc.get('currency'))}. You can accept or decline it online.",
             "sales_order": f"This confirms your order {esc(doc['number'])}.",
             "purchase_order": f"Please supply the items in purchase order {esc(doc['number'])}."}[doc["doc_type"]]
    html = layout(f"{title} from {biz.get('business_name') or config.APP_NAME}",
                  document_email(doc, biz, doc["doc_type"], intro, "Supplier" if is_po else "For"),
                  "Review and respond" if url else "", url, biz.get("business_name", ""))
    emailed = await send(to, f"{title} {doc['number']} — {biz.get('business_name') or ''}".strip(" —"), html, biz.get("business_email", ""))
    if doc["status"] == "draft":
        await get_db().documents.update_one({"id": doc_id}, {"$set": {"status": "sent" if doc["doc_type"] != "sales_order" else "confirmed", "sent_at": now()}})
    return {"emailed": emailed, "url": url, "document": await _get(ctx.org_id, doc_id)}


# ------------------------------------------------------------------ public quote page

@router.get("/public/quotes/{token}")
async def public_quote(token: str, request: Request):
    rate_limit(request, "public-quote", 240)
    q = await get_db().documents.find_one({"public_token": token, "doc_type": "quote"}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    biz = await get_business(q["org_id"])
    keep = ("number", "issue_date", "valid_until", "items", "tax_rate", "subtotal", "tax", "total", "currency", "notes", "status",
            "client_name", "client_company", "responded_at", "responded_by")
    return {"quote": {k: q.get(k) for k in keep},
            "business": {k: biz.get(k, "") for k in ("business_name", "business_email", "address", "city", "afm", "logo", "website")}}


class RespondInput(BaseModel):
    action: str
    name: Optional[str] = ""


@router.post("/public/quotes/{token}/respond")
async def respond(token: str, data: RespondInput, request: Request):
    rate_limit(request, "public-quote-respond", 20)
    if data.action not in ("accept", "decline"):
        raise HTTPException(status_code=400, detail="Invalid action")
    q = await get_db().documents.find_one({"public_token": token, "doc_type": "quote"}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Quote not found")
    if q["status"] in ("accepted", "declined"):
        raise HTTPException(status_code=409, detail=f"This quote was already {q['status']}")
    if q.get("valid_until") and q["valid_until"] < today():
        raise HTTPException(status_code=410, detail="This quote has expired — please ask for an updated one")
    status = "accepted" if data.action == "accept" else "declined"
    r = await get_db().documents.update_one({"id": q["id"], "status": {"$nin": ["accepted", "declined"]}},
                                            {"$set": {"status": status, "responded_at": now(), "responded_by": (data.name or "").strip()[:120]}})
    if r.modified_count:
        await notify(q["org_id"], "quote", f"{q.get('client_name') or 'Client'} {status} quote {q['number']} ({money(q['total'], q.get('currency'))})",
                     f"/app/quotes?open={q['id']}")
    return {"status": status}
