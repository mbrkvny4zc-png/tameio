"""Money in vs money out: profit, VAT position, categories, receivables, CSV export for the accountant."""
import csv
import io
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app import ai
from app.auth import Ctx, get_ctx
from app.db import get_db, today

router = APIRouter(tags=["reports"])

INCOME_STATUSES = ("sent", "paid", "overdue")


def _cell(v):
    """Neutralise spreadsheet formulas in text cells (vendor names come from scanned documents)."""
    if isinstance(v, str) and v[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + v
    return v


def _range(start: Optional[str], end: Optional[str]):
    try:
        e = date.fromisoformat(end) if end else date.fromisoformat(today())
        s = date.fromisoformat(start) if start else e.replace(day=1)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
    if s > e:
        raise HTTPException(status_code=400, detail="Start date is after end date")
    return s.isoformat(), e.isoformat()


def _signed(inv: dict) -> int:
    return -1 if inv.get("kind") == "credit_note" else 1


def _is_income(inv: dict) -> bool:
    """Issued invoices count when sent; credit notes count once issued. Only EUR is summed."""
    if (inv.get("currency") or "EUR") != "EUR":
        return False
    return inv.get("status") == "credited" if inv.get("kind") == "credit_note" else inv.get("status") in INCOME_STATUSES


def _months_back(n: int):
    d = date.fromisoformat(today()).replace(day=1)
    out = []
    for _ in range(n):
        out.append(d.strftime("%Y-%m"))
        d = (d - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


@router.get("/reports/summary")
async def summary(start: Optional[str] = None, end: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    s, e = _range(start, end)
    d = get_db()
    invoices = await d.invoices.find({"org_id": ctx.org_id}, {"_id": 0, "items": 0, "mydata.errors": 0}).to_list(50000)
    expenses = await d.expenses.find({"org_id": ctx.org_id}, {"_id": 0}).to_list(50000)

    income_net = income_vat = 0.0
    clients = defaultdict(float)
    for inv in invoices:
        if _is_income(inv) and s <= (inv.get("issue_date") or "") <= e:
            sign = _signed(inv)
            income_net += sign * (inv.get("subtotal") or 0)
            income_vat += sign * (inv.get("tax") or 0)
            clients[inv.get("client_name") or "—"] += sign * (inv.get("subtotal") or 0)

    collected = sum(i.get("total") or 0 for i in invoices if i.get("status") == "paid" and s <= (i.get("paid_at") or "")[:10] <= e)
    receivable = [i for i in invoices if i.get("kind") != "credit_note" and i.get("status") in ("sent", "overdue")]
    overdue = [i for i in receivable if i.get("status") == "overdue"]

    exp_net = exp_vat = exp_total = 0.0
    by_cat = defaultdict(lambda: {"net": 0.0, "vat": 0.0, "total": 0.0, "count": 0})
    vendors = defaultdict(float)
    unpaid_bills = 0.0
    for x in expenses:
        if (x.get("currency") or "EUR") != "EUR":
            continue
        if x.get("payment_status") == "unpaid":
            unpaid_bills += x.get("total") or 0
        if not (s <= (x.get("date") or "") <= e):
            continue
        exp_net += x.get("net") or 0
        exp_vat += x.get("vat") or 0
        exp_total += x.get("total") or 0
        c = by_cat[x.get("category") or "other"]
        c["net"] += x.get("net") or 0
        c["vat"] += x.get("vat") or 0
        c["total"] += x.get("total") or 0
        c["count"] += 1
        vendors[x.get("vendor_name") or "—"] += x.get("net") or 0

    months = _months_back(12)
    series = {m: {"month": m, "income": 0.0, "expenses": 0.0} for m in months}
    for inv in invoices:
        m = (inv.get("issue_date") or "")[:7]
        if m in series and _is_income(inv):
            series[m]["income"] += _signed(inv) * (inv.get("subtotal") or 0)
    for x in expenses:
        m = (x.get("date") or "")[:7]
        if m in series and (x.get("currency") or "EUR") == "EUR":
            series[m]["expenses"] += x.get("net") or 0

    r = lambda v: round(v, 2)  # noqa: E731
    return {
        "range": {"start": s, "end": e},
        "income": {"net": r(income_net), "vat": r(income_vat), "gross": r(income_net + income_vat), "collected": r(collected)},
        "expenses": {"net": r(exp_net), "vat": r(exp_vat), "total": r(exp_total), "unpaid": r(unpaid_bills)},
        "profit": r(income_net - exp_net),
        "margin": round((income_net - exp_net) / income_net * 100, 1) if income_net > 0 else None,
        "vat": {"output": r(income_vat), "input": r(exp_vat), "payable": r(income_vat - exp_vat)},
        "receivables": {"total": r(sum(i.get("total") or 0 for i in receivable)), "count": len(receivable),
                        "overdue_total": r(sum(i.get("total") or 0 for i in overdue)), "overdue_count": len(overdue)},
        "categories": sorted([{"key": k, "label": ai.category_label(k), **{kk: r(vv) if kk != "count" else vv for kk, vv in v.items()}}
                              for k, v in by_cat.items()], key=lambda c: -c["total"]),
        "top_clients": [{"name": k, "net": r(v)} for k, v in sorted(clients.items(), key=lambda kv: -kv[1])[:5]],
        "top_vendors": [{"name": k, "net": r(v)} for k, v in sorted(vendors.items(), key=lambda kv: -kv[1])[:5]],
        "monthly": [{**v, "income": r(v["income"]), "expenses": r(v["expenses"]), "profit": r(v["income"] - v["expenses"])} for v in series.values()],
    }


@router.get("/reports/attention")
async def attention(ctx: Ctx = Depends(get_ctx)):
    """Counts for the dashboard's 'needs you' list."""
    d = get_db()
    org = ctx.org_id
    invoices = await d.invoices.find({"org_id": org}, {"_id": 0, "status": 1, "kind": 1, "mydata.state": 1}).to_list(50000)
    from app.routers.suppliers import _requirements, compute_compliance
    reqs = await _requirements(org)
    sup = [compute_compliance(s, reqs) for s in await d.suppliers.find({"org_id": org, "status": {"$ne": "rejected"}}, {"_id": 0}).to_list(5000)]
    return {
        "overdue_invoices": sum(1 for i in invoices if i.get("status") == "overdue"),
        "draft_invoices": sum(1 for i in invoices if i.get("status") == "draft"),
        "mydata_unreported": sum(1 for i in invoices if i.get("status") in ("sent", "paid", "overdue", "credited")
                                 and (i.get("mydata") or {}).get("state") not in ("transmitted", "cancelled")),
        "quotes_open": await d.documents.count_documents({"org_id": org, "doc_type": "quote", "status": "sent"}),
        "suppliers_blocked": sum(1 for c in sup if c["verdict"] == "blocked"),
        "suppliers_expiring": sum(1 for c in sup if any(i["state"] == "expiring" for i in c["items"])),
        "unpaid_bills": await d.expenses.count_documents({"org_id": org, "payment_status": "unpaid"}),
    }


@router.get("/reports/export.csv")
async def export_csv(kind: str = "expenses", start: Optional[str] = None, end: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    s, e = _range(start, end)
    buf = io.StringIO()
    w = csv.writer(buf)
    d = get_db()
    if kind == "expenses":
        w.writerow(["Number", "Date", "Vendor", "Vendor ΑΦΜ", "Category", "Description", "Net", "VAT", "Total", "VAT %", "Paid", "Doc no.", "ΜΑΡΚ"])
        for x in await d.expenses.find({"org_id": ctx.org_id, "date": {"$gte": s, "$lte": e}}, {"_id": 0}).sort("date", 1).to_list(50000):
            w.writerow([_cell(c) for c in [x.get("number"), x.get("date"), x.get("vendor_name"), x.get("vendor_afm"), ai.category_label(x.get("category")),
                        x.get("description"), x.get("net"), x.get("vat"), x.get("total"), x.get("vat_rate"), x.get("payment_status"),
                        x.get("document_number"), x.get("mark")]])
    elif kind == "invoices":
        w.writerow(["Number", "Type", "Date", "Client", "Client ΑΦΜ", "Net", "VAT", "Total", "Currency", "Status", "ΜΑΡΚ"])
        for i in await d.invoices.find({"org_id": ctx.org_id, "issue_date": {"$gte": s, "$lte": e}}, {"_id": 0}).sort("issue_date", 1).to_list(50000):
            sign = -1 if i.get("kind") == "credit_note" else 1
            w.writerow([_cell(c) for c in [i.get("number"), "Credit note" if sign < 0 else "Invoice", i.get("issue_date"), i.get("client_name"), i.get("client_afm"),
                        sign * (i.get("subtotal") or 0), sign * (i.get("tax") or 0), sign * (i.get("total") or 0), i.get("currency"),
                        i.get("status"), (i.get("mydata") or {}).get("mark") or ""]])
    else:
        raise HTTPException(status_code=400, detail="kind must be expenses or invoices")
    # Excel opens UTF-8 CSV correctly (Greek text) only with a BOM.
    data = "﻿" + buf.getvalue()
    return StreamingResponse(iter([data]), media_type="text/csv; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{kind}-{s}-to-{e}.csv"'})
