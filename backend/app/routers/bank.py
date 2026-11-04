"""Bank statement import (CSV from any Greek or international bank) and automatic reconciliation.

Incoming payments are matched to open invoices (and mark them paid); outgoing
payments are matched to expenses. What's left is shown for review — unmatched
outgoing payments are "missing receipts" for the accountant.
"""
import csv
import hashlib
import io
import re
import uuid
from datetime import date, datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from app.auth import Ctx, get_ctx
from app.common import next_number
from app.db import get_db, now

router = APIRouter(tags=["bank"])

H_DATE = ("date", "ημερομηνία", "ημερ/νία", "ημ/νία", "ημερομηνια", "value date", "ημ. αξίας", "ημερομηνία αξίας", "transaction date", "booking date")
H_DESC = ("description", "περιγραφή", "αιτιολογία", "περιγραφη", "details", "narrative", "reference", "αιτιολογια", "συναλλαγή")
H_AMOUNT = ("amount", "ποσό", "ποσο", "ποσό συναλλαγής")
H_DEBIT = ("debit", "χρέωση", "χρεωση", "ανάληψη", "withdrawal", "money out")
H_CREDIT = ("credit", "πίστωση", "πιστωση", "κατάθεση", "deposit", "money in")


def _find(headers, names):
    low = [h.strip().lower() for h in headers]
    for n in names:
        for i, h in enumerate(low):
            if h == n or h.startswith(n):
                return i
    return None


def parse_amount(raw: str) -> Optional[float]:
    s = (raw or "").strip().replace("€", "").replace("EUR", "").replace(" ", "").replace(" ", "")
    if not s:
        return None
    neg = s.startswith("-") or (s.startswith("(") and s.endswith(")")) or s.endswith("-")
    s = s.strip("-()+")
    if "," in s and "." in s:  # whichever comes last is the decimal separator
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".") if re.search(r",\d{1,2}$", s) else s.replace(",", "")
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def parse_date(raw: str) -> Optional[str]:
    s = (raw or "").strip()[:10]
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y-%m-%d", "%d/%m/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            continue
    return None


def parse_statement(content: bytes) -> list:
    for enc in ("utf-8-sig", "cp1253", "iso-8859-7", "latin-1"):
        try:
            text = content.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    sample = text[:4000]
    delim = max([";", ",", "\t", "|"], key=sample.count)
    rows = [r for r in csv.reader(io.StringIO(text), delimiter=delim) if any(c.strip() for c in r)]
    # The header is the first row that names a date column (banks often add title lines above it).
    hi = next((i for i, r in enumerate(rows[:15]) if _find(r, H_DATE) is not None), None)
    if hi is None:
        raise HTTPException(status_code=400, detail="Couldn't find a date column. Export the statement as CSV with headers (Date, Description, Amount).")
    head = rows[hi]
    di, de, am, db_, cr = _find(head, H_DATE), _find(head, H_DESC), _find(head, H_AMOUNT), _find(head, H_DEBIT), _find(head, H_CREDIT)
    if am is None and db_ is None and cr is None:
        raise HTTPException(status_code=400, detail="Couldn't find an amount column (Amount / Ποσό, or Debit & Credit / Χρέωση & Πίστωση).")
    out = []
    for r in rows[hi + 1:]:
        get = lambda i: r[i] if i is not None and i < len(r) else ""  # noqa: E731
        d = parse_date(get(di))
        if not d:
            continue
        if am is not None and get(am).strip():
            amt = parse_amount(get(am))
        else:
            debit, credit = parse_amount(get(db_)) or 0.0, parse_amount(get(cr)) or 0.0
            amt = credit - abs(debit)
        if amt is None or amt == 0:
            continue
        out.append({"date": d, "description": re.sub(r"\s+", " ", get(de)).strip()[:300], "amount": round(amt, 2)})
    if not out:
        raise HTTPException(status_code=400, detail="No transactions were found in that file")
    return out


async def auto_match(org_id: str) -> int:
    d = get_db()
    n = 0
    open_inv = await d.invoices.find({"org_id": org_id, "status": {"$in": ["sent", "overdue"]}, "kind": {"$ne": "credit_note"}}, {"_id": 0}).to_list(5000)
    used_exp = {t["match"]["id"] for t in await d.bank_txns.find({"org_id": org_id, "match.type": "expense"}, {"_id": 0, "match": 1}).to_list(50000)}
    for t in await d.bank_txns.find({"org_id": org_id, "match": None, "ignored": {"$ne": True}}, {"_id": 0}).sort("date", 1).to_list(20000):
        match = None
        if t["amount"] > 0:
            cands = [i for i in open_inv if abs(i["total"] - t["amount"]) < 0.01]
            by_number = [i for i in cands if i["number"].lower() in t["description"].lower()]
            pick = by_number[0] if len(by_number) == 1 else (cands[0] if len(cands) == 1 else None)
            if pick:
                match = {"type": "invoice", "id": pick["id"], "number": pick["number"]}
                await d.invoices.update_one({"id": pick["id"]}, {"$set": {"status": "paid", "paid_at": t["date"], "paid_via": "bank", "updated_at": now()}})
                open_inv = [i for i in open_inv if i["id"] != pick["id"]]
        else:
            dt = date.fromisoformat(t["date"])
            cands = [x for x in await d.expenses.find({"org_id": org_id, "date": {"$gte": (dt - timedelta(days=10)).isoformat(), "$lte": (dt + timedelta(days=3)).isoformat()}},
                                                     {"_id": 0}).to_list(500)
                     if abs(x["total"] + t["amount"]) < 0.01 and x["id"] not in used_exp]
            if len(cands) == 1:
                x = cands[0]
                match = {"type": "expense", "id": x["id"], "number": x["number"]}
                used_exp.add(x["id"])
                if x.get("payment_status") == "unpaid":
                    await d.expenses.update_one({"id": x["id"]}, {"$set": {"payment_status": "paid", "updated_at": now()}})
        if match:
            await d.bank_txns.update_one({"id": t["id"]}, {"$set": {"match": {**match, "auto": True}}})
            n += 1
    return n


@router.post("/bank/import")
async def import_statement(file: UploadFile = File(...), ctx: Ctx = Depends(get_ctx)):
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Statement file is larger than 5 MB")
    rows = parse_statement(content)
    d = get_db()
    added = dup = 0
    seen = {}
    for r in rows:
        base = f"{r['date']}|{r['amount']:.2f}|{r['description']}"
        seen[base] = seen.get(base, 0) + 1  # two identical lines in one file are two payments
        key = hashlib.sha1(f"{base}|{seen[base]}".encode()).hexdigest()
        if await d.bank_txns.find_one({"org_id": ctx.org_id, "key": key}):
            dup += 1
            continue
        await d.bank_txns.insert_one({"id": str(uuid.uuid4()), "org_id": ctx.org_id, "key": key, **r, "match": None, "ignored": False,
                                      "source": (file.filename or "statement.csv")[:120], "created_at": now()})
        added += 1
    matched = await auto_match(ctx.org_id)
    return {"added": added, "duplicates": dup, "matched": matched}


@router.get("/bank/transactions")
async def list_txns(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    txns = await d.bank_txns.find({"org_id": ctx.org_id}, {"_id": 0, "key": 0}).sort("date", -1).to_list(20000)
    # Candidate suggestions for unmatched lines
    open_inv = await d.invoices.find({"org_id": ctx.org_id, "status": {"$in": ["sent", "overdue"]}, "kind": {"$ne": "credit_note"}},
                                     {"_id": 0, "id": 1, "number": 1, "total": 1, "client_name": 1}).to_list(5000)
    unpaid_exp = await d.expenses.find({"org_id": ctx.org_id}, {"_id": 0, "id": 1, "number": 1, "total": 1, "vendor_name": 1, "date": 1}).sort("date", -1).to_list(2000)
    return {"items": txns, "open_invoices": open_inv, "expenses": unpaid_exp[:500]}


class MatchInput(BaseModel):
    type: str
    id: str


@router.post("/bank/transactions/{txn_id}/match")
async def match(txn_id: str, data: MatchInput, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    t = await d.bank_txns.find_one({"id": txn_id, "org_id": ctx.org_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if data.type == "invoice":
        doc = await d.invoices.find_one({"id": data.id, "org_id": ctx.org_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Invoice not found")
        await d.invoices.update_one({"id": data.id}, {"$set": {"status": "paid", "paid_at": t["date"], "paid_via": "bank", "updated_at": now()}})
    elif data.type == "expense":
        doc = await d.expenses.find_one({"id": data.id, "org_id": ctx.org_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Expense not found")
        await d.expenses.update_one({"id": data.id}, {"$set": {"payment_status": "paid", "updated_at": now()}})
    else:
        raise HTTPException(status_code=400, detail="Match to an invoice or an expense")
    await d.bank_txns.update_one({"id": txn_id}, {"$set": {"match": {"type": data.type, "id": data.id, "number": doc["number"], "auto": False}}})
    return {"ok": True}


@router.delete("/bank/transactions/{txn_id}/match")
async def unmatch(txn_id: str, ctx: Ctx = Depends(get_ctx)):
    await get_db().bank_txns.update_one({"id": txn_id, "org_id": ctx.org_id}, {"$set": {"match": None}})
    return {"ok": True}


class IgnoreInput(BaseModel):
    ignored: bool = True


@router.put("/bank/transactions/{txn_id}/ignore")
async def ignore(txn_id: str, data: IgnoreInput, ctx: Ctx = Depends(get_ctx)):
    await get_db().bank_txns.update_one({"id": txn_id, "org_id": ctx.org_id}, {"$set": {"ignored": data.ignored}})
    return {"ok": True}


class CreateExpenseInput(BaseModel):
    category: str = "other"
    vendor_name: Optional[str] = ""


@router.post("/bank/transactions/{txn_id}/create-expense")
async def create_expense(txn_id: str, data: CreateExpenseInput, ctx: Ctx = Depends(get_ctx)):
    from app import ai
    d = get_db()
    t = await d.bank_txns.find_one({"id": txn_id, "org_id": ctx.org_id}, {"_id": 0})
    if not t or t["amount"] >= 0:
        raise HTTPException(status_code=400, detail="Only outgoing payments can become expenses")
    if t.get("match"):
        raise HTTPException(status_code=409, detail="Already matched")
    exp_id = str(uuid.uuid4())
    number = await next_number(ctx.org_id, "expense", "EXP")
    amount = round(-t["amount"], 2)
    await d.expenses.insert_one({"id": exp_id, "org_id": ctx.org_id, "number": number, "date": t["date"],
                                 "vendor_name": (data.vendor_name or t["description"])[:120], "vendor_afm": "",
                                 "category": data.category if data.category in ai.CATEGORIES else "other",
                                 "description": f"From bank: {t['description']}"[:300], "net": amount, "vat": 0.0, "total": amount, "vat_rate": 0,
                                 "currency": "EUR", "payment_method": "bank_transfer", "payment_status": "paid", "source": "bank",
                                 "created_by": ctx.user_id, "created_at": now(), "updated_at": now()})
    await d.bank_txns.update_one({"id": txn_id}, {"$set": {"match": {"type": "expense", "id": exp_id, "number": number, "auto": False}}})
    return {"id": exp_id, "number": number}
