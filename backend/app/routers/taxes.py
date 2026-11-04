"""Tax calendar: upcoming filing/payment deadlines with an estimate of the VAT due.

Deadlines follow the usual Greek pattern (VAT returns and e-ΕΦΚΑ contributions by the last working
day of the following month; annual income tax return by a yearly date). Rules change — every
date is shown as a reminder to confirm with your accountant, and businesses can add their own.
"""
import uuid
from datetime import date, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now, today
from app.notify import notify
from app.routers.reports import compute_summary

router = APIRouter(tags=["taxes"])
MONTHS_EL = ["", "Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"]


def last_working_day(y: int, m: int) -> date:
    d = date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def _month_end(y: int, m: int) -> date:
    return date(y + (m == 12), m % 12 + 1, 1) - timedelta(days=1)


def _add_months(y: int, m: int, k: int) -> tuple:
    t = y * 12 + (m - 1) + k
    return t // 12, t % 12 + 1


class TaxSettings(BaseModel):
    vat_period: str = "quarterly"     # monthly | quarterly | none
    efka_monthly: bool = True         # self-employed social security contributions
    income_tax_month_day: str = "07-15"
    custom: Optional[List[dict]] = None


async def settings(org_id: str) -> dict:
    doc = await get_db().tax_settings.find_one({"org_id": org_id}, {"_id": 0}) or {}
    return {"vat_period": doc.get("vat_period", "quarterly"), "efka_monthly": doc.get("efka_monthly", True),
            "income_tax_month_day": doc.get("income_tax_month_day", "07-15"), "custom": doc.get("custom", [])}


@router.get("/tax/settings")
async def read_settings(ctx: Ctx = Depends(get_ctx)):
    return await settings(ctx.org_id)


@router.put("/tax/settings")
async def save_settings(data: TaxSettings, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    if data.vat_period not in ("monthly", "quarterly", "none"):
        raise HTTPException(status_code=400, detail="VAT period must be monthly, quarterly or none")
    try:
        mm, dd = (int(x) for x in data.income_tax_month_day.split("-"))
        date(2026, mm, dd)
    except ValueError:
        raise HTTPException(status_code=400, detail="Income tax deadline must be MM-DD")
    custom = []
    for c in (data.custom or [])[:50]:
        try:
            dt = date.fromisoformat(str(c.get("date", ""))[:10]).isoformat()
        except ValueError:
            raise HTTPException(status_code=400, detail="Custom deadlines need a date")
        if not str(c.get("title", "")).strip():
            raise HTTPException(status_code=400, detail="Custom deadlines need a title")
        custom.append({"id": c.get("id") or uuid.uuid4().hex[:8], "title": str(c["title"]).strip()[:120], "date": dt, "notes": str(c.get("notes", ""))[:300]})
    await get_db().tax_settings.update_one({"org_id": ctx.org_id}, {"$set": {"vat_period": data.vat_period, "efka_monthly": data.efka_monthly,
                                                                            "income_tax_month_day": data.income_tax_month_day, "custom": custom}}, upsert=True)
    return await settings(ctx.org_id)


async def build_calendar(org_id: str, start: date, months: int = 4) -> list:
    st = await settings(org_id)
    end = start + timedelta(days=31 * months)
    items = []
    y, m = start.year, start.month
    for k in range(-2, months + 1):
        py, pm = _add_months(y, m, k)  # period month
        dy, dm = _add_months(py, pm, 1)  # due in the following month
        due = last_working_day(dy, dm)
        if st["vat_period"] == "monthly":
            ps, pe = date(py, pm, 1), _month_end(py, pm)
            items.append({"key": f"vat:{py}-{pm:02d}", "kind": "vat", "title": f"VAT return — {MONTHS_EL[pm]} {py}", "title_en": f"VAT return — {date(py, pm, 1):%B %Y}",
                          "date": due.isoformat(), "period_start": ps.isoformat(), "period_end": pe.isoformat()})
        elif st["vat_period"] == "quarterly" and pm in (3, 6, 9, 12):
            ps, pe = date(py, pm - 2, 1), _month_end(py, pm)
            q = pm // 3
            items.append({"key": f"vat:{py}-Q{q}", "kind": "vat", "title": f"VAT return — Q{q} {py}", "title_en": f"VAT return — Q{q} {py}",
                          "date": due.isoformat(), "period_start": ps.isoformat(), "period_end": pe.isoformat()})
        if st["efka_monthly"]:
            items.append({"key": f"efka:{py}-{pm:02d}", "kind": "efka", "title": f"e-ΕΦΚΑ εισφορές — {MONTHS_EL[pm]} {py}",
                          "title_en": f"e-EFKA contributions — {date(py, pm, 1):%B %Y}", "date": due.isoformat()})
    mm, dd = (int(x) for x in st["income_tax_month_day"].split("-"))
    for yr in (start.year, start.year + 1):
        items.append({"key": f"income:{yr - 1}", "kind": "income_tax", "title": f"Δήλωση φορολογίας εισοδήματος {yr - 1}",
                      "title_en": f"Income tax return for {yr - 1}", "date": date(yr, mm, dd).isoformat()})
    for c in st["custom"]:
        items.append({"key": f"custom:{c['id']}", "kind": "custom", "title": c["title"], "title_en": c["title"], "date": c["date"], "notes": c.get("notes", "")})
    done = {x["key"] for x in await get_db().tax_done.find({"org_id": org_id}, {"_id": 0, "key": 1}).to_list(2000)}
    out = []
    for it in sorted(items, key=lambda i: i["date"]):
        if not (start - timedelta(days=45)).isoformat() <= it["date"] <= end.isoformat():
            continue
        it["done"] = it["key"] in done
        it["days_left"] = (date.fromisoformat(it["date"]) - start).days
        if it["kind"] == "vat":
            s = await compute_summary(org_id, it["period_start"], it["period_end"])
            it["estimate"] = s["vat"]["payable"]
        out.append(it)
    return [o for o in out if o["days_left"] >= 0 or not o["done"]]


@router.get("/tax/calendar")
async def calendar(months: int = 4, ctx: Ctx = Depends(get_ctx)):
    return {"items": await build_calendar(ctx.org_id, date.fromisoformat(today()), max(1, min(months, 12))),
            "note": "Typical Greek deadlines — confirm dates with your accountant; the VAT figure is an estimate from what's recorded here."}


class DoneInput(BaseModel):
    key: str
    done: bool = True


@router.post("/tax/done")
async def mark_done(data: DoneInput, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    if data.done:
        await d.tax_done.update_one({"org_id": ctx.org_id, "key": data.key}, {"$set": {"by": ctx.name, "at": now()}}, upsert=True)
    else:
        await d.tax_done.delete_one({"org_id": ctx.org_id, "key": data.key})
    return {"ok": True}


async def tax_reminders(today_iso: Optional[str] = None) -> int:
    """Scheduler: in-app reminder 7 days before each open deadline (once)."""
    d = get_db()
    t = date.fromisoformat(today_iso or today())
    n = 0
    for org in await d.orgs.find({"kind": "business"}, {"_id": 0, "id": 1}).to_list(100000):
        for it in await build_calendar(org["id"], t, 1):
            if it["done"] or not (0 <= it["days_left"] <= 7):
                continue
            key = f"{org['id']}:{it['key']}"
            if await d.tax_reminder_log.find_one({"key": key}):
                continue
            await d.tax_reminder_log.insert_one({"key": key, "at": now()})
            extra = f" · estimated €{it['estimate']:,.2f}" if it.get("estimate") is not None and it["estimate"] > 0 else ""
            await notify(org["id"], "tax", f"{it['title_en']} due {it['date']}{extra}", "/app/calendar")
            n += 1
    return n
