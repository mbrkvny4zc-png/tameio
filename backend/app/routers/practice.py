"""Accountant tools: all client businesses at a glance, receipt requests, and the period export pack."""
import csv
import io
import uuid
import zipfile
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from app import ai, config, greek_tax as gt
from app.auth import Ctx, create_org, current_user, get_ctx
from app.common import esc, money, next_number
from app.db import get_db, now
from app.mailer import layout, send
from app.notify import notify
from app.routers.reports import _cell, compute_summary

router = APIRouter(tags=["practice"])


def _period(period: Optional[str]) -> tuple:
    """'YYYY-MM' -> (first day, last day)."""
    try:
        y, m = (int(x) for x in (period or date.today().strftime("%Y-%m")).split("-"))
        start = date(y, m, 1)
        end = date(y + (m == 12), m % 12 + 1, 1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Period must be YYYY-MM")
    from datetime import timedelta
    return start.isoformat(), (end - timedelta(days=1)).isoformat()


async def client_checklist(org_id: str, start: str, end: str) -> dict:
    d = get_db()
    q_inv = {"org_id": org_id, "issue_date": {"$gte": start, "$lte": end}}
    unreported = await d.invoices.count_documents({**q_inv, "status": {"$in": ["sent", "paid", "overdue", "credited"]},
                                                   "mydata.state": {"$nin": ["transmitted", "cancelled"]}})
    drafts = await d.invoices.count_documents({**q_inv, "status": "draft"})
    overdue = await d.invoices.count_documents({"org_id": org_id, "status": "overdue"})
    no_receipt = await d.expenses.count_documents({"org_id": org_id, "date": {"$gte": start, "$lte": end}, "file": None})
    unclassified = await d.received_docs.count_documents({"org_id": org_id, "issue_date": {"$gte": start, "$lte": end},
                                                          "classification.state": {"$ne": "sent"}, "ignored": {"$ne": True}})
    unmatched_bank = await d.bank_txns.count_documents({"org_id": org_id, "date": {"$gte": start, "$lte": end}, "match": None, "ignored": {"$ne": True}})
    open_requests = await d.receipt_requests.count_documents({"org_id": org_id, "status": "open"})
    s = await compute_summary(org_id, start, end)
    closed = await d.period_closes.find_one({"org_id": org_id, "period": start[:7]}, {"_id": 0})
    items = [
        ("unreported", "Invoices not reported to myDATA", unreported),
        ("unclassified", "Purchase invoices not classified", unclassified),
        ("no_receipt", "Expenses without a receipt", no_receipt),
        ("unmatched_bank", "Bank payments not matched", unmatched_bank),
        ("drafts", "Draft invoices", drafts),
    ]
    todo = sum(v for _, _, v in items)
    return {"checklist": [{"key": k, "label": l, "count": v} for k, l, v in items], "todo": todo,
            "overdue": overdue, "open_requests": open_requests, "closed": closed,
            "figures": {"income": s["income"]["net"], "expenses": s["expenses"]["net"], "profit": s["profit"], "vat_payable": s["vat"]["payable"]},
            "status": "closed" if closed else ("ready" if todo == 0 else "attention")}


@router.get("/practice/clients")
async def practice_clients(period: Optional[str] = None, u: dict = Depends(current_user)):
    start, end = _period(period)
    d = get_db()
    out = []
    for m in await d.memberships.find({"user_id": u["id"]}, {"_id": 0}).to_list(2000):
        org = await d.orgs.find_one({"id": m["org_id"]}, {"_id": 0}) or {}
        if org.get("kind") == "practice":
            continue
        biz = await d.business.find_one({"org_id": m["org_id"]}, {"_id": 0, "business_name": 1, "afm": 1}) or {}
        last = await d.invoices.find_one({"org_id": m["org_id"]}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        last_exp = await d.expenses.find_one({"org_id": m["org_id"]}, {"_id": 0, "created_at": 1}, sort=[("created_at", -1)])
        activity = max([x["created_at"] for x in (last, last_exp) if x] or [""]) or None
        out.append({"org_id": m["org_id"], "name": biz.get("business_name") or "Untitled business", "afm": biz.get("afm", ""),
                    "role": m["role"], "plan": org.get("plan"), "has_owner": bool(org.get("owner_id")), "last_activity": activity,
                    **await client_checklist(m["org_id"], start, end)})
    out.sort(key=lambda c: ({"attention": 0, "ready": 1, "closed": 2}[c["status"]], -c["todo"], c["name"]))
    return {"period": start[:7], "start": start, "end": end, "clients": out}


class NewClientInput(BaseModel):
    business_name: str
    afm: Optional[str] = ""
    owner_email: Optional[str] = ""


@router.post("/practice/clients")
async def add_client(data: NewClientInput, u: dict = Depends(current_user)):
    """An accountant sets up a client's business, then (optionally) invites the client as owner."""
    if u.get("account_type") != "accountant":
        raise HTTPException(status_code=403, detail="Only accountant accounts can add client businesses")
    if not data.business_name.strip():
        raise HTTPException(status_code=400, detail="Enter the business name")
    afm = gt.normalize_afm(data.afm or "")
    if afm and not gt.is_valid_afm(afm):
        raise HTTPException(status_code=400, detail="That ΑΦΜ fails the checksum")
    org_id = await create_org(u["id"], "business", data.business_name.strip(), role="accountant", created_by=u["id"])
    from app.routers.partners import attribute, partner_of
    p = await partner_of(u["org_id"])
    if p:  # a business the firm set up itself counts as referred by the firm
        await attribute(org_id, u["org_id"], "added_by_firm", p["code"])
    if afm:
        await get_db().business.update_one({"org_id": org_id}, {"$set": {"afm": afm}})
    invite_url = None
    if (data.owner_email or "").strip():
        from app.routers.team import create_invite
        r = await create_invite(org_id, u["id"], u.get("name", ""), data.owner_email, "owner")
        invite_url = r["url"]
    return {"org_id": org_id, "invite_url": invite_url}


class ClosePeriod(BaseModel):
    period: str
    note: Optional[str] = ""


@router.post("/practice/close")
async def close_period(data: ClosePeriod, ctx: Ctx = Depends(get_ctx)):
    if ctx.role not in ("accountant", "owner", "admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    start, _ = _period(data.period)
    await get_db().period_closes.update_one({"org_id": ctx.org_id, "period": start[:7]},
                                            {"$set": {"closed_by": ctx.name, "closed_at": now(), "note": (data.note or "")[:300]}}, upsert=True)
    return {"ok": True}


@router.delete("/practice/close/{period}")
async def reopen_period(period: str, ctx: Ctx = Depends(get_ctx)):
    if ctx.role not in ("accountant", "owner", "admin"):
        raise HTTPException(status_code=403, detail="Not allowed")
    await get_db().period_closes.delete_one({"org_id": ctx.org_id, "period": period})
    return {"ok": True}


# ------------------------------------------------------------------ missing receipts

@router.get("/receipts/missing")
async def missing_receipts(period: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    start, end = _period(period)
    d = get_db()
    exps = await d.expenses.find({"org_id": ctx.org_id, "date": {"$gte": start, "$lte": end}, "file": None},
                                 {"_id": 0, "id": 1, "date": 1, "vendor_name": 1, "total": 1, "description": 1}).to_list(1000)
    txns = await d.bank_txns.find({"org_id": ctx.org_id, "date": {"$gte": start, "$lte": end}, "match": None, "amount": {"$lt": 0}, "ignored": {"$ne": True}},
                                  {"_id": 0, "id": 1, "date": 1, "description": 1, "amount": 1}).to_list(1000)
    return ([{"kind": "expense", "ref_id": x["id"], "date": x["date"], "description": x["vendor_name"] + (f" — {x['description']}" if x.get("description") else ""),
              "amount": x["total"]} for x in exps]
            + [{"kind": "bank", "ref_id": t["id"], "date": t["date"], "description": t["description"], "amount": -t["amount"]} for t in txns])


class RequestItem(BaseModel):
    kind: str
    ref_id: str
    date: str
    description: str
    amount: float


class ReceiptRequestInput(BaseModel):
    items: List[RequestItem]
    message: Optional[str] = ""


@router.post("/receipt-requests")
async def create_request(data: ReceiptRequestInput, ctx: Ctx = Depends(get_ctx)):
    if not data.items:
        raise HTTPException(status_code=400, detail="Choose at least one item")
    items = [{"id": uuid.uuid4().hex[:10], **i.model_dump(), "description": i.description[:300], "status": "open"} for i in data.items[:200]
             if i.kind in ("expense", "bank")]
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "requested_by": ctx.user_id, "requested_by_name": ctx.name,
           "message": (data.message or "").strip()[:1000], "items": items, "status": "open", "created_at": now()}
    d = get_db()
    await d.receipt_requests.insert_one({**doc})
    await notify(ctx.org_id, "receipts", f"{ctx.name} needs {len(items)} receipt{'s' if len(items) != 1 else ''}", "/app/requests")
    owner_ms = await d.memberships.find({"org_id": ctx.org_id, "role": {"$in": ["owner", "admin"]}}, {"_id": 0, "user_id": 1}).to_list(10)
    emailed = False
    for m in owner_ms:
        user = await d.users.find_one({"id": m["user_id"]}, {"_id": 0, "email": 1})
        rows = "".join(f'<li>{esc(i["date"])} · {esc(i["description"])} · {money(i["amount"])}</li>' for i in items[:30])
        body = (f'<p style="color:#3A4358;font-size:14px;">{esc(ctx.name)} needs receipts for these payments:</p><ul style="font-size:13px;color:#3A4358;">{rows}</ul>'
                + (f'<p style="background:#F6F8FB;border-radius:10px;padding:10px 12px;font-size:13px;">{esc(doc["message"])}</p>' if doc["message"] else ""))
        emailed = await send(user["email"], f"{ctx.name} needs {len(items)} receipts", layout("Receipts needed", body, "Upload receipts", f"{config.PUBLIC_URL}/app/requests")) or emailed
    return {**doc, "emailed": emailed}


@router.get("/receipt-requests")
async def list_requests(ctx: Ctx = Depends(get_ctx)):
    return await get_db().receipt_requests.find({"org_id": ctx.org_id}, {"_id": 0}).sort("created_at", -1).to_list(100)


@router.post("/receipt-requests/{req_id}/items/{item_id}/upload")
async def fulfil_item(req_id: str, item_id: str, file: UploadFile = File(...), ctx: Ctx = Depends(get_ctx)):
    from app.routers.expenses import SCAN_DIR, _detect_type
    d = get_db()
    req = await d.receipt_requests.find_one({"id": req_id, "org_id": ctx.org_id}, {"_id": 0})
    item = next((i for i in (req or {}).get("items", []) if i["id"] == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Request not found")
    data = await file.read(20 * 1024 * 1024 + 1)
    if not data or len(data) > 20 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Upload a file up to 20 MB")
    media = _detect_type(data, file.content_type or "", file.filename or "")
    SCAN_DIR.mkdir(parents=True, exist_ok=True)
    ext = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif"}[media]
    stored = f"{uuid.uuid4().hex}{ext}"
    (SCAN_DIR / stored).write_bytes(data)
    fmeta = {"stored_name": stored, "filename": (file.filename or f"receipt{ext}")[:120], "content_type": media, "size": len(data)}
    if item["kind"] == "expense":
        await d.expenses.update_one({"id": item["ref_id"], "org_id": ctx.org_id}, {"$set": {"file": fmeta, "updated_at": now()}})
        expense_id = item["ref_id"]
    else:  # bank payment without an expense yet: create one from the bank line
        expense_id = str(uuid.uuid4())
        await d.expenses.insert_one({"id": expense_id, "org_id": ctx.org_id, "number": await next_number(ctx.org_id, "expense", "EXP"),
                                     "date": item["date"], "vendor_name": item["description"][:120], "vendor_afm": "", "category": "other",
                                     "description": "Added from a receipt request — check the category", "net": round(item["amount"], 2), "vat": 0.0,
                                     "total": round(item["amount"], 2), "vat_rate": 0, "currency": "EUR", "payment_method": "bank_transfer",
                                     "payment_status": "paid", "file": fmeta, "source": "receipt_request", "created_by": ctx.user_id,
                                     "created_at": now(), "updated_at": now()})
        await d.bank_txns.update_one({"id": item["ref_id"], "org_id": ctx.org_id}, {"$set": {"match": {"type": "expense", "id": expense_id}}})
    items = [{**i, "status": "done", "expense_id": expense_id} if i["id"] == item_id else i for i in req["items"]]
    status = "done" if all(i["status"] == "done" for i in items) else "open"
    await d.receipt_requests.update_one({"id": req_id}, {"$set": {"items": items, "status": status, "updated_at": now()}})
    if status == "done":
        await notify(ctx.org_id, "receipts", "All requested receipts were uploaded", "/app/practice")
    return {"status": status, "items": items}


# ------------------------------------------------------------------ export pack

def _csv(rows: list, header: list) -> bytes:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(header)
    for r in rows:
        w.writerow([_cell(c) for c in r])
    return ("﻿" + buf.getvalue()).encode("utf-8")


@router.get("/export/pack.zip")
async def export_pack(period: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    """Everything an accountant needs for a month, in one ZIP."""
    from app.routers.expenses import SCAN_DIR
    start, end = _period(period)
    d = get_db()
    biz = await d.business.find_one({"org_id": ctx.org_id}, {"_id": 0}) or {}
    invoices = await d.invoices.find({"org_id": ctx.org_id, "issue_date": {"$gte": start, "$lte": end}, "status": {"$ne": "draft"}}, {"_id": 0}).sort("issue_date", 1).to_list(20000)
    expenses = await d.expenses.find({"org_id": ctx.org_id, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).sort("date", 1).to_list(20000)
    received = await d.received_docs.find({"org_id": ctx.org_id, "issue_date": {"$gte": start, "$lte": end}}, {"_id": 0}).sort("issue_date", 1).to_list(20000)
    bank = await d.bank_txns.find({"org_id": ctx.org_id, "date": {"$gte": start, "$lte": end}}, {"_id": 0}).sort("date", 1).to_list(50000)
    s = await compute_summary(ctx.org_id, start, end)
    buf = io.BytesIO()
    total_files = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("sales_invoices.csv", _csv([[i["number"], "Credit note" if i.get("kind") == "credit_note" else "Invoice", i["issue_date"], i.get("client_name"),
                                                 i.get("client_afm"), (-1 if i.get("kind") == "credit_note" else 1) * (i.get("subtotal") or 0),
                                                 (-1 if i.get("kind") == "credit_note" else 1) * (i.get("tax") or 0), (-1 if i.get("kind") == "credit_note" else 1) * (i.get("total") or 0),
                                                 i.get("tax_rate"), i.get("currency"), i.get("status"), (i.get("mydata") or {}).get("mark") or "",
                                                 (i.get("mydata") or {}).get("invoice_type") or ""] for i in invoices],
                                               ["Number", "Type", "Date", "Client", "Client ΑΦΜ", "Net", "VAT", "Total", "VAT %", "Currency", "Status", "ΜΑΡΚ", "myDATA type"]))
        rows = []
        for x in expenses:
            fname = ""
            f = x.get("file")
            if f and (SCAN_DIR / f["stored_name"]).exists() and total_files < 2000:
                fname = f"receipts/{x['number']}{(SCAN_DIR / f['stored_name']).suffix}"
                z.write(SCAN_DIR / f["stored_name"], fname)
                total_files += 1
            rows.append([x["number"], x["date"], x.get("vendor_name"), x.get("vendor_afm"), ai.category_label(x.get("category")), x.get("description"),
                         x.get("net"), x.get("vat"), x.get("total"), x.get("vat_rate"), x.get("payment_status"), x.get("document_number"), x.get("mark"), fname])
        z.writestr("expenses.csv", _csv(rows, ["Number", "Date", "Vendor", "Vendor ΑΦΜ", "Category", "Description", "Net", "VAT", "Total", "VAT %",
                                               "Paid", "Doc no.", "ΜΑΡΚ", "Receipt file"]))
        z.writestr("purchase_invoices_mydata.csv", _csv([[r.get("mark"), r.get("issue_date"), r.get("issuer_name"), r.get("issuer_afm"), r.get("invoice_type"),
                                                          r.get("series"), r.get("aa"), r.get("net"), r.get("vat"), r.get("gross"),
                                                          (r.get("classification") or {}).get("category"), (r.get("classification") or {}).get("e3_type"),
                                                          (r.get("classification") or {}).get("state"), (r.get("match") or {}).get("number")] for r in received],
                                                        ["ΜΑΡΚ", "Date", "Issuer", "Issuer ΑΦΜ", "Type", "Series", "No.", "Net", "VAT", "Gross",
                                                         "Category", "E3 code", "Classification", "Matched expense"]))
        z.writestr("bank.csv", _csv([[t["date"], t["description"], t["amount"], (t.get("match") or {}).get("type"), (t.get("match") or {}).get("number")] for t in bank],
                                    ["Date", "Description", "Amount", "Matched to", "Document"]))
        z.writestr("summary.csv", _csv([["Period", f"{start} to {end}"], ["Income (net)", s["income"]["net"]], ["Output VAT", s["vat"]["output"]],
                                        ["Expenses (net)", s["expenses"]["net"]], ["Input VAT", s["vat"]["input"]], ["VAT payable (estimate)", s["vat"]["payable"]],
                                        ["Profit (net)", s["profit"]]] + [[f"Expenses: {c['label']}", c["net"]] for c in s["categories"]], ["Item", "Amount"]))
        z.writestr("README.txt", f"{biz.get('business_name', '')} (ΑΦΜ {biz.get('afm', '')})\nPeriod {start} to {end}\nExported {now()} from {config.APP_NAME}\n\n"
                                 "CSV files are UTF-8 with BOM and open directly in Excel. Credit notes are negative.\nVAT payable is an estimate from recorded documents.\n")
    return Response(buf.getvalue(), media_type="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{(biz.get("business_name") or "export").replace(chr(34), "")}-{start[:7]}.zip"'})
