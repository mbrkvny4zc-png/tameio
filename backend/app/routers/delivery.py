"""Digital delivery notes (Ψηφιακό Δελτίο Αποστολής, myDATA type 9.3).

Draft -> issue (gets a MARK from AADE) -> print/share with the QR so it travels with the goods.
"""
import hashlib
import random
import secrets
import uuid
from datetime import date
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx
from app.common import next_number
from app.db import get_db, now, today
from app.ratelimit import rate_limit
from app.routers.business import get_business
from app.routers.mydata import _issuer, _next_aa, _post_aade, _settings

router = APIRouter(tags=["delivery"])


class Address(BaseModel):
    street: str = ""
    number: Optional[str] = ""
    postal_code: str = ""
    city: str = ""


class DeliveryItem(BaseModel):
    description: str
    qty: float = 1
    unit: int = 1
    code: Optional[str] = ""


class DeliveryInput(BaseModel):
    move_purpose: int = 1
    other_purpose: Optional[str] = ""
    client_id: Optional[str] = None
    recipient_name: Optional[str] = ""
    recipient_afm: Optional[str] = ""
    loading_address: Address = Address()
    delivery_address: Address = Address()
    dispatch_date: Optional[str] = None
    dispatch_time: Optional[str] = ""
    vehicle_number: Optional[str] = ""
    items: List[DeliveryItem] = []
    notes: Optional[str] = ""
    invoice_id: Optional[str] = None


def _clean(data: DeliveryInput) -> dict:
    try:
        dd = date.fromisoformat((data.dispatch_date or today())[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Dispatch date must be YYYY-MM-DD")
    t = (data.dispatch_time or "").strip()[:5]
    if t and not (len(t) == 5 and t[2] == ":" and t[:2].isdigit() and t[3:].isdigit()):
        raise HTTPException(status_code=400, detail="Dispatch time must be HH:MM")
    items = [{"description": i.description.strip()[:300], "qty": round(i.qty, 3), "unit": i.unit if i.unit in gt.UNITS else 1,
              "code": (i.code or "").strip()[:50]} for i in data.items if i.description.strip()]
    if any(i["qty"] <= 0 for i in items):
        raise HTTPException(status_code=400, detail="Quantities must be above zero")
    addr = lambda a: {k: (getattr(a, k) or "").strip()[:150] for k in ("street", "number", "postal_code", "city")}  # noqa: E731
    return {"move_purpose": data.move_purpose if data.move_purpose in gt.MOVE_PURPOSES else 1,
            "other_purpose": (data.other_purpose or "").strip()[:150], "client_id": data.client_id,
            "recipient_name": (data.recipient_name or "").strip()[:300], "recipient_afm": gt.normalize_afm(data.recipient_afm or ""),
            "loading_address": addr(data.loading_address), "delivery_address": addr(data.delivery_address),
            "dispatch_date": dd, "dispatch_time": t, "vehicle_number": (data.vehicle_number or "").strip().upper()[:20],
            "items": items, "notes": (data.notes or "").strip()[:1000], "invoice_id": data.invoice_id}


async def _get(org_id: str, note_id: str) -> dict:
    n = await get_db().delivery_notes.find_one({"id": note_id, "org_id": org_id}, {"_id": 0})
    if not n:
        raise HTTPException(status_code=404, detail="Delivery note not found")
    return n


def _locked(n: dict) -> bool:
    return (n.get("mydata") or {}).get("state") in ("transmitted", "cancelled")


@router.get("/delivery-notes/meta")
async def meta():
    return {"purposes": gt.MOVE_PURPOSES, "units": gt.UNITS}


@router.get("/delivery-notes")
async def list_notes(ctx: Ctx = Depends(get_ctx)):
    return await get_db().delivery_notes.find({"org_id": ctx.org_id}, {"_id": 0}).sort("created_at", -1).to_list(5000)


@router.get("/delivery-notes/{note_id}")
async def get_note(note_id: str, ctx: Ctx = Depends(get_ctx)):
    return await _get(ctx.org_id, note_id)


@router.post("/delivery-notes")
async def create_note(data: DeliveryInput, ctx: Ctx = Depends(get_ctx)):
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "number": await next_number(ctx.org_id, "delivery", "DN"),
           **_clean(data), "status": "draft", "mydata": None, "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().delivery_notes.insert_one({**doc})
    return doc


@router.post("/delivery-notes/from-invoice/{invoice_id}")
async def from_invoice(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    """Pre-fill a note from an invoice: recipient, delivery address and the invoice lines as goods."""
    inv = await get_db().invoices.find_one({"id": invoice_id, "org_id": ctx.org_id}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    biz = await get_business(ctx.org_id)
    data = DeliveryInput(
        move_purpose=1, client_id=inv.get("client_id"), recipient_name=inv.get("client_company") or inv.get("client_name") or "",
        recipient_afm=inv.get("client_afm") or "", invoice_id=invoice_id,
        loading_address=Address(street=biz.get("address", ""), postal_code=biz.get("postal_code", ""), city=biz.get("city", "")),
        delivery_address=Address(street=inv.get("client_address") or "", postal_code=inv.get("client_postal_code") or "", city=inv.get("client_city") or ""),
        items=[DeliveryItem(description=i["description"], qty=i.get("qty") or 1) for i in inv.get("items") or []])
    return await create_note(data, ctx)


@router.put("/delivery-notes/{note_id}")
async def update_note(note_id: str, data: DeliveryInput, ctx: Ctx = Depends(get_ctx)):
    n = await _get(ctx.org_id, note_id)
    if _locked(n):
        raise HTTPException(status_code=409, detail="This delivery note was issued to AADE and can't be changed")
    await get_db().delivery_notes.update_one({"id": note_id}, {"$set": {**_clean(data), "updated_at": now()}})
    return await _get(ctx.org_id, note_id)


@router.delete("/delivery-notes/{note_id}")
async def delete_note(note_id: str, ctx: Ctx = Depends(get_ctx)):
    n = await _get(ctx.org_id, note_id)
    if _locked(n):
        raise HTTPException(status_code=409, detail="Issued delivery notes must be kept — cancel it instead")
    await get_db().delivery_notes.delete_one({"id": note_id})
    return {"ok": True}


@router.post("/delivery-notes/{note_id}/preview")
async def preview(note_id: str, ctx: Ctx = Depends(get_ctx)):
    n = await _get(ctx.org_id, note_id)
    settings = await _settings(ctx.org_id)
    errors = gt.validate_delivery_note(n, _issuer(settings))
    xml = None if errors else gt.build_delivery_note_doc(n, _issuer(settings), settings.get("delivery_series") or "DA", "(assigned on issue)")
    return {"errors": errors, "xml": xml, "environment": settings.get("environment", "simulation")}


@router.post("/delivery-notes/{note_id}/issue")
async def issue(note_id: str, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    n = await _get(ctx.org_id, note_id)
    if _locked(n):
        raise HTTPException(status_code=409, detail="Already issued")
    settings = await _settings(ctx.org_id)
    env = settings.get("environment", "simulation")
    simulated = env == "simulation"
    errors = gt.validate_delivery_note(n, _issuer(settings))
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Fix these before issuing", "errors": errors})
    lock = await d.delivery_notes.update_one({"id": note_id, "status": {"$ne": "issuing"}}, {"$set": {"status": "issuing"}})
    if not lock.modified_count:
        raise HTTPException(status_code=409, detail="This note is already being issued")
    series = settings.get("delivery_series") or "DA"
    prev = n.get("mydata") or {}
    aa = prev["aa"] if prev.get("aa") and prev.get("series") == series and bool(prev.get("simulated")) == simulated else await _next_aa(ctx.org_id, series, simulated)
    xml = gt.build_delivery_note_doc(n, _issuer(settings), series, aa)
    if simulated:
        result = {"ok": True, "mark": str(400000000000000 + random.randint(0, 99999999999)),
                  "uid": hashlib.sha1(f"{ctx.org_id}{series}{aa}dn".encode()).hexdigest().upper(), "qr_url": "", "errors": []}
    else:
        try:
            resp = await _post_aade(settings, "SendInvoices", xml)
            result = gt.parse_response(resp.text) if resp.status_code not in (401, 403) else \
                {"ok": False, "errors": [{"code": str(resp.status_code), "message": "AADE rejected your credentials"}]}
        except httpx.HTTPError:
            result = {"ok": False, "errors": [{"code": "", "message": "Could not reach AADE. Nothing was issued — try again shortly."}]}
    md = {"series": series, "aa": aa, "environment": env, "simulated": simulated, "errors": result.get("errors", []), "last_attempt_at": now()}
    if result.get("ok"):
        md.update({"state": "transmitted", "mark": result.get("mark"), "uid": result.get("uid"), "qr_url": result.get("qr_url", ""), "transmitted_at": now()})
        status = "issued"
    else:
        md.update({"state": "rejected", "mark": None})
        status = "draft"
    await d.delivery_notes.update_one({"id": note_id}, {"$set": {"mydata": md, "status": status, "issued_at": now() if result.get("ok") else None,
                                                                 "xml": xml[:200_000], "updated_at": now()}})
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail={"message": "AADE did not accept the delivery note",
                                                     "errors": [f"{e['code']} {e['message']}".strip() for e in result.get("errors", [])]})
    return await _get(ctx.org_id, note_id)


@router.post("/delivery-notes/{note_id}/delivered")
async def mark_delivered(note_id: str, ctx: Ctx = Depends(get_ctx)):
    n = await _get(ctx.org_id, note_id)
    if n.get("status") != "issued":
        raise HTTPException(status_code=400, detail="Only issued notes can be marked as delivered")
    await get_db().delivery_notes.update_one({"id": note_id}, {"$set": {"status": "delivered", "delivered_at": now(), "updated_at": now()}})
    return await _get(ctx.org_id, note_id)


@router.post("/delivery-notes/{note_id}/cancel")
async def cancel(note_id: str, ctx: Ctx = Depends(get_ctx)):
    n = await _get(ctx.org_id, note_id)
    md = n.get("mydata") or {}
    if md.get("state") != "transmitted":
        raise HTTPException(status_code=400, detail="Only issued notes can be cancelled")
    if not md.get("simulated"):
        settings = await _settings(ctx.org_id)
        try:
            resp = await _post_aade(settings, "CancelInvoice", params={"mark": md["mark"]})
            result = gt.parse_response(resp.text)
        except httpx.HTTPError:
            result = {"ok": False, "errors": [{"code": "", "message": "Could not reach AADE."}]}
        if not result.get("ok"):
            raise HTTPException(status_code=502, detail={"message": "AADE did not accept the cancellation",
                                                         "errors": [f"{e['code']} {e['message']}".strip() for e in result.get("errors", [])]})
    await get_db().delivery_notes.update_one({"id": note_id}, {"$set": {"mydata.state": "cancelled", "status": "cancelled",
                                                                        "cancelled_at": now(), "updated_at": now()}})
    return await _get(ctx.org_id, note_id)


@router.post("/delivery-notes/{note_id}/share")
async def share(note_id: str, ctx: Ctx = Depends(get_ctx)):
    n = await _get(ctx.org_id, note_id)
    token = n.get("public_token") or secrets.token_urlsafe(24)
    if not n.get("public_token"):
        await get_db().delivery_notes.update_one({"id": note_id}, {"$set": {"public_token": token}})
    return {"url": f"{config.PUBLIC_URL}/d/{token}"}


@router.get("/public/delivery-notes/{token}")
async def public_note(token: str, request: Request):
    """What a driver, the recipient or an inspector sees when they scan the QR on the printed note."""
    rate_limit(request, "public-dn", 240)
    n = await get_db().delivery_notes.find_one({"public_token": token}, {"_id": 0, "xml": 0})
    if not n or n.get("status") == "draft":
        raise HTTPException(status_code=404, detail="Delivery note not found")
    biz = await get_business(n["org_id"])
    keep = ("number", "move_purpose", "other_purpose", "recipient_name", "recipient_afm", "loading_address", "delivery_address",
            "dispatch_date", "dispatch_time", "vehicle_number", "items", "notes", "status")
    md = n.get("mydata") or {}
    return {"note": {k: n.get(k) for k in keep}, "purpose_label": gt.MOVE_PURPOSES.get(n.get("move_purpose"), ""),
            "units": gt.UNITS, "mydata": {k: md.get(k) for k in ("mark", "uid", "qr_url", "simulated", "state")},
            "business": {k: biz.get(k, "") for k in ("business_name", "afm", "doy", "address", "city", "business_phone", "logo")}}
