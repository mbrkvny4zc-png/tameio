"""Custom reports: a business builds the report it needs (data, period, grouping, figures), saves it,
shares it with the team, downloads it, and can have it emailed to chosen team members every week or month.
"""
import csv
import io
import uuid
from collections import defaultdict
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import ai, config
from app.auth import Ctx, get_ctx
from app.common import esc, money
from app.db import get_db, now, today
from app.mailer import layout, send
from app.notify import notify
from app.routers.business import get_business

router = APIRouter(tags=["custom-reports"])

# What each data source can be grouped by and which figures it has.
SOURCES = {
    "invoices": {"label": "Invoices & credit notes", "group": ["month", "week", "client", "status", "none"], "metrics": ["count", "net", "vat", "total", "paid", "balance"]},
    "receipts": {"label": "Retail receipts", "group": ["month", "week", "day", "payment_method", "none"], "metrics": ["count", "net", "vat", "total"]},
    "sales_by_product": {"label": "Sales by product / service", "group": ["product", "month"], "metrics": ["qty", "net", "count"]},
    "expenses": {"label": "Expenses", "group": ["month", "week", "category", "vendor", "payment_status", "none"], "metrics": ["count", "net", "vat", "total"]},
    "payments": {"label": "Payments received", "group": ["month", "week", "client", "payment_method", "none"], "metrics": ["count", "amount"]},
    "unpaid": {"label": "Unpaid invoices (who owes what)", "group": ["client", "age", "none"], "metrics": ["count", "total", "balance"]},
    "delivery_notes": {"label": "Delivery notes", "group": ["month", "status", "client", "none"], "metrics": ["count", "qty"]},
}
PERIODS = ("this_month", "last_month", "this_quarter", "last_quarter", "this_year", "last_year", "last_30_days", "last_7_days", "all_time", "custom")
SCHEDULES = ("none", "weekly", "monthly")

TEMPLATES = [
    {"name": "Sales by client this month", "source": "invoices", "period": "this_month", "group_by": "client", "metrics": ["count", "net", "total", "balance"]},
    {"name": "Who owes us money", "source": "unpaid", "period": "all_time", "group_by": "client", "metrics": ["count", "balance"]},
    {"name": "Expenses by category this quarter", "source": "expenses", "period": "this_quarter", "group_by": "category", "metrics": ["count", "net", "vat", "total"]},
    {"name": "Best-selling products this year", "source": "sales_by_product", "period": "this_year", "group_by": "product", "metrics": ["qty", "net"]},
    {"name": "VAT on sales by month", "source": "invoices", "period": "this_year", "group_by": "month", "metrics": ["net", "vat", "total"]},
    {"name": "Payments received last month", "source": "payments", "period": "last_month", "group_by": "payment_method", "metrics": ["count", "amount"]},
    {"name": "Shop takings by day", "source": "receipts", "period": "last_7_days", "group_by": "day", "metrics": ["count", "total"]},
]


class ReportDef(BaseModel):
    name: Optional[str] = ""
    source: str = "invoices"
    period: str = "this_month"
    start: Optional[str] = None
    end: Optional[str] = None
    group_by: str = "month"
    metrics: List[str] = ["count", "total"]
    status: Optional[str] = ""          # invoices: draft/sent/paid/overdue; expenses: paid/unpaid
    client_id: Optional[str] = None
    category: Optional[str] = ""
    sort: str = "value"                 # value | key
    limit: int = 50
    shared: bool = False                # visible to the whole team
    schedule: str = "none"              # none | weekly | monthly
    recipients: List[str] = []          # user ids in this business
    note: Optional[str] = ""            # message at the top of emailed copies


def period_range(period: str, start: Optional[str] = None, end: Optional[str] = None, ref: Optional[date] = None) -> tuple:
    t = ref or date.fromisoformat(today())
    q0 = date(t.year, 3 * ((t.month - 1) // 3) + 1, 1)
    if period == "custom":
        try:
            s, e = date.fromisoformat(start), date.fromisoformat(end)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="Choose a start and end date")
        if s > e:
            raise HTTPException(status_code=400, detail="Start date is after end date")
        return s.isoformat(), e.isoformat()
    first = t.replace(day=1)
    r = {
        "this_month": (first, t),
        "last_month": ((first - timedelta(days=1)).replace(day=1), first - timedelta(days=1)),
        "this_quarter": (q0, t),
        "last_quarter": ((q0 - timedelta(days=1)).replace(day=1) - timedelta(days=60), q0 - timedelta(days=1)),
        "this_year": (date(t.year, 1, 1), t),
        "last_year": (date(t.year - 1, 1, 1), date(t.year - 1, 12, 31)),
        "last_30_days": (t - timedelta(days=29), t),
        "last_7_days": (t - timedelta(days=6), t),
        "all_time": (date(2000, 1, 1), t),
    }[period if period in PERIODS else "this_month"]
    if period == "last_quarter":  # first day of the previous quarter
        prev_end = r[1]
        r = (date(prev_end.year, 3 * ((prev_end.month - 1) // 3) + 1, 1), prev_end)
    return r[0].isoformat(), r[1].isoformat()


def _week(d: str) -> str:
    y, w, _ = date.fromisoformat(d).isocalendar()
    return f"{y}-W{w:02d}"


def _age(due: Optional[str], issued: str) -> str:
    days = (date.fromisoformat(today()) - date.fromisoformat((due or issued)[:10])).days
    return "Not due yet" if days <= 0 else "1–30 days late" if days <= 30 else "31–60 days late" if days <= 60 else "Over 60 days late"


async def _records(org_id: str, r: ReportDef, s: str, e: str) -> list:
    """Flat rows {date, client, ..., metrics} for the chosen source and period."""
    d = get_db()
    out = []
    inv_q = {"org_id": org_id, "sample": {"$ne": True}, "currency": {"$in": ["EUR", None]}}
    if r.source in ("invoices", "unpaid", "payments", "sales_by_product", "receipts"):
        docs = await d.invoices.find(inv_q, {"_id": 0}).to_list(100000)
    if r.source == "invoices":
        for i in docs:
            if i.get("kind") == "receipt" or not (s <= (i.get("issue_date") or "") <= e):
                continue
            if r.status and i.get("status") != r.status:
                continue
            if not r.status and i.get("status") == "draft":
                continue
            if r.client_id and i.get("client_id") != r.client_id:
                continue
            sign = -1 if i.get("kind") == "credit_note" else 1
            paid = i.get("total") if i.get("status") == "paid" else (i.get("paid_amount") or 0)
            out.append({"date": i["issue_date"], "client": i.get("client_name") or "—", "status": i.get("status"),
                        "count": 1, "net": sign * (i.get("subtotal") or 0), "vat": sign * (i.get("tax") or 0), "total": sign * (i.get("total") or 0),
                        "paid": 0 if sign < 0 else paid, "balance": 0 if sign < 0 or i.get("status") == "paid" else round((i.get("total") or 0) - (i.get("paid_amount") or 0), 2),
                        "ref": i["number"]})
    elif r.source == "receipts":
        for i in docs:
            if i.get("kind") != "receipt" or i.get("status") == "draft" or not (s <= (i.get("issue_date") or "") <= e):
                continue
            out.append({"date": i["issue_date"], "payment_method": i.get("payment") or "card", "count": 1, "net": i.get("subtotal") or 0,
                        "vat": i.get("tax") or 0, "total": i.get("total") or 0, "ref": i["number"]})
    elif r.source == "sales_by_product":
        for i in docs:
            if i.get("kind") not in ("invoice", "receipt", None) or i.get("status") == "draft" or not (s <= (i.get("issue_date") or "") <= e):
                continue
            for it in i.get("items") or []:
                out.append({"date": i["issue_date"], "product": it.get("description") or "—", "count": 1, "qty": float(it.get("qty") or 0),
                            "net": round(float(it.get("qty") or 0) * float(it.get("unit_price") or 0), 2), "ref": i["number"]})
    elif r.source == "payments":
        for i in docs:
            if i.get("kind") in ("credit_note", "receipt"):
                continue
            pays = i.get("payments") or []
            if not pays and i.get("status") == "paid":
                pays = [{"date": (i.get("paid_at") or i["issue_date"])[:10], "amount": i.get("total") or 0, "method": i.get("paid_via") or "bank_transfer"}]
            for p in pays:
                if s <= p["date"] <= e and (not r.client_id or i.get("client_id") == r.client_id):
                    out.append({"date": p["date"], "client": i.get("client_name") or "—", "payment_method": p.get("method") or "other",
                                "count": 1, "amount": p.get("amount") or 0, "ref": i["number"]})
    elif r.source == "unpaid":
        for i in docs:
            if i.get("kind") in ("credit_note", "receipt") or i.get("status") not in ("sent", "overdue"):
                continue
            if r.client_id and i.get("client_id") != r.client_id:
                continue
            out.append({"date": i["issue_date"], "client": i.get("client_name") or "—", "age": _age(i.get("due_date"), i["issue_date"]), "count": 1,
                        "total": i.get("total") or 0, "balance": round((i.get("total") or 0) - (i.get("paid_amount") or 0), 2), "ref": i["number"]})
    elif r.source == "expenses":
        q = {"org_id": org_id, "sample": {"$ne": True}, "date": {"$gte": s, "$lte": e}}
        if r.status in ("paid", "unpaid"):
            q["payment_status"] = r.status
        if r.category:
            q["category"] = r.category
        for x in await d.expenses.find(q, {"_id": 0, "file": 0}).to_list(100000):
            out.append({"date": x["date"], "category": ai.category_label(x.get("category")), "vendor": x.get("vendor_name") or "—",
                        "payment_status": x.get("payment_status") or "paid", "count": 1, "net": x.get("net") or 0, "vat": x.get("vat") or 0,
                        "total": x.get("total") or 0, "ref": x.get("number") or x.get("document_number") or ""})
    elif r.source == "delivery_notes":
        for n in await d.delivery_notes.find({"org_id": org_id, "dispatch_date": {"$gte": s, "$lte": e}}, {"_id": 0, "xml": 0}).to_list(50000):
            out.append({"date": n["dispatch_date"], "status": n.get("status"), "client": n.get("recipient_name") or "—", "count": 1,
                        "qty": sum(float(i.get("qty") or 0) for i in n.get("items") or []), "ref": n["number"]})
    return out


def _clean(r: ReportDef) -> ReportDef:
    if r.source not in SOURCES:
        raise HTTPException(status_code=400, detail="Choose what the report is about")
    spec = SOURCES[r.source]
    if r.group_by not in spec["group"]:
        r.group_by = spec["group"][0]
    r.metrics = [m for m in r.metrics if m in spec["metrics"]] or spec["metrics"][:2]
    r.period = r.period if r.period in PERIODS else "this_month"
    r.limit = max(1, min(r.limit or 50, 500))
    r.schedule = r.schedule if r.schedule in SCHEDULES else "none"
    return r


async def run_report(org_id: str, r: ReportDef, ref: Optional[date] = None) -> dict:
    r = _clean(r)
    s, e = period_range(r.period, r.start, r.end, ref)
    recs = await _records(org_id, r, s, e)
    metrics = r.metrics
    if r.group_by == "none":
        rows = [{"key": f"{x.get('ref') or ''}", "date": x["date"], "label": x.get("client") or x.get("vendor") or x.get("product") or "",
                 **{m: round(x.get(m, 0), 2) for m in metrics}} for x in sorted(recs, key=lambda x: x["date"], reverse=True)]
    else:
        groups = defaultdict(lambda: {m: 0.0 for m in metrics})
        for x in recs:
            k = {"month": x["date"][:7], "week": _week(x["date"]), "day": x["date"]}.get(r.group_by, x.get(r.group_by) or "—")
            for m in metrics:
                groups[k][m] += x.get(m, 0) or 0
        rows = [{"key": k, **{m: round(v, 2) for m, v in g.items()}} for k, g in groups.items()]
        if r.sort == "key" or r.group_by in ("month", "week", "day"):
            rows.sort(key=lambda x: x["key"])
        else:
            first = next((m for m in metrics if m != "count"), metrics[0])
            rows.sort(key=lambda x: -abs(x.get(first, 0)))
    totals = {m: round(sum(x.get(m, 0) or 0 for x in recs), 2) for m in metrics}
    return {"name": r.name or SOURCES[r.source]["label"], "source": r.source, "group_by": r.group_by, "metrics": metrics,
            "start": s, "end": e, "rows": rows[: r.limit], "total_rows": len(rows), "totals": totals, "records": len(recs)}


# ------------------------------------------------------------------ CRUD

def _visible(ctx: Ctx):
    return {"org_id": ctx.org_id, "$or": [{"shared": True}, {"created_by": ctx.user_id}]}


async def _get(ctx: Ctx, rid: str) -> dict:
    doc = await get_db().custom_reports.find_one({"id": rid, **_visible(ctx)}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Report not found")
    return doc


async def _members(org_id: str) -> dict:
    d = get_db()
    ids = [m["user_id"] for m in await d.memberships.find({"org_id": org_id}, {"_id": 0, "user_id": 1}).to_list(500)]
    return {u["id"]: u for u in await d.users.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)}


async def _validate_sharing(ctx: Ctx, data: ReportDef):
    if (data.shared or data.schedule != "none") and ctx.role not in ("owner", "admin", "accountant"):
        raise HTTPException(status_code=403, detail="Only owners, admins and the accountant can share or schedule reports for the team")
    members = await _members(ctx.org_id)
    data.recipients = [x for x in dict.fromkeys(data.recipients) if x in members][:50]
    if data.schedule != "none" and not data.recipients:
        raise HTTPException(status_code=400, detail="Choose who should receive the scheduled report")


@router.get("/custom-reports/meta")
async def meta(ctx: Ctx = Depends(get_ctx)):
    members = await _members(ctx.org_id)
    return {"sources": SOURCES, "periods": PERIODS, "templates": TEMPLATES, "categories": ai.CATEGORIES,
            "members": [{"id": k, "name": v.get("name"), "email": v.get("email")} for k, v in members.items()],
            "can_share": ctx.role in ("owner", "admin", "accountant")}


@router.get("/custom-reports")
async def list_reports(ctx: Ctx = Depends(get_ctx)):
    return await get_db().custom_reports.find(_visible(ctx), {"_id": 0}).sort("updated_at", -1).to_list(500)


@router.post("/custom-reports/run")
async def run_adhoc(data: ReportDef, ctx: Ctx = Depends(get_ctx)):
    return await run_report(ctx.org_id, data)


@router.post("/custom-reports")
async def create_report(data: ReportDef, ctx: Ctx = Depends(get_ctx)):
    data = _clean(data)
    if not (data.name or "").strip():
        raise HTTPException(status_code=400, detail="Give the report a name")
    await _validate_sharing(ctx, data)
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, **data.model_dump(), "name": data.name.strip()[:100], "note": (data.note or "")[:1000],
           "created_by": ctx.user_id, "created_by_name": ctx.name, "created_at": now(), "updated_at": now(), "last_sent": None}
    await get_db().custom_reports.insert_one({**doc})
    return doc


@router.put("/custom-reports/{rid}")
async def update_report(rid: str, data: ReportDef, ctx: Ctx = Depends(get_ctx)):
    old = await _get(ctx, rid)
    if old["created_by"] != ctx.user_id and ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only the person who made this report, or an admin, can change it")
    data = _clean(data)
    await _validate_sharing(ctx, data)
    await get_db().custom_reports.update_one({"id": rid}, {"$set": {**data.model_dump(), "name": (data.name or old["name"]).strip()[:100], "updated_at": now()}})
    return await _get(ctx, rid)


@router.delete("/custom-reports/{rid}")
async def delete_report(rid: str, ctx: Ctx = Depends(get_ctx)):
    old = await _get(ctx, rid)
    if old["created_by"] != ctx.user_id and ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only the person who made this report, or an admin, can delete it")
    await get_db().custom_reports.delete_one({"id": rid})
    return {"ok": True}


@router.get("/custom-reports/{rid}/run")
async def run_saved(rid: str, ctx: Ctx = Depends(get_ctx)):
    return await run_report(ctx.org_id, ReportDef(**{k: v for k, v in (await _get(ctx, rid)).items() if k in ReportDef.model_fields}))


# ------------------------------------------------------------------ export & sending

LABELS = {"count": "Count", "net": "Net", "vat": "VAT", "total": "Total", "paid": "Paid", "balance": "Owed", "qty": "Quantity", "amount": "Amount"}
MONEY = {"net", "vat", "total", "paid", "balance", "amount"}


def _fmt(m: str, v) -> str:
    return money(v) if m in MONEY else (f"{v:g}" if isinstance(v, (int, float)) else str(v))


def to_csv(res: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    key_label = "Document" if res["group_by"] == "none" else res["group_by"].replace("_", " ").title()
    w.writerow([key_label] + (["Date", "Name"] if res["group_by"] == "none" else []) + [LABELS[m] for m in res["metrics"]])
    for r in res["rows"]:
        key = r["key"]
        if isinstance(key, str) and key[:1] in ("=", "+", "-", "@"):
            key = "'" + key
        w.writerow([key] + ([r.get("date"), r.get("label")] if res["group_by"] == "none" else []) + [r.get(m, 0) for m in res["metrics"]])
    w.writerow(["Total"] + (["", ""] if res["group_by"] == "none" else []) + [res["totals"][m] for m in res["metrics"]])
    return "﻿" + buf.getvalue()


@router.get("/custom-reports/{rid}/csv")
async def export_csv(rid: str, ctx: Ctx = Depends(get_ctx)):
    res = await run_saved(rid, ctx)
    name = "".join(c for c in res["name"] if c.isalnum() or c in " -_").strip().replace(" ", "-") or "report"
    return StreamingResponse(iter([to_csv(res)]), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})


def email_html(res: dict, biz_name: str, note: str = "") -> str:
    head = "".join(f"<th style='text-align:right;padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#666'>{LABELS[m]}</th>" for m in res["metrics"])
    rows = "".join(
        "<tr><td style='padding:6px 8px;border-bottom:1px solid #eee'>" + esc(r["key"]) + "</td>"
        + "".join(f"<td style='text-align:right;padding:6px 8px;border-bottom:1px solid #eee'>{esc(_fmt(m, r.get(m, 0)))}</td>" for m in res["metrics"]) + "</tr>"
        for r in res["rows"][:60])
    total = "".join(f"<td style='text-align:right;padding:8px;font-weight:700'>{esc(_fmt(m, res['totals'][m]))}</td>" for m in res["metrics"])
    body = (f"<p style='color:#555;margin:0 0 6px'>{esc(biz_name)} · {esc(res['start'])} – {esc(res['end'])}</p>"
            + (f"<p style='margin:0 0 14px'>{esc(note)}</p>" if note else "")
            + f"<table style='width:100%;border-collapse:collapse;font-size:13px'><tr><th style='text-align:left;padding:6px 8px;border-bottom:1px solid #ddd;font-size:12px;color:#666'></th>{head}</tr>"
            + rows + f"<tr><td style='padding:8px;font-weight:700'>Total</td>{total}</tr></table>"
            + (f"<p style='color:#888;font-size:12px'>Showing {min(60, len(res['rows']))} of {res['total_rows']} rows — open Tameio for the full report.</p>" if res["total_rows"] > 60 else ""))
    return layout(res["name"], body, "Open the report", f"{config.PUBLIC_URL}/app/reports/custom", biz_name)


async def deliver(doc: dict, ref: Optional[date] = None) -> dict:
    res = await run_report(doc["org_id"], ReportDef(**{k: v for k, v in doc.items() if k in ReportDef.model_fields}), ref)
    biz = await get_business(doc["org_id"])
    members = await _members(doc["org_id"])
    emailed = 0
    html = email_html(res, biz.get("business_name") or config.APP_NAME, doc.get("note") or "")
    for uid in doc.get("recipients") or []:
        u = members.get(uid)
        if u and await send(u["email"], f"{res['name']} — {res['start']} to {res['end']}", html):
            emailed += 1
    await notify(doc["org_id"], "report", f"Report ready: {res['name']} ({res['start']} – {res['end']})", "/app/reports/custom")
    sets = {"last_sent": now()}
    if ref:
        sets["last_scheduled_for"] = ref.isoformat()  # the day this scheduled run covered — prevents a second copy that day
    await get_db().custom_reports.update_one({"id": doc["id"]}, {"$set": sets})
    return {"emailed": emailed, "recipients": len(doc.get("recipients") or []), "report": res}


@router.post("/custom-reports/{rid}/send")
async def send_now(rid: str, ctx: Ctx = Depends(get_ctx)):
    doc = await _get(ctx, rid)
    if not doc.get("recipients"):
        raise HTTPException(status_code=400, detail="Choose who should receive this report first")
    r = await deliver(doc)
    return {"emailed": r["emailed"], "recipients": r["recipients"]}


async def send_scheduled(ref: Optional[date] = None) -> int:
    """Automation: weekly reports go out on Mondays, monthly ones on the 1st (covering the chosen period)."""
    t = ref or date.fromisoformat(today())
    due = []
    if t.weekday() == 0:
        due.append("weekly")
    if t.day == 1:
        due.append("monthly")
    sent = 0
    for doc in await get_db().custom_reports.find({"schedule": {"$in": due}}, {"_id": 0}).to_list(5000):
        if doc.get("last_scheduled_for") == t.isoformat():
            continue  # already sent for this day
        await deliver(doc, t)
        sent += 1
    return sent
