"""AADE myDATA e-invoicing (Greece).

Modes per workspace:
  * simulation  — no AADE credentials; builds and validates the real XML and
                  issues a clearly-flagged fake MARK so the flow can be tried.
  * sandbox     — transmits to AADE's test environment (mydataapidev).
  * production  — transmits to the live AADE API.

Once an invoice has a real (non-simulated) MARK it is locked: edits/deletes are
refused by app/routers/invoices.py and corrections must go through cancellation.
"""
import base64
import hashlib
import logging
import random
import uuid
from typing import Optional

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now as _now

router = APIRouter(tags=["mydata"])
log = logging.getLogger("mydata")

ENVIRONMENTS = ("simulation", "sandbox", "production")


# ---------------------------------------------------------------- secrets

_fernet: Optional[Fernet] = None


async def _cipher() -> Fernet:
    """Fernet cipher for AADE subscription keys.

    Uses MYDATA_ENCRYPTION_KEY when set (recommended in production). Otherwise a
    key is generated once and stored in `app_secrets` so keys are at least not
    stored in plaintext next to invoices.
    """
    global _fernet
    if _fernet:
        return _fernet
    env_key = config.MYDATA_ENCRYPTION_KEY.strip()
    if env_key:
        key = base64.urlsafe_b64encode(hashlib.sha256(env_key.encode()).digest())
    else:
        doc = await get_db().app_secrets.find_one({"name": "mydata_fernet"}, {"_id": 0})
        if not doc:
            doc = {"name": "mydata_fernet", "key": Fernet.generate_key().decode()}
            await get_db().app_secrets.update_one({"name": "mydata_fernet"}, {"$setOnInsert": doc}, upsert=True)
            doc = await get_db().app_secrets.find_one({"name": "mydata_fernet"}, {"_id": 0})
        key = doc["key"].encode()
    _fernet = Fernet(key)
    return _fernet


async def _decrypt_key(settings: dict) -> str:
    enc = settings.get("subscription_key_enc")
    if not enc:
        return ""
    try:
        return (await _cipher()).decrypt(enc.encode()).decode()
    except InvalidToken:
        return ""


# ---------------------------------------------------------------- settings

class MyDataSettingsInput(BaseModel):
    vat_number: Optional[str] = ""
    branch: Optional[int] = 0
    series: Optional[str] = "A"
    environment: Optional[str] = "simulation"
    aade_user_id: Optional[str] = ""
    subscription_key: Optional[str] = None  # None = keep existing, "" = clear
    series_list: Optional[list] = None  # [{code, label, branch}] — e.g. A = wholesale, B = retail, or one per shop


def _public_settings(doc: dict) -> dict:
    return {
        "vat_number": doc.get("vat_number", ""),
        "branch": doc.get("branch", 0),
        "series": doc.get("series", "A"),
        "environment": doc.get("environment", "simulation"),
        "aade_user_id": doc.get("aade_user_id", ""),
        "has_subscription_key": bool(doc.get("subscription_key_enc")),
        "subscription_key_hint": doc.get("subscription_key_hint", ""),
        "vat_number_valid": gt.is_valid_afm(doc.get("vat_number", "")),
        "series_list": series_list(doc),
    }


def series_list(doc: dict) -> list:
    """All numbering series. The default series (settings.series) is always first."""
    default = {"code": doc.get("series", "A"), "label": "", "branch": int(doc.get("branch") or 0)}
    extra = [x for x in doc.get("series_list") or [] if x.get("code") != default["code"]]
    stored = next((x for x in doc.get("series_list") or [] if x.get("code") == default["code"]), None)
    return [{**default, **(stored or {})}] + extra


def pick_series(settings: dict, wanted: Optional[str]) -> dict:
    options = series_list(settings)
    return next((x for x in options if wanted and x["code"] == wanted), options[0])


async def _settings(ws: str) -> dict:
    doc = await get_db().mydata_settings.find_one({"org_id": ws}, {"_id": 0}) or {"org_id": ws}
    if not doc.get("vat_number"):  # default to the ΑΦΜ in the business profile
        biz = await get_db().business.find_one({"org_id": ws}, {"_id": 0, "afm": 1}) or {}
        doc["vat_number"] = biz.get("afm", "")
    return doc


@router.get("/mydata/settings")
async def get_settings(ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    return _public_settings(await _settings(ws))


@router.put("/mydata/settings")
async def put_settings(data: MyDataSettingsInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    ws = ctx.org_id
    env = data.environment if data.environment in ENVIRONMENTS else "simulation"
    vat = gt.normalize_afm(data.vat_number or "")
    if not vat:  # blank = use the ΑΦΜ from the business profile
        biz = await get_db().business.find_one({"org_id": ws}, {"_id": 0, "afm": 1}) or {}
        vat = biz.get("afm", "")
    if vat and not gt.is_valid_afm(vat):
        raise HTTPException(status_code=400, detail="That ΑΦΜ fails the checksum — please double-check it.")
    series = (data.series or "A").strip()[:20] or "A"
    updates = {"vat_number": vat, "branch": max(0, int(data.branch or 0)), "series": series,
               "environment": env, "aade_user_id": (data.aade_user_id or "").strip(), "updated_at": _now()}
    if data.series_list is not None:
        seen, clean = set(), []
        for x in data.series_list[:20]:
            code = str(x.get("code") or "").strip().upper()[:20]
            if not code or code in seen:
                continue
            if not code.replace("-", "").replace("_", "").isalnum():
                raise HTTPException(status_code=400, detail=f"Series “{code}” may only use letters, digits, - and _")
            seen.add(code)
            try:
                branch = max(0, int(x.get("branch") or 0))
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Branch must be a number (0 = head office)")
            clean.append({"code": code, "label": str(x.get("label") or "").strip()[:60], "branch": branch})
        if series.upper() not in seen and clean:
            series = clean[0]["code"]
            updates["series"] = series
        updates["series_list"] = clean
        updates["branch"] = next((c["branch"] for c in clean if c["code"] == updates["series"]), updates["branch"])
    if data.subscription_key is not None:
        key = data.subscription_key.strip()
        if key:
            updates["subscription_key_enc"] = (await _cipher()).encrypt(key.encode()).decode()
            updates["subscription_key_hint"] = "••••" + key[-4:]
        else:
            updates["subscription_key_enc"] = ""
            updates["subscription_key_hint"] = ""
    if env != "simulation":
        merged = {**await _settings(ws), **updates}
        if not merged.get("aade_user_id") or not merged.get("subscription_key_enc"):
            raise HTTPException(status_code=400, detail="Sandbox/production need your AADE user ID and subscription key.")
        if not gt.is_valid_afm(merged.get("vat_number", "")):
            raise HTTPException(status_code=400, detail="Add a valid business ΑΦΜ before connecting to AADE.")
    await get_db().mydata_settings.update_one({"org_id": ws}, {"$set": updates, "$setOnInsert": {"org_id": ws}}, upsert=True)
    return _public_settings(await _settings(ws))


@router.get("/mydata/codes")
async def get_codes():
    return {
        "invoice_types": [{"code": k, "label": v} for k, v in gt.INVOICE_TYPES.items()],
        "retail_types": sorted(gt.RETAIL_TYPES),
        "foreign_types": sorted(gt.FOREIGN_TYPES),
        "payment_methods": [{"code": k, "label": v} for k, v in gt.PAYMENT_METHODS.items()],
        "vat_rates": sorted(gt.VAT_CATEGORIES.keys(), reverse=True),
        "default_classification": {k: {"category": c, "type": t} for k, (c, t) in gt.DEFAULT_CLASSIFICATION.items()},
    }


# ---------------------------------------------------------------- per-invoice

class MyDataInput(BaseModel):
    invoice_type: str = "2.1"
    payment_method: int = 1
    counterpart_vat: Optional[str] = ""
    counterpart_country: Optional[str] = "GR"
    counterpart_branch: Optional[int] = 0
    counterpart_name: Optional[str] = ""
    counterpart_street: Optional[str] = ""
    counterpart_city: Optional[str] = ""
    counterpart_postal_code: Optional[str] = ""
    vat_exemption_category: Optional[int] = None
    classification_category: Optional[str] = ""
    classification_type: Optional[str] = ""
    correlated_mark: Optional[str] = ""
    series: Optional[str] = ""


def _effective_md(inv: dict, md: dict) -> dict:
    """For credit notes the type, linked MARK and classification are fixed by the original invoice."""
    if inv.get("kind") == "credit_note":
        locked = inv.get("mydata") or {}
        for k in ("invoice_type", "correlated_mark", "classification_category", "classification_type"):
            md[k] = locked.get(k)
    elif md.get("invoice_type") in gt.CREDIT_TYPES:
        md["invoice_type"] = ""  # credit notes are created from an invoice, not by retyping one
    return md


async def _load_invoice(ws: str, invoice_id: str) -> dict:
    inv = await get_db().invoices.find_one({"id": invoice_id, "org_id": ws}, {"_id": 0})
    if not inv:
        raise HTTPException(status_code=404, detail="Invoice not found")
    return inv


def _issuer(settings: dict, branch: Optional[int] = None) -> dict:
    return {"vat_number": settings.get("vat_number", ""), "branch": settings.get("branch", 0) if branch is None else branch}


async def _next_aa(ws: str, series: str, simulated: bool) -> str:
    """Gap-free, per-series sequence (simulation uses a separate counter)."""
    key = f"{ws}|{'sim:' if simulated else ''}{series}"
    from pymongo import ReturnDocument
    doc = await get_db().mydata_counters.find_one_and_update(
        {"key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return str(doc["seq"])


@router.post("/invoices/{invoice_id}/mydata/preview")
async def preview(invoice_id: str, data: MyDataInput, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    inv = await _load_invoice(ws, invoice_id)
    settings = await _settings(ws)
    md = _effective_md(inv, data.model_dump())
    ser = pick_series(settings, data.series or (inv.get("mydata") or {}).get("series"))
    errors = gt.validate_for_mydata(inv, _issuer(settings, ser["branch"]), md)
    xml = None
    if not errors:
        reserved = (inv.get("mydata") or {})
        xml = gt.build_invoices_doc(inv, _issuer(settings, ser["branch"]), md, ser["code"], reserved.get("aa") or "(assigned on send)")
    lines = gt.compute_lines(inv)
    net = sum(float(l["net"]) for l in lines)
    vat = sum(float(l["vat"]) for l in lines)
    return {"errors": errors, "xml": xml, "totals": {"net": round(net, 2), "vat": round(vat, 2), "gross": round(net + vat, 2)},
            "environment": settings.get("environment", "simulation")}


async def _post_aade(settings: dict, path: str, body: str = "", params: dict = None) -> httpx.Response:
    env = settings.get("environment")
    base = gt.ENDPOINTS[env]
    headers = {"aade-user-id": settings.get("aade_user_id", ""),
               "Ocp-Apim-Subscription-Key": await _decrypt_key(settings),
               "Content-Type": "application/xml"}
    async with httpx.AsyncClient(timeout=30) as client:
        return await client.post(f"{base}/{path}", content=body.encode("utf-8"), headers=headers, params=params)


async def _log(ws: str, user_id: str, invoice: dict, action: str, environment: str, result: dict, xml: str = ""):
    await get_db().mydata_transmissions.insert_one({
        "id": str(uuid.uuid4()), "org_id": ws, "user_id": user_id,
        "invoice_id": invoice["id"], "invoice_number": invoice.get("number"),
        "client_name": invoice.get("client_name"), "action": action, "environment": environment,
        "ok": bool(result.get("ok")), "status": result.get("status"), "mark": result.get("mark") or result.get("cancellation_mark"),
        "errors": result.get("errors", []), "xml": xml[:200_000], "created_at": _now(),
    })


@router.post("/invoices/{invoice_id}/mydata/submit")
async def submit(invoice_id: str, data: MyDataInput, ctx: Ctx = Depends(get_ctx)):
    user_id, ws = ctx.user_id, ctx.org_id
    inv = await _load_invoice(ws, invoice_id)
    settings = await _settings(ws)
    env = settings.get("environment", "simulation")
    simulated = env == "simulation"
    if inv.get("sample") or inv.get("imported"):
        raise HTTPException(status_code=400, detail="Sample and imported invoices can't be sent to myDATA")
    existing = inv.get("mydata") or {}
    if existing.get("mark") and existing.get("state") == "transmitted":
        if not existing.get("simulated") or simulated:
            raise HTTPException(status_code=409, detail="This invoice already has a MARK. Cancel it first to re-issue.")
    md = _effective_md(inv, data.model_dump())
    # Card-terminal payment details recorded before issuing (e-POS) travel with the receipt.
    for k in ("transaction_id", "terminal_id"):
        if existing.get(k):
            md[k] = existing[k]
    ser = pick_series(settings, data.series or existing.get("series"))
    issuer = _issuer(settings, ser["branch"])
    errors = gt.validate_for_mydata(inv, issuer, md)
    if inv.get("kind") == "credit_note" and not errors:
        original = await get_db().invoices.find_one({"id": inv.get("credit_of"), "org_id": ws}, {"_id": 0}) or {}
        omd = original.get("mydata") or {}
        if omd.get("state") != "transmitted":
            errors.append("The credited invoice is no longer active at AADE (it was cancelled).")
        elif bool(omd.get("simulated")) != simulated:
            errors.append("The credited invoice was only simulated — it has no real MARK to reference. Send it to AADE first.")
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Fix these before sending to AADE", "errors": errors})

    # Lock against double submission.
    lock = await get_db().invoices.update_one(
        {"id": invoice_id, "org_id": ws, "mydata.state": {"$ne": "transmitting"}},
        {"$set": {"mydata.state": "transmitting"}})
    if lock.matched_count == 0:
        raise HTTPException(status_code=409, detail="This invoice is already being transmitted.")

    series = ser["code"]
    # Reuse a number reserved by a previous failed attempt in the same mode, so rejections leave no gaps.
    if existing.get("aa") and existing.get("series") == series and bool(existing.get("simulated")) == simulated and not existing.get("mark"):
        aa = existing["aa"]
    else:
        aa = await _next_aa(ws, series, simulated)
    xml = gt.build_invoices_doc(inv, issuer, md, series, aa)

    if simulated:
        result = {"ok": True, "status": "Success", "mark": str(400000000000000 + random.randint(0, 99999999999)),
                  "uid": hashlib.sha1(f"{ws}{series}{aa}".encode()).hexdigest().upper(), "qr_url": "", "errors": []}
    else:
        try:
            resp = await _post_aade(settings, "SendInvoices", xml)
            if resp.status_code in (401, 403):
                result = {"ok": False, "status": "AuthError", "errors": [{"code": str(resp.status_code), "message": "AADE rejected your credentials — check user ID and subscription key."}]}
            else:
                result = gt.parse_response(resp.text)
        except httpx.HTTPError as e:
            log.warning("AADE transmission failed: %s", e)
            result = {"ok": False, "status": "NetworkError", "errors": [{"code": "", "message": "Could not reach AADE. Nothing was issued — try again shortly."}]}

    new_md = {**md, "series": series, "branch": ser["branch"], "aa": aa, "environment": env, "simulated": simulated,
              "last_attempt_at": _now(), "errors": result.get("errors", [])}
    if result.get("ok"):
        new_md.update({"state": "transmitted", "mark": result.get("mark"), "uid": result.get("uid"),
                       "qr_url": result.get("qr_url", ""), "transmitted_at": _now()})
    else:
        new_md.update({"state": "rejected", "mark": None})
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": {"mydata": new_md, "updated_at": _now()}})
    await _log(ws, user_id, inv, "send", env, result, xml)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail={"message": "AADE did not accept the invoice", "errors": [f"{e['code']} {e['message']}".strip() for e in result.get("errors", [])]})
    return await _load_invoice(ws, invoice_id)


@router.post("/invoices/{invoice_id}/mydata/cancel")
async def cancel(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    user_id, ws = ctx.user_id, ctx.org_id
    inv = await _load_invoice(ws, invoice_id)
    md = inv.get("mydata") or {}
    if md.get("state") != "transmitted" or not md.get("mark"):
        raise HTTPException(status_code=400, detail="Only transmitted invoices can be cancelled.")
    live_credits = await get_db().invoices.find_one({"org_id": ws, "kind": "credit_note", "credit_of": invoice_id, "mydata.state": "transmitted"}, {"_id": 0, "number": 1})
    if live_credits:
        raise HTTPException(status_code=409, detail=f"Credit note {live_credits['number']} references this invoice. Cancel the credit note first.")
    settings = await _settings(ws)
    if md.get("simulated"):
        result = {"ok": True, "status": "Success", "cancellation_mark": str(400000000000000 + random.randint(0, 99999999999)), "errors": []}
    else:
        if settings.get("environment") != md.get("environment"):
            raise HTTPException(status_code=400, detail=f"This invoice was sent to AADE {md.get('environment')}; switch settings back to cancel it.")
        try:
            resp = await _post_aade(settings, "CancelInvoice", params={"mark": md["mark"]})
            result = gt.parse_response(resp.text)
        except httpx.HTTPError:
            result = {"ok": False, "status": "NetworkError", "errors": [{"code": "", "message": "Could not reach AADE."}]}
    await _log(ws, user_id, inv, "cancel", md.get("environment"), result)
    if not result.get("ok"):
        raise HTTPException(status_code=502, detail={"message": "AADE did not accept the cancellation", "errors": [f"{e['code']} {e['message']}".strip() for e in result.get("errors", [])]})
    await get_db().invoices.update_one({"id": invoice_id}, {"$set": {
        "mydata.state": "cancelled", "mydata.cancellation_mark": result.get("cancellation_mark"),
        "mydata.cancelled_at": _now(), "updated_at": _now()}})
    return await _load_invoice(ws, invoice_id)


@router.get("/invoices/{invoice_id}/mydata/xml")
async def download_xml(invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    entry = await get_db().mydata_transmissions.find_one(
        {"org_id": ws, "invoice_id": invoice_id, "action": "send", "ok": True},
        {"_id": 0}, sort=[("created_at", -1)])
    if not entry:
        raise HTTPException(status_code=404, detail="No transmitted XML for this invoice")
    return Response(entry["xml"], media_type="application/xml",
                    headers={"Content-Disposition": f'attachment; filename="{entry.get("invoice_number") or invoice_id}-mydata.xml"'})


@router.get("/mydata/transmissions")
async def transmissions(ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    return await get_db().mydata_transmissions.find({"org_id": ws}, {"_id": 0, "xml": 0}).sort("created_at", -1).to_list(200)


@router.get("/mydata/stats")
async def stats(ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    invoices = await get_db().invoices.find({"org_id": ws}, {"_id": 0, "mydata": 1, "status": 1, "total": 1}).to_list(5000)
    out = {"transmitted": 0, "rejected": 0, "cancelled": 0, "pending": 0, "simulated": 0}
    for inv in invoices:
        md = inv.get("mydata") or {}
        state = md.get("state")
        if state in ("transmitted", "rejected", "cancelled"):
            out[state] += 1
            if md.get("simulated"):
                out["simulated"] += 1
        elif inv.get("status") != "draft":
            out["pending"] += 1
    return out
