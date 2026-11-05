"""'Ask your numbers': plain-language questions answered from the business's own books.

We never let the model query the database. Instead we build a compact, already-aggregated snapshot
(monthly totals, categories, clients, who owes what, recent expenses) and the model reads only that.
"""
from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import ai
from app.auth import Ctx, get_ctx
from app.db import get_db, now, today
from app.ratelimit import rate_limit
from app.routers.business import get_business
from app.routers.reports import _is_income, _signed

router = APIRouter(tags=["assistant"])


async def snapshot(org_id: str, months: int = 24) -> dict:
    d = get_db()
    t = date.fromisoformat(today())
    start = (t.replace(day=1) - timedelta(days=31 * (months - 1))).replace(day=1).isoformat()
    invoices = await d.invoices.find({"org_id": org_id, "issue_date": {"$gte": start}},
                                     {"_id": 0, "items": 0, "mydata.errors": 0}).to_list(50000)
    expenses = await d.expenses.find({"org_id": org_id, "date": {"$gte": start}}, {"_id": 0, "file": 0}).to_list(50000)
    biz = await get_business(org_id)

    monthly = defaultdict(lambda: {"income_net": 0.0, "income_vat": 0.0, "expenses_net": 0.0, "expenses_vat": 0.0, "invoices": 0, "receipts": 0})
    by_client = defaultdict(lambda: {"billed_net": 0.0, "invoices": 0})
    for i in invoices:
        if not _is_income(i):
            continue
        m = monthly[(i.get("issue_date") or "")[:7]]
        s = _signed(i)
        m["income_net"] += s * (i.get("subtotal") or 0)
        m["income_vat"] += s * (i.get("tax") or 0)
        m["receipts" if i.get("kind") == "receipt" else "invoices"] += 1
        if i.get("kind") != "receipt":
            c = by_client[i.get("client_name") or "—"]
            c["billed_net"] += s * (i.get("subtotal") or 0)
            c["invoices"] += 1
    cat_month = defaultdict(lambda: defaultdict(float))
    by_vendor = defaultdict(float)
    for e in expenses:
        if (e.get("currency") or "EUR") != "EUR":
            continue
        m = monthly[(e.get("date") or "")[:7]]
        m["expenses_net"] += e.get("net") or 0
        m["expenses_vat"] += e.get("vat") or 0
        cat_month[(e.get("date") or "")[:7]][ai.category_label(e.get("category"))] += e.get("total") or 0
        by_vendor[e.get("vendor_name") or "—"] += e.get("total") or 0

    r2 = lambda v: round(v, 2)  # noqa: E731
    unpaid = sorted([i for i in invoices if i.get("kind") not in ("credit_note", "receipt") and i.get("status") in ("sent", "overdue")],
                    key=lambda i: i.get("due_date") or "9999")
    open_bills = [e for e in expenses if e.get("payment_status") == "unpaid"]
    return {
        "business": biz.get("business_name") or "", "today": today(), "data_from": start,
        "months": {k: {kk: r2(vv) if isinstance(vv, float) else vv for kk, vv in v.items()} for k, v in sorted(monthly.items()) if k},
        "expenses_by_category_per_month": {k: {c: r2(v) for c, v in sorted(cats.items(), key=lambda x: -x[1])} for k, cats in sorted(cat_month.items()) if k},
        "top_clients": [{"client": k, **{kk: r2(vv) if isinstance(vv, float) else vv for kk, vv in v.items()}}
                        for k, v in sorted(by_client.items(), key=lambda x: -x[1]["billed_net"])[:25]],
        "top_suppliers": [{"supplier": k, "spent_gross": r2(v)} for k, v in sorted(by_vendor.items(), key=lambda x: -x[1])[:25]],
        "unpaid_invoices": [{"number": i["number"], "client": i.get("client_name"), "total": i.get("total"), "issued": i.get("issue_date"),
                             "due": i.get("due_date"), "overdue": i.get("status") == "overdue"} for i in unpaid[:60]],
        "unpaid_bills": [{"supplier": e.get("vendor_name"), "total": e.get("total"), "date": e.get("date")} for e in open_bills[:40]],
        "recent_expenses": [{"date": e.get("date"), "supplier": e.get("vendor_name"), "category": ai.category_label(e.get("category")),
                             "total": e.get("total"), "note": (e.get("description") or "")[:80]}
                            for e in sorted(expenses, key=lambda e: e.get("date") or "", reverse=True)[:80]],
    }


class AskInput(BaseModel):
    question: str
    history: Optional[List[dict]] = None


@router.post("/ask")
async def ask(data: AskInput, request: Request, ctx: Ctx = Depends(get_ctx)):
    q = (data.question or "").strip()
    if not q:
        raise HTTPException(status_code=400, detail="Type a question")
    if len(q) > 500:
        raise HTTPException(status_code=400, detail="Keep the question under 500 characters")
    rate_limit(request, f"ask:{ctx.org_id}", 60)
    try:
        out = await ai.ask_numbers(q, await snapshot(ctx.org_id), data.history or [])
    except ai.ScanError as e:
        raise HTTPException(status_code=503, detail=str(e))
    await get_db().ask_log.insert_one({"org_id": ctx.org_id, "user_id": ctx.user_id, "question": q, "answer": out.get("answer"), "created_at": now()})
    return out


# ------------------------------------------------------------------ "Write the invoice for me"

class DraftInput(BaseModel):
    text: str


@router.post("/ai/draft-invoice")
async def draft_invoice(data: DraftInput, request: Request, ctx: Ctx = Depends(get_ctx)):
    """Sentence -> reviewed draft. Nothing is saved: the app opens the normal editor pre-filled."""
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Describe the invoice, e.g. “Kafeneio Plaka, 3 hours of electrical work”")
    if len(text) > 1000:
        raise HTTPException(status_code=400, detail="Keep it under 1000 characters")
    rate_limit(request, f"draft:{ctx.org_id}", 60)
    d = get_db()
    clients = await d.clients.find({"org_id": ctx.org_id, "sample": {"$ne": True}}, {"_id": 0}).to_list(2000)
    products = await d.products.find({"org_id": ctx.org_id}, {"_id": 0}).sort("uses", -1).to_list(2000)
    try:
        out = await ai.draft_invoice(
            text, [{"id": c["id"], "name": c["name"], "company": c.get("company", ""), "afm": c.get("afm", "")} for c in clients[:400]],
            [{"id": p["id"], "name": p["name"], "price": p["unit_price"], "vat": p["tax_rate"]} for p in products[:400]])
    except ai.ScanError as e:
        raise HTTPException(status_code=503, detail=str(e))
    return resolve_draft(out, clients, products)


def resolve_draft(out: dict, clients: list, products: list) -> dict:
    """Trust only ids that exist; fill saved prices; convert VAT-inclusive prices to net."""
    from app import greek_tax as gt
    by_id = {p["id"]: p for p in products}
    client = next((c for c in clients if c["id"] == out.get("client_id")), None)
    if not client and out.get("client_afm"):
        client = next((c for c in clients if c.get("afm") and c["afm"] == gt.normalize_afm(out["client_afm"])), None)
    first_product = next((by_id[i["product_id"]] for i in out.get("items") or [] if i.get("product_id") in by_id), None)
    rate = out.get("tax_rate")
    if rate is None:
        rate = first_product["tax_rate"] if first_product else 24
    items, missing = [], []
    for i in out.get("items") or []:
        p = by_id.get(i.get("product_id"))
        price = i.get("unit_price")
        if price is not None and out.get("prices_include_vat"):
            price = round(price / (1 + rate / 100), 4)
        if price is None and p:
            price = p["unit_price"]
        if price is None:
            missing.append(i.get("description") or "")
        row = {"description": (i.get("description") or (p or {}).get("name") or "").strip()[:500], "qty": i.get("qty") or 1, "unit_price": price if price is not None else ""}
        if p:
            row["product_id"] = p["id"]
        items.append(row)
    questions = list(out.get("questions") or [])
    if missing:
        questions.append("Add a price for: " + ", ".join(m for m in missing if m))
    return {"doc_kind": out.get("doc_kind") or "invoice",
            "client_id": client["id"] if client else None,
            "client_name": client["name"] if client else (out.get("client_name") or ""),
            "client_afm": (client or {}).get("afm") or gt.normalize_afm(out.get("client_afm") or ""),
            "items": items or [{"description": "", "qty": 1, "unit_price": ""}], "tax_rate": rate,
            "due_in_days": out.get("due_in_days"), "notes": out.get("notes") or "", "questions": questions,
            "matched_client": bool(client)}
