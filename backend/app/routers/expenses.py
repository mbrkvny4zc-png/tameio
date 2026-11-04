"""Expenses, plus AI scanning of receipt/invoice photos into expenses or invoices."""
import uuid
from datetime import date
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app import ai, config, greek_tax as gt
from app.auth import Ctx, get_ctx
from app.common import next_number, valid_currency
from app.db import get_db, now, today
from app.ratelimit import rate_limit
from app.routers.business import get_business

router = APIRouter(tags=["expenses"])

SCAN_DIR = config.UPLOAD_DIR / "scans"
IMAGE_TYPES = {"image/jpeg": [b"\xff\xd8\xff"], "image/png": [b"\x89PNG"], "image/webp": [b"RIFF"], "image/gif": [b"GIF8"]}
MAX_IMAGE = 5 * 1024 * 1024      # Claude's per-image limit
MAX_PDF = 20 * 1024 * 1024
PAYMENT_METHODS = ("cash", "card", "bank_transfer", "other")


class ExpenseInput(BaseModel):
    date: Optional[str] = None
    vendor_name: str
    vendor_afm: Optional[str] = ""
    supplier_id: Optional[str] = None
    category: str = "other"
    description: Optional[str] = ""
    net: float = 0
    vat: float = 0
    total: Optional[float] = None
    vat_rate: Optional[float] = None
    currency: Optional[str] = "EUR"
    payment_method: Optional[str] = "card"
    payment_status: Optional[str] = "paid"
    document_number: Optional[str] = ""
    mark: Optional[str] = ""
    scan_id: Optional[str] = None


def _clean(data: ExpenseInput) -> dict:
    if not data.vendor_name.strip():
        raise HTTPException(status_code=400, detail="Enter who you paid")
    if data.net < 0 or data.vat < 0:
        raise HTTPException(status_code=400, detail="Amounts can't be negative")
    total = round(data.total if data.total is not None else data.net + data.vat, 2)
    if abs(round(data.net + data.vat, 2) - total) > 0.05:
        raise HTTPException(status_code=400, detail=f"Net + VAT ({data.net + data.vat:.2f}) doesn't match the total ({total:.2f})")
    try:
        d = date.fromisoformat((data.date or today())[:10]).isoformat()
    except ValueError:
        raise HTTPException(status_code=400, detail="Date must be YYYY-MM-DD")
    afm = gt.normalize_afm(data.vendor_afm or "")
    rate = data.vat_rate if data.vat_rate is not None else (round(data.vat / data.net * 100) if data.net else 0)
    return {"date": d, "vendor_name": data.vendor_name.strip()[:300], "vendor_afm": afm, "supplier_id": data.supplier_id,
            "category": data.category if data.category in ai.CATEGORIES else "other", "description": (data.description or "").strip()[:500],
            "net": round(data.net, 2), "vat": round(data.vat, 2), "total": total, "vat_rate": rate, "currency": valid_currency(data.currency),
            "payment_method": data.payment_method if data.payment_method in PAYMENT_METHODS else "other",
            "payment_status": "unpaid" if data.payment_status == "unpaid" else "paid",
            "document_number": (data.document_number or "").strip()[:100], "mark": (data.mark or "").strip()[:30]}


async def _get(org_id: str, expense_id: str) -> dict:
    e = await get_db().expenses.find_one({"id": expense_id, "org_id": org_id}, {"_id": 0})
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    return e


@router.get("/expenses/categories")
async def categories():
    return [{"key": k, "label": v} for k, v in ai.CATEGORIES.items()]


@router.get("/expenses")
async def list_expenses(ctx: Ctx = Depends(get_ctx)):
    return await get_db().expenses.find({"org_id": ctx.org_id}, {"_id": 0}).sort([("date", -1), ("created_at", -1)]).to_list(10000)


async def _attach_scan(ctx: Ctx, scan_id: Optional[str]) -> dict:
    if not scan_id:
        return {}
    scan = await get_db().scans.find_one({"id": scan_id, "org_id": ctx.org_id}, {"_id": 0})
    if not scan:
        raise HTTPException(status_code=400, detail="Scan not found")
    return {"scan_id": scan_id, "file": scan["file"]}


@router.post("/expenses")
async def create_expense(data: ExpenseInput, ctx: Ctx = Depends(get_ctx)):
    fields = _clean(data)
    attach = await _attach_scan(ctx, data.scan_id)
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "number": await next_number(ctx.org_id, "expense", "EXP"), **fields, **attach,
           "source": "scan" if attach else "manual", "created_by": ctx.user_id, "created_at": now(), "updated_at": now()}
    await get_db().expenses.insert_one({**doc})
    if attach:
        await get_db().scans.update_one({"id": data.scan_id}, {"$set": {"used_for": {"type": "expense", "id": doc["id"], "number": doc["number"]}}})
    return doc


@router.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, data: ExpenseInput, ctx: Ctx = Depends(get_ctx)):
    await _get(ctx.org_id, expense_id)
    await get_db().expenses.update_one({"id": expense_id}, {"$set": {**_clean(data), "updated_at": now()}})
    return await _get(ctx.org_id, expense_id)


@router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, ctx: Ctx = Depends(get_ctx)):
    await _get(ctx.org_id, expense_id)
    await get_db().expenses.delete_one({"id": expense_id})
    return {"ok": True}


@router.get("/expenses/{expense_id}/file")
async def expense_file(expense_id: str, ctx: Ctx = Depends(get_ctx)):
    e = await _get(ctx.org_id, expense_id)
    return _serve(e.get("file"))


def _serve(f: Optional[dict]):
    if not f:
        raise HTTPException(status_code=404, detail="No file attached")
    path = SCAN_DIR / f["stored_name"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File is no longer available")
    # Inline only for types that can't run script in our origin.
    safe_inline = f["content_type"] in ("image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf")
    return FileResponse(path, media_type=f["content_type"] if safe_inline else "application/octet-stream", filename=f["filename"],
                        content_disposition_type="inline" if safe_inline else "attachment",
                        headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox"})


# ------------------------------------------------------------------ AI scanning

def _detect_type(data: bytes, declared: str, filename: str) -> str:
    if data.startswith(b"%PDF"):
        return "application/pdf"
    for t, magics in IMAGE_TYPES.items():
        if any(data.startswith(m) for m in magics):
            if t == "image/webp" and data[8:12] != b"WEBP":
                continue
            return t
    if filename.lower().endswith((".heic", ".heif")) or "heic" in (declared or ""):
        raise HTTPException(status_code=400, detail="HEIC photos aren't supported yet — set your camera to 'Most compatible' (JPEG) or upload a PDF")
    raise HTTPException(status_code=400, detail="Upload a photo (JPG, PNG, WebP) or a PDF")


def _num(v):
    return None if v is None else round(float(v), 2)


async def build_suggestion(org_id: str, x: dict, biz: dict) -> dict:
    """Turn raw extraction into a ready-to-review expense or invoice draft, with sanity checks."""
    d = get_db()
    warnings: List[str] = []
    our_afm = gt.normalize_afm(biz.get("afm", ""))
    issuer_afm = gt.normalize_afm(x.get("issuer_afm") or "")
    recipient_afm = gt.normalize_afm(x.get("recipient_afm") or "")
    is_sales = x.get("document_kind") == "sales_invoice" or (our_afm and issuer_afm == our_afm)
    if x.get("document_kind") == "credit_note":
        warnings.append("This looks like a credit note — check whether it should reduce an earlier expense.")

    net, vat, total = _num(x.get("net_amount")), _num(x.get("vat_amount")), _num(x.get("total_amount"))
    if total is not None and net is None and vat is not None:
        net = round(total - vat, 2)
    if total is not None and vat is None and net is not None:
        vat = round(total - net, 2)
    if total is None and net is not None and vat is not None:
        total = round(net + vat, 2)
    if net is None and vat is None and total is not None:
        net, vat = total, 0.0
        warnings.append("No VAT amount was found — the full total was recorded as net. Check the receipt.")
    if None not in (net, vat, total) and abs(net + vat - total) > 0.05:
        warnings.append(f"Amounts don't add up: net {net:.2f} + VAT {vat:.2f} ≠ total {total:.2f}.")
    if total is None:
        warnings.append("The total couldn't be read — enter it manually.")
    rates = [b["rate"] for b in x.get("vat_breakdown") or [] if b.get("rate") is not None]
    vat_rate = rates[0] if len(set(rates)) == 1 else (round(vat / net * 100) if net and vat is not None else None)
    if len(set(rates)) > 1:
        warnings.append(f"Several VAT rates on this document ({', '.join(f'{r:g}%' for r in sorted(set(rates)))}) — totals were combined.")

    issued = x.get("issue_date")
    try:
        issued = date.fromisoformat(issued).isoformat() if issued else None
    except ValueError:
        issued = None
    if not issued:
        warnings.append("The date couldn't be read — today's date was used.")
    elif issued > today():
        warnings.append("The date is in the future — check day/month order.")
    if issuer_afm and not gt.is_valid_afm(issuer_afm):
        warnings.append(f"The issuer's ΑΦΜ ({issuer_afm}) fails the checksum — it may be misread.")
    if x.get("confidence") == "low":
        warnings.append("The image was hard to read — double-check every field.")
    if (x.get("currency") or "EUR").upper() not in ("EUR", "€"):
        warnings.append(f"Currency is {x.get('currency')} — amounts were not converted.")

    # Duplicates: same MARK, or same issuer + document number.
    dup_q = []
    if x.get("mydata_mark"):
        dup_q.append({"mark": x["mydata_mark"]})
    if issuer_afm and x.get("document_number"):
        dup_q.append({"vendor_afm": issuer_afm, "document_number": x["document_number"]})
    duplicate = None
    if dup_q and not is_sales:
        duplicate = await d.expenses.find_one({"org_id": org_id, "$or": dup_q}, {"_id": 0, "id": 1, "number": 1, "date": 1, "total": 1})
        if duplicate:
            warnings.insert(0, f"Possible duplicate of {duplicate['number']} ({duplicate['date']}, €{duplicate['total']:.2f}).")

    if is_sales:
        client = None
        if recipient_afm:
            client = await d.clients.find_one({"org_id": org_id, "afm": recipient_afm}, {"_id": 0, "id": 1, "name": 1})
        items = [{"description": li["description"], "qty": li.get("quantity") or 1,
                  "unit_price": li.get("unit_price") if li.get("unit_price") is not None else (li.get("amount") or 0)}
                 for li in x.get("line_items") or [] if li.get("description")]
        if not items and net is not None:
            items = [{"description": x.get("summary") or "Services", "qty": 1, "unit_price": net}]
        return {"target": "invoice", "warnings": warnings, "duplicate": None,
                "invoice_draft": {"client_id": client["id"] if client else None, "client_name": x.get("recipient_name") or "",
                                  "client_afm": recipient_afm, "issue_date": issued or today(), "items": items,
                                  "tax_rate": vat_rate if vat_rate is not None else 24, "document_number": x.get("document_number") or ""}}

    supplier = None
    if issuer_afm:
        supplier = await d.suppliers.find_one({"org_id": org_id, "afm": issuer_afm}, {"_id": 0, "id": 1, "name": 1})
    return {"target": "expense", "warnings": warnings, "duplicate": duplicate,
            "expense_draft": {"date": issued or today(), "vendor_name": (supplier or {}).get("name") or x.get("issuer_name") or "",
                              "vendor_afm": issuer_afm, "supplier_id": (supplier or {}).get("id"), "category": x.get("suggested_category") or "other",
                              "description": x.get("summary") or "", "net": net or 0, "vat": vat or 0, "total": total if total is not None else 0,
                              "vat_rate": vat_rate, "currency": "EUR",
                              "payment_method": x.get("payment_method") if x.get("payment_method") in PAYMENT_METHODS else "card",
                              "payment_status": "paid" if x.get("document_kind") == "receipt" else "unpaid",
                              "document_number": x.get("document_number") or "", "mark": x.get("mydata_mark") or ""}}


@router.post("/scans")
async def scan(request: Request, file: UploadFile = File(...), ctx: Ctx = Depends(get_ctx)):
    rate_limit(request, f"scan:{ctx.org_id}", 120)
    data = await file.read(MAX_PDF + 1)
    if not data:
        raise HTTPException(status_code=400, detail="The file is empty")
    media_type = _detect_type(data, file.content_type or "", file.filename or "")
    limit = MAX_PDF if media_type == "application/pdf" else MAX_IMAGE
    if len(data) > limit:
        raise HTTPException(status_code=413, detail=f"File is too large (max {limit // (1024 * 1024)} MB)")
    SCAN_DIR.mkdir(parents=True, exist_ok=True)
    ext = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}[media_type]
    stored = f"{uuid.uuid4().hex}{ext}"
    (SCAN_DIR / stored).write_bytes(data)
    fmeta = {"stored_name": stored, "filename": Path(file.filename or f"scan{ext}").name[:120], "content_type": media_type, "size": len(data)}
    scan_doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "file": fmeta, "status": "processing", "created_by": ctx.user_id, "created_at": now()}
    await get_db().scans.insert_one({**scan_doc})
    biz = await get_business(ctx.org_id)
    try:
        extracted = await ai.extract_document(data, media_type, biz)
    except ai.ScanError as e:
        await get_db().scans.update_one({"id": scan_doc["id"]}, {"$set": {"status": "failed", "error": str(e)}})
        raise HTTPException(status_code=422, detail={"message": str(e), "scan_id": scan_doc["id"]})
    suggestion = await build_suggestion(ctx.org_id, extracted, biz)
    await get_db().scans.update_one({"id": scan_doc["id"]}, {"$set": {"status": "done", "extracted": extracted, "suggestion": suggestion}})
    return {**scan_doc, "status": "done", "extracted": extracted, "suggestion": suggestion}


@router.get("/scans")
async def list_scans(ctx: Ctx = Depends(get_ctx)):
    return await get_db().scans.find({"org_id": ctx.org_id}, {"_id": 0}).sort("created_at", -1).to_list(50)


@router.get("/scans/{scan_id}/file")
async def scan_file(scan_id: str, ctx: Ctx = Depends(get_ctx)):
    s = await get_db().scans.find_one({"id": scan_id, "org_id": ctx.org_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _serve(s.get("file"))


@router.post("/scans/{scan_id}/link-invoice/{invoice_id}")
async def link_invoice(scan_id: str, invoice_id: str, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    s = await d.scans.find_one({"id": scan_id, "org_id": ctx.org_id}, {"_id": 0})
    inv = await d.invoices.find_one({"id": invoice_id, "org_id": ctx.org_id}, {"_id": 0, "id": 1, "number": 1})
    if not s or not inv:
        raise HTTPException(status_code=404, detail="Not found")
    await d.invoices.update_one({"id": invoice_id}, {"$set": {"scan_id": scan_id, "file": s["file"]}})
    await d.scans.update_one({"id": scan_id}, {"$set": {"used_for": {"type": "invoice", "id": invoice_id, "number": inv["number"]}}})
    return {"ok": True}
