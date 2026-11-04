"""Business profile (shown on documents) and customers."""
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import greek_tax as gt
from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now

router = APIRouter(tags=["business"])

BUSINESS_FIELDS = ["business_name", "business_email", "business_phone", "address", "city", "postal_code", "website",
                   "afm", "doy", "iban", "payment_instructions", "logo"]


class BusinessInput(BaseModel):
    business_name: Optional[str] = ""
    business_email: Optional[str] = ""
    business_phone: Optional[str] = ""
    address: Optional[str] = ""
    city: Optional[str] = ""
    postal_code: Optional[str] = ""
    website: Optional[str] = ""
    afm: Optional[str] = ""
    doy: Optional[str] = ""
    iban: Optional[str] = ""
    payment_instructions: Optional[str] = ""
    logo: Optional[str] = ""
    default_tax_rate: Optional[float] = 24


async def get_business(org_id: str) -> dict:
    doc = await get_db().business.find_one({"org_id": org_id}, {"_id": 0}) or {}
    return {**{k: "" for k in BUSINESS_FIELDS}, "default_tax_rate": 24, **doc}


@router.get("/business")
async def read_business(ctx: Ctx = Depends(get_ctx)):
    return await get_business(ctx.org_id)


@router.put("/business")
async def update_business(data: BusinessInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    fields = {k: (getattr(data, k) or "").strip() for k in BUSINESS_FIELDS}
    fields["afm"] = gt.normalize_afm(fields["afm"])
    fields["iban"] = gt.normalize_iban(fields["iban"])
    if fields["afm"] and not gt.is_valid_afm(fields["afm"]):
        raise HTTPException(status_code=400, detail="That ΑΦΜ fails the checksum — please double-check it")
    if fields["iban"] and not gt.is_valid_iban(fields["iban"]):
        raise HTTPException(status_code=400, detail="That IBAN is not valid")
    if fields["logo"] and (len(fields["logo"]) > 700_000 or not fields["logo"].startswith("data:image/")):
        raise HTTPException(status_code=400, detail="Logo must be an image under ~500 KB")
    fields["default_tax_rate"] = data.default_tax_rate if data.default_tax_rate in gt.VAT_CATEGORIES else 24
    await get_db().business.update_one({"org_id": ctx.org_id}, {"$set": {**fields, "updated_at": now()}}, upsert=True)
    return await get_business(ctx.org_id)


# ------------------------------------------------------------------ clients

class ClientInput(BaseModel):
    name: str
    company: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    afm: Optional[str] = ""
    doy: Optional[str] = ""
    country: Optional[str] = "GR"
    address: Optional[str] = ""
    city: Optional[str] = ""
    postal_code: Optional[str] = ""
    notes: Optional[str] = ""


def _clean_client(data: ClientInput) -> dict:
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Client name is required")
    country = (data.country or "GR").upper()[:2]
    afm = gt.normalize_afm(data.afm or "") if country == "GR" else (data.afm or "").strip().upper()
    if afm and country == "GR" and not gt.is_valid_afm(afm):
        raise HTTPException(status_code=400, detail="Client ΑΦΜ fails the checksum")
    out = {k: (getattr(data, k) or "").strip()[:500] for k in ("name", "company", "email", "phone", "doy", "address", "city", "postal_code", "notes")}
    return {**out, "afm": afm, "country": country}


@router.get("/clients")
async def list_clients(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    clients = await d.clients.find({"org_id": ctx.org_id}, {"_id": 0}).sort("name", 1).to_list(5000)
    # Lifetime revenue per client (net of credit notes)
    agg = {}
    for inv in await d.invoices.find({"org_id": ctx.org_id, "status": {"$in": ["sent", "paid", "overdue", "credited"]}},
                                     {"_id": 0, "client_id": 1, "total": 1, "kind": 1, "status": 1}).to_list(20000):
        cid = inv.get("client_id")
        if not cid:
            continue
        sign = -1 if inv.get("kind") == "credit_note" else 1
        a = agg.setdefault(cid, {"billed": 0.0, "outstanding": 0.0})
        a["billed"] += sign * (inv.get("total") or 0)
        if inv.get("status") in ("sent", "overdue"):
            a["outstanding"] += inv.get("total") or 0
    for c in clients:
        c["stats"] = {k: round(v, 2) for k, v in agg.get(c["id"], {"billed": 0, "outstanding": 0}).items()}
    return clients


@router.post("/clients")
async def create_client(data: ClientInput, ctx: Ctx = Depends(get_ctx)):
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, **_clean_client(data), "created_at": now(), "updated_at": now()}
    await get_db().clients.insert_one({**doc})
    return doc


@router.put("/clients/{client_id}")
async def update_client(client_id: str, data: ClientInput, ctx: Ctx = Depends(get_ctx)):
    r = await get_db().clients.update_one({"id": client_id, "org_id": ctx.org_id}, {"$set": {**_clean_client(data), "updated_at": now()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Client not found")
    return await get_db().clients.find_one({"id": client_id}, {"_id": 0})


@router.delete("/clients/{client_id}")
async def delete_client(client_id: str, ctx: Ctx = Depends(get_ctx)):
    r = await get_db().clients.delete_one({"id": client_id, "org_id": ctx.org_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Client not found")
    return {"ok": True}


async def client_snapshot(org_id: str, client_id: Optional[str]) -> dict:
    """Copy client details onto a document so later client edits don't rewrite issued paperwork."""
    if not client_id:
        return {}
    c = await get_db().clients.find_one({"id": client_id, "org_id": org_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=400, detail="Client not found")
    return {"client_id": c["id"], "client_name": c["name"], "client_company": c.get("company", ""), "client_email": c.get("email", ""),
            "client_afm": c.get("afm", ""), "client_country": c.get("country", "GR"), "client_address": c.get("address", ""),
            "client_city": c.get("city", ""), "client_postal_code": c.get("postal_code", "")}
