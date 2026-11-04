"""Supplier onboarding & compliance.

Companies invite a supplier; the supplier fills in their details and uploads the
required documents through a tokenised public portal (no account needed).
Staff review each document, expiry dates are tracked, reminders go out before
anything lapses, and a payment check flags suppliers whose papers are not in
order before money leaves the account.
"""
import html
import re
import secrets
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx, require_role
from app.plans import enforce
from app.db import get_db, now as _now
from app.mailer import layout, send
from app.notify import notify
from app.ratelimit import rate_limit as _rate_limit

router = APIRouter(tags=["suppliers"])

SUPPLIER_DIR = config.UPLOAD_DIR / "suppliers"
MAX_FILE_BYTES = 10 * 1024 * 1024
ALLOWED_EXT = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".docx", ".xlsx"}
MAGIC = {
    ".pdf": [b"%PDF"], ".png": [b"\x89PNG"], ".jpg": [b"\xff\xd8\xff"], ".jpeg": [b"\xff\xd8\xff"],
    ".webp": [b"RIFF"], ".docx": [b"PK\x03\x04"], ".xlsx": [b"PK\x03\x04"],
}
EXPIRING_DAYS = 30
REMINDER_THRESHOLDS = (30, 7, 0)
STATUSES = ("invited", "submitted", "approved", "rejected", "suspended")

DEFAULT_REQUIREMENTS = [
    {"key": "tax_clearance", "label": "Tax clearance certificate (Φορολογική ενημερότητα)", "required": True, "has_expiry": True,
     "help": "Issued via myAADE. Upload the current certificate and enter its expiry date."},
    {"key": "social_security_clearance", "label": "Social security clearance (Ασφαλιστική ενημερότητα e-ΕΦΚΑ)", "required": True, "has_expiry": True,
     "help": "Issued via e-ΕΦΚΑ. Upload the current certificate and enter its expiry date."},
    {"key": "gemi_certificate", "label": "Business registry certificate (ΓΕΜΗ)", "required": True, "has_expiry": False,
     "help": "Recent registry extract showing legal representatives."},
    {"key": "contract", "label": "Signed supplier agreement", "required": True, "has_expiry": True,
     "help": "Signed copy. The expiry date is the contract renewal date."},
    {"key": "insurance", "label": "Liability insurance policy", "required": False, "has_expiry": True,
     "help": "Policy schedule showing cover and end date."},
    {"key": "bank_confirmation", "label": "Bank account confirmation (IBAN)", "required": False, "has_expiry": False,
     "help": "Bank letter or statement header confirming the account holder and IBAN."},
]

# --------------------------------------------------------------- requirements

async def _requirements(ws: str) -> list:
    doc = await get_db().supplier_requirements.find_one({"org_id": ws}, {"_id": 0})
    return doc["items"] if doc and doc.get("items") else [dict(r) for r in DEFAULT_REQUIREMENTS]


class RequirementInput(BaseModel):
    key: Optional[str] = ""
    label: str
    required: bool = True
    has_expiry: bool = False
    help: Optional[str] = ""


class RequirementsInput(BaseModel):
    items: List[RequirementInput]


@router.get("/suppliers/requirements")
async def get_requirements(ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    return await _requirements(ws)


@router.put("/suppliers/requirements")
async def put_requirements(data: RequirementsInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    ws = ctx.org_id
    items, seen = [], set()
    for r in data.items:
        label = r.label.strip()
        if not label:
            continue
        key = (r.key or "").strip() or re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")[:40] or uuid.uuid4().hex[:8]
        if key in seen:
            key = f"{key}_{uuid.uuid4().hex[:4]}"
        seen.add(key)
        items.append({"key": key, "label": label[:120], "required": r.required, "has_expiry": r.has_expiry, "help": (r.help or "").strip()[:300]})
    if not items:
        raise HTTPException(status_code=400, detail="Keep at least one requirement")
    await get_db().supplier_requirements.update_one({"org_id": ws}, {"$set": {"items": items, "updated_at": _now()}}, upsert=True)
    return items


# --------------------------------------------------------------- compliance

def _days_left(expiry: Optional[str], today: Optional[date] = None) -> Optional[int]:
    if not expiry:
        return None
    try:
        return (date.fromisoformat(expiry[:10]) - (today or datetime.now(timezone.utc).date())).days
    except ValueError:
        return None


def compute_compliance(supplier: dict, requirements: list, today: Optional[date] = None) -> dict:
    """Per-requirement state + overall verdict for one supplier."""
    applicable = supplier.get("requirement_keys")
    reqs = [r for r in requirements if applicable is None or r["key"] in applicable]
    docs = supplier.get("documents") or []
    items, blocking, attention = [], [], []
    next_expiry = None
    for r in reqs:
        candidates = [d for d in docs if d.get("requirement_key") == r["key"] and d.get("status") != "superseded"]
        latest = max(candidates, key=lambda d: d.get("uploaded_at", ""), default=None)
        approved = [d for d in candidates if d.get("status") == "approved"]
        best = max(approved, key=lambda d: d.get("expiry_date") or "9999", default=None)
        days = _days_left((best or {}).get("expiry_date"), today) if r.get("has_expiry") else None
        if best and r.get("has_expiry") and days is not None and days < 0:
            state = "expired"
        elif best and r.get("has_expiry") and days is not None and days <= EXPIRING_DAYS:
            state = "expiring"
        elif best:
            state = "valid"
        elif latest and latest.get("status") == "pending":
            state = "pending_review"
        elif latest and latest.get("status") == "rejected":
            state = "rejected"
        else:
            state = "missing"
        # A newer pending upload on top of an approved doc still needs review.
        if best and latest and latest is not best and latest.get("status") == "pending":
            attention.append(f"{r['label']}: new upload awaiting review")
        if best and days is not None and days >= 0:
            next_expiry = min(next_expiry, best["expiry_date"]) if next_expiry else best["expiry_date"]
        items.append({"key": r["key"], "label": r["label"], "required": r["required"], "has_expiry": r.get("has_expiry", False),
                      "state": state, "expiry_date": (best or {}).get("expiry_date"), "days_left": days,
                      "document_id": (best or latest or {}).get("id")})
        if r["required"] and state in ("missing", "rejected", "expired"):
            blocking.append(f"{r['label']}: {state.replace('_', ' ')}")
        elif r["required"] and state == "pending_review":
            blocking.append(f"{r['label']}: awaiting your review")
        elif state in ("pending_review", "expiring") or (not r["required"] and state in ("expired", "rejected")):
            attention.append(f"{r['label']}: {state.replace('_', ' ')}")
    profile_issues = []
    if not gt.is_valid_afm(supplier.get("afm", "")) and (supplier.get("country") or "GR") == "GR":
        profile_issues.append("Valid ΑΦΜ (tax number) missing")
    if supplier.get("iban") and not gt.is_valid_iban(supplier["iban"]):
        profile_issues.append("IBAN fails validation")
    if not supplier.get("iban"):
        profile_issues.append("IBAN missing")
    blocking = profile_issues + blocking
    verdict = "blocked" if blocking else ("attention" if attention else "compliant")
    done = sum(1 for i in items if i["state"] in ("valid", "expiring"))
    return {"verdict": verdict, "blocking": blocking, "attention": attention, "items": items,
            "progress": {"done": done, "total": len(items)}, "next_expiry": next_expiry}


def _public_supplier(s: dict) -> dict:
    return {k: v for k, v in s.items() if k not in ("token",)}


async def _get_supplier(ws: str, supplier_id: str) -> dict:
    s = await get_db().suppliers.find_one({"id": supplier_id, "org_id": ws}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Supplier not found")
    return s


async def _with_compliance(s: dict, reqs: list) -> dict:
    out = _public_supplier(s)
    out["compliance"] = compute_compliance(s, reqs)
    return out


# --------------------------------------------------------------- supplier CRUD

class SupplierInput(BaseModel):
    name: str
    email: Optional[str] = ""
    contact_name: Optional[str] = ""
    phone: Optional[str] = ""
    afm: Optional[str] = ""
    doy: Optional[str] = ""
    country: Optional[str] = "GR"
    address: Optional[str] = ""
    iban: Optional[str] = ""
    category: Optional[str] = ""
    notes: Optional[str] = ""
    requirement_keys: Optional[List[str]] = None


def _clean_profile(data, partial_supplier: bool = False) -> dict:
    afm = gt.normalize_afm(data.afm or "")
    iban = gt.normalize_iban(data.iban or "")
    country = (data.country or "GR").upper()[:2]
    if afm and country == "GR" and not gt.is_valid_afm(afm):
        raise HTTPException(status_code=400, detail="ΑΦΜ fails the checksum — please double-check it.")
    if iban and not gt.is_valid_iban(iban):
        raise HTTPException(status_code=400, detail="IBAN is not valid — please double-check it.")
    out = {"afm": afm, "iban": iban, "country": country}
    for f in ("email", "contact_name", "phone", "doy", "address"):
        out[f] = (getattr(data, f, "") or "").strip()[:300]
    if not partial_supplier:
        out["name"] = data.name.strip()[:200]
        out["category"] = (data.category or "").strip()[:80]
        out["notes"] = (data.notes or "").strip()[:2000]
    return out


@router.get("/suppliers")
async def list_suppliers(ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    reqs = await _requirements(ws)
    suppliers = await get_db().suppliers.find({"org_id": ws}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return [await _with_compliance(s, reqs) for s in suppliers]


@router.post("/suppliers")
async def create_supplier(data: SupplierInput, ctx: Ctx = Depends(get_ctx)):
    user_id, ws = ctx.user_id, ctx.org_id
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Supplier name is required")
    await enforce(ctx.org_id, "suppliers")
    profile = _clean_profile(data)
    if profile["afm"]:
        dup = await get_db().suppliers.find_one({"org_id": ws, "afm": profile["afm"]}, {"_id": 0, "name": 1})
        if dup:
            raise HTTPException(status_code=409, detail=f"A supplier with this ΑΦΜ already exists ({dup['name']}).")
    doc = {"id": str(uuid.uuid4()), "org_id": ws, "user_id": user_id, **profile,
           "requirement_keys": data.requirement_keys, "status": "invited", "documents": [],
           "token": secrets.token_urlsafe(24), "created_at": _now(), "updated_at": _now()}
    await get_db().suppliers.insert_one({**doc})
    return await _with_compliance(doc, await _requirements(ws))


@router.put("/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, data: SupplierInput, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    await _get_supplier(ws, supplier_id)
    profile = _clean_profile(data)
    if profile["afm"]:
        dup = await get_db().suppliers.find_one({"org_id": ws, "afm": profile["afm"], "id": {"$ne": supplier_id}}, {"_id": 0, "name": 1})
        if dup:
            raise HTTPException(status_code=409, detail=f"A supplier with this ΑΦΜ already exists ({dup['name']}).")
    await get_db().suppliers.update_one({"id": supplier_id}, {"$set": {**profile, "requirement_keys": data.requirement_keys, "updated_at": _now()}})
    return await _with_compliance(await _get_supplier(ws, supplier_id), await _requirements(ws))


@router.delete("/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    s = await _get_supplier(ws, supplier_id)
    for d in s.get("documents") or []:
        try:
            (SUPPLIER_DIR / d["stored_name"]).unlink(missing_ok=True)
        except Exception:
            pass
    await get_db().suppliers.delete_one({"id": supplier_id})
    return {"message": "deleted"}


class StatusInput(BaseModel):
    status: str
    note: Optional[str] = ""
    force: bool = False


@router.put("/suppliers/{supplier_id}/status")
async def set_status(supplier_id: str, data: StatusInput, ctx: Ctx = Depends(get_ctx)):
    user_id, ws = ctx.user_id, ctx.org_id
    if data.status not in STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    s = await _get_supplier(ws, supplier_id)
    if data.status == "approved" and not data.force:
        comp = compute_compliance(s, await _requirements(ws))
        if comp["blocking"]:
            raise HTTPException(status_code=409, detail={"message": "Supplier is not compliant yet", "errors": comp["blocking"]})
    await get_db().suppliers.update_one({"id": supplier_id}, {"$set": {
        "status": data.status, "status_note": (data.note or "").strip()[:500], "updated_at": _now(),
        **({"approved_at": _now(), "approved_by": user_id} if data.status == "approved" else {})}})
    return await _with_compliance(await _get_supplier(ws, supplier_id), await _requirements(ws))


@router.post("/suppliers/{supplier_id}/rotate-link")
async def rotate_link(supplier_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    await _get_supplier(ws, supplier_id)
    token = secrets.token_urlsafe(24)
    await get_db().suppliers.update_one({"id": supplier_id}, {"$set": {"token": token}})
    return {"portal_url": _portal_url(token)}


def _portal_url(token: str) -> str:
    return f"{config.PUBLIC_URL}/s/{token}"


@router.get("/suppliers/{supplier_id}/link")
async def get_link(supplier_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    s = await _get_supplier(ws, supplier_id)
    return {"portal_url": _portal_url(s["token"])}


async def _send_supplier_email(ws: str, s: dict, subject: str, intro_html: str, cta: str) -> bool:
    if not (s.get("email") or "").strip():
        return False
    biz = await get_db().business.find_one({"org_id": ws}, {"_id": 0}) or {}
    company = biz.get("business_name") or "Your customer"
    body = (f'<p style="margin:0 0 14px;color:#3A4358;">Hello {html.escape(s.get("contact_name") or s.get("name") or "")},</p>'
            f'<div style="color:#3A4358;font-size:14px;">{intro_html}</div>'
            f'<p style="margin:14px 0 0;color:#5B6478;font-size:12px;">Sent on behalf of {html.escape(company)}. No account or password needed — the link is private to your company.</p>')
    return await send(s["email"].strip(), f"{subject} — {company}", layout(subject, body, cta, _portal_url(s["token"]), company),
                      biz.get("business_email", ""))


@router.post("/suppliers/{supplier_id}/invite")
async def invite(supplier_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    s = await _get_supplier(ws, supplier_id)
    reqs = [r for r in await _requirements(ws) if s.get("requirement_keys") is None or r["key"] in s["requirement_keys"]]
    listing = "".join(f"<li>{html.escape(r['label'])}{'' if r['required'] else ' (optional)'}</li>" for r in reqs)
    sent = await _send_supplier_email(ws, s, "Please complete your supplier onboarding",
                                      f"<p>To set you up as a supplier we need a few details and documents:</p><ul>{listing}</ul>",
                                      "Open supplier portal")
    await get_db().suppliers.update_one({"id": supplier_id}, {"$set": {"invited_at": _now()}})
    return {"emailed": sent, "portal_url": _portal_url(s["token"])}


# --------------------------------------------------------------- documents

def _safe_name(name: str) -> str:
    base = re.sub(r"[^\w.\- ]+", "_", Path(name or "document").name)[:120]
    return base or "document"


async def _store_upload(file: UploadFile) -> dict:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail="Upload a PDF, image, Word or Excel file.")
    content = await file.read(MAX_FILE_BYTES + 1)
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 10 MB.")
    if not content or not any(content.startswith(m) for m in MAGIC[ext]):
        raise HTTPException(status_code=400, detail="File content does not match its type.")
    SUPPLIER_DIR.mkdir(parents=True, exist_ok=True)
    stored = f"{uuid.uuid4().hex}{ext}"
    (SUPPLIER_DIR / stored).write_bytes(content)
    return {"filename": _safe_name(file.filename), "stored_name": stored, "size": len(content), "content_type": file.content_type or ""}


def _validate_expiry(req: dict, expiry_date: Optional[str]) -> Optional[str]:
    if not req.get("has_expiry"):
        return None
    if not expiry_date:
        raise HTTPException(status_code=400, detail=f"Enter the expiry date for: {req['label']}")
    try:
        d = date.fromisoformat(expiry_date[:10])
    except ValueError:
        raise HTTPException(status_code=400, detail="Expiry date must be YYYY-MM-DD")
    if d < datetime.now(timezone.utc).date():
        raise HTTPException(status_code=400, detail="That document has already expired — please upload the current one.")
    return d.isoformat()


async def _add_document(ws: str, s: dict, requirement_key: str, expiry_date: Optional[str], file: UploadFile, by: str, status: str) -> dict:
    reqs = {r["key"]: r for r in await _requirements(ws)}
    req = reqs.get(requirement_key)
    if not req:
        raise HTTPException(status_code=400, detail="Unknown document type")
    expiry = _validate_expiry(req, expiry_date)
    stored = await _store_upload(file)
    doc = {"id": str(uuid.uuid4()), "requirement_key": requirement_key, **stored, "expiry_date": expiry,
           "status": status, "uploaded_by": by, "uploaded_at": _now()}
    if status == "approved":
        doc["reviewed_at"] = _now()
    await get_db().suppliers.update_one({"id": s["id"]}, {"$push": {"documents": doc}, "$set": {"updated_at": _now()}})
    return doc


@router.post("/suppliers/{supplier_id}/documents")
async def staff_upload(supplier_id: str, requirement_key: str = Form(...), expiry_date: Optional[str] = Form(None),
                       file: UploadFile = File(...), ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    s = await _get_supplier(ws, supplier_id)
    await _add_document(ws, s, requirement_key, expiry_date, file, "staff", "approved")
    return await _with_compliance(await _get_supplier(ws, supplier_id), await _requirements(ws))


class ReviewInput(BaseModel):
    status: str
    note: Optional[str] = ""
    expiry_date: Optional[str] = None


@router.put("/suppliers/{supplier_id}/documents/{doc_id}/review")
async def review_document(supplier_id: str, doc_id: str, data: ReviewInput, ctx: Ctx = Depends(get_ctx)):
    user_id, ws = ctx.user_id, ctx.org_id
    if data.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be approved or rejected")
    s = await _get_supplier(ws, supplier_id)
    doc = next((d for d in s.get("documents") or [] if d["id"] == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if data.status == "rejected" and not (data.note or "").strip():
        raise HTTPException(status_code=400, detail="Tell the supplier why the document was rejected")
    sets = {"documents.$.status": data.status, "documents.$.review_note": (data.note or "").strip()[:500],
            "documents.$.reviewed_at": _now(), "documents.$.reviewed_by": user_id}
    if data.expiry_date:
        try:
            sets["documents.$.expiry_date"] = date.fromisoformat(data.expiry_date[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="Expiry date must be YYYY-MM-DD")
    await get_db().suppliers.update_one({"id": supplier_id, "documents.id": doc_id}, {"$set": sets})
    if data.status == "rejected":
        label = next((r["label"] for r in await _requirements(ws) if r["key"] == doc["requirement_key"]), "A document")
        await _send_supplier_email(ws, s, "A document needs to be re-uploaded",
                                   f"<p><strong>{html.escape(label)}</strong> was not accepted:</p><p style='background:#FEF2F2;padding:10px 12px;border-radius:8px;'>{html.escape(data.note.strip())}</p><p>Please upload a corrected version.</p>",
                                   "Upload corrected document")
    return await _with_compliance(await _get_supplier(ws, supplier_id), await _requirements(ws))


@router.get("/suppliers/{supplier_id}/documents/{doc_id}/file")
async def download_document(supplier_id: str, doc_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    s = await _get_supplier(ws, supplier_id)
    doc = next((d for d in s.get("documents") or [] if d["id"] == doc_id), None)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    path = SUPPLIER_DIR / doc["stored_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File is no longer available")
    # Always served as an attachment so uploaded content can never render in our origin.
    return FileResponse(path, filename=doc["filename"], media_type="application/octet-stream")


# --------------------------------------------------------------- payment gate & renewals

@router.get("/suppliers/{supplier_id}/payment-check")
async def payment_check(supplier_id: str, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    s = await _get_supplier(ws, supplier_id)
    comp = compute_compliance(s, await _requirements(ws))
    reasons = list(comp["blocking"])
    if s.get("status") != "approved":
        reasons.insert(0, f"Supplier status is '{s.get('status')}', not approved")
    return {"can_pay": not reasons, "reasons": reasons, "warnings": comp["attention"],
            "iban": s.get("iban"), "afm": s.get("afm"), "checked_at": _now()}


@router.get("/suppliers/renewals")
async def renewals(days: int = 90, ctx: Ctx = Depends(get_ctx)):
    ws = ctx.org_id
    reqs = await _requirements(ws)
    out = []
    for s in await get_db().suppliers.find({"org_id": ws, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(2000):
        for item in compute_compliance(s, reqs)["items"]:
            if item["days_left"] is not None and item["days_left"] <= days:
                out.append({"supplier_id": s["id"], "supplier_name": s["name"], "requirement": item["label"],
                            "expiry_date": item["expiry_date"], "days_left": item["days_left"], "state": item["state"]})
    return sorted(out, key=lambda x: x["days_left"])


# --------------------------------------------------------------- public supplier portal

async def _by_token(token: str) -> dict:
    if not token or len(token) < 20:
        raise HTTPException(status_code=404, detail="Link not found")
    s = await get_db().suppliers.find_one({"token": token}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Link not found or expired")
    return s


async def _portal_view(s: dict) -> dict:
    ws = s["org_id"]
    reqs = await _requirements(ws)
    comp = compute_compliance(s, reqs)
    biz = await get_db().crm_settings.find_one({"org_id": ws}, {"_id": 0, "business_name": 1, "logo": 1}) or {}
    req_map = {r["key"]: r for r in reqs}
    docs = [{k: d.get(k) for k in ("id", "requirement_key", "filename", "expiry_date", "status", "review_note", "uploaded_at")}
            for d in s.get("documents") or []]
    return {
        "business": {"name": biz.get("business_name") or "", "logo": biz.get("logo") or ""},
        "supplier": {k: s.get(k, "") for k in ("name", "email", "contact_name", "phone", "afm", "doy", "country", "address", "iban", "status")},
        "requirements": [{**req_map[i["key"]], "state": i["state"], "expiry_date": i["expiry_date"], "days_left": i["days_left"]} for i in comp["items"]],
        "documents": docs,
        "profile_issues": [b for b in comp["blocking"] if ":" not in b],
        "progress": comp["progress"],
    }


@router.get("/public/suppliers/{token}")
async def portal_get(token: str, request: Request):
    _rate_limit(request, "supplier-portal-get", 120)
    return await _portal_view(await _by_token(token))


class PortalProfileInput(BaseModel):
    contact_name: Optional[str] = ""
    email: Optional[str] = ""
    phone: Optional[str] = ""
    afm: Optional[str] = ""
    doy: Optional[str] = ""
    country: Optional[str] = "GR"
    address: Optional[str] = ""
    iban: Optional[str] = ""


@router.put("/public/suppliers/{token}/profile")
async def portal_profile(token: str, data: PortalProfileInput, request: Request):
    _rate_limit(request, "supplier-portal-write", 60)
    s = await _by_token(token)
    if s.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="This supplier link has been suspended.")
    profile = _clean_profile(data, partial_supplier=True)
    changed_bank = profile["iban"] != (s.get("iban") or "")
    updates = {**profile, "updated_at": _now()}
    if changed_bank and s.get("iban"):
        # Bank detail changes are a classic fraud vector: force re-review.
        updates["iban_changed_at"] = _now()
        if s.get("status") == "approved":
            updates["status"] = "submitted"
        await _notify_owner(s, f"⚠️ {s['name']} changed their bank account (IBAN) — verify by phone before the next payment")
    await get_db().suppliers.update_one({"id": s["id"]}, {"$set": updates})
    return await _portal_view(await _by_token(token))


@router.post("/public/suppliers/{token}/documents")
async def portal_upload(token: str, request: Request, requirement_key: str = Form(...), expiry_date: Optional[str] = Form(None), file: UploadFile = File(...)):
    _rate_limit(request, "supplier-portal-upload", 40)
    s = await _by_token(token)
    if s.get("status") == "suspended":
        raise HTTPException(status_code=403, detail="This supplier link has been suspended.")
    await _add_document(s["org_id"], s, requirement_key, expiry_date, file, "supplier", "pending")
    return await _portal_view(await _by_token(token))


@router.post("/public/suppliers/{token}/submit")
async def portal_submit(token: str, request: Request):
    _rate_limit(request, "supplier-portal-write", 60)
    s = await _by_token(token)
    if s.get("status") in ("suspended",):
        raise HTTPException(status_code=403, detail="This supplier link has been suspended.")
    view = await _portal_view(s)
    missing = [r["label"] for r in view["requirements"] if r["required"] and r["state"] in ("missing", "rejected", "expired")]
    if missing or view["profile_issues"]:
        raise HTTPException(status_code=400, detail={"message": "Some items are still missing", "errors": view["profile_issues"] + missing})
    if s.get("status") != "approved":
        await get_db().suppliers.update_one({"id": s["id"]}, {"$set": {"status": "submitted", "submitted_at": _now()}})
    await _notify_owner(s, f"{s['name']} completed their supplier onboarding — ready for review")
    return await _portal_view(await _by_token(token))


async def _notify_owner(s: dict, message: str):
    await notify(s["org_id"], "supplier", message, link=f"/app/suppliers?open={s['id']}")


# --------------------------------------------------------------- scheduler

async def check_supplier_expiries(today: Optional[date] = None) -> int:
    """Remind suppliers (and the owner) 30 and 7 days before, and on, document expiry. Idempotent per threshold."""
    sent = 0
    req_cache = {}
    async for s in get_db().suppliers.find({"status": {"$in": ["approved", "submitted"]}}, {"_id": 0}):
        ws = s["org_id"]
        if ws not in req_cache:
            req_cache[ws] = await _requirements(ws)
        for item in compute_compliance(s, req_cache[ws], today)["items"]:
            days = item["days_left"]
            if days is None or not item["document_id"]:
                continue
            threshold = next((t for t in sorted(REMINDER_THRESHOLDS) if days <= t), None)
            if threshold is None:
                continue
            key = f"{s['id']}:{item['document_id']}:{threshold}"
            if await get_db().supplier_reminders.find_one({"key": key}):
                continue
            await get_db().supplier_reminders.insert_one({"key": key, "created_at": _now()})
            when = "has expired" if days < 0 else ("expires today" if days == 0 else f"expires in {days} days ({item['expiry_date']})")
            await _send_supplier_email(ws, s, "Please renew a document",
                                       f"<p><strong>{html.escape(item['label'])}</strong> {when}. Please upload the renewed version so payments are not delayed.</p>",
                                       "Upload renewal")
            await _notify_owner(s, f"{s['name']}: {item['label']} {when}")
            sent += 1
    return sent
