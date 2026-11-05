"""Partner programme for accounting firms: referral links, client attribution and revenue share.

- Every accounting-firm (practice) account gets a referral code and link: {PUBLIC_URL}/r/{code}.
- A business is attributed to a firm once, permanently (first touch): when it signs up through the link,
  when the firm sets the business up itself, or when the owner enters the code within ATTRIBUTION_DAYS.
- Revenue share = the firm's % of each referred business's plan price, month by month, using the plan in
  force at the end of each month. Billing isn't connected yet, so this is based on list prices (ex VAT);
  swap `_month_revenue` for real payments once billing exists.
"""
import csv
import io
import re
import secrets
import unicodedata
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app import config
from app.auth import Ctx, current_user, get_ctx, require_role
from app.db import get_db, now
from app.plans import PLANS
from app.ratelimit import rate_limit

router = APIRouter(tags=["partners"])
ATTRIBUTION_DAYS = 60
CODE_RE = re.compile(r"^[A-Z0-9][A-Z0-9-]{2,23}$")


def _is_admin(u: dict) -> bool:
    return u["email"].lower() in config.PLATFORM_ADMINS


def _slug(name: str) -> str:
    s = unicodedata.normalize("NFD", name or "")
    greek = str.maketrans("ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩαβγδεζηθικλμνξοπρσςτυφχψω",
                          "ABGDEZITIKLMNXOPRSTYFXPOabgdeziqiklmnxoprsstyfxpo")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").translate(greek).upper()
    return re.sub(r"[^A-Z0-9]+", "", s)[:10] or "PARTNER"


async def partner_of(org_id: str, create: bool = True) -> Optional[dict]:
    d = get_db()
    p = await d.partners.find_one({"org_id": org_id}, {"_id": 0})
    if p or not create:
        return p
    org = await d.orgs.find_one({"id": org_id}, {"_id": 0})
    if not org or org.get("kind") != "practice":
        return None
    biz = await d.business.find_one({"org_id": org_id}, {"_id": 0, "business_name": 1}) or {}
    base = _slug(biz.get("business_name", ""))
    for _ in range(20):
        code = f"{base}-{secrets.token_hex(2).upper()}"
        if not await d.partners.find_one({"code": code}):
            break
    p = {"org_id": org_id, "code": code, "share_pct": config.PARTNER_SHARE_PCT, "created_at": now()}
    await d.partners.update_one({"org_id": org_id}, {"$setOnInsert": p}, upsert=True)
    return await d.partners.find_one({"org_id": org_id}, {"_id": 0})


async def attribute(business_org_id: str, partner_org_id: str, source: str, code: str = "") -> bool:
    """First touch wins and never changes. Returns True when this call set it."""
    d = get_db()
    if business_org_id == partner_org_id:
        return False
    r = await d.orgs.update_one({"id": business_org_id, "kind": "business", "referred_by": None},
                                {"$set": {"referred_by": {"partner_org_id": partner_org_id, "code": code, "source": source, "at": now()}}})
    return bool(r.modified_count)


async def attribute_by_code(business_org_id: str, code: str, source: str = "link") -> bool:
    code = (code or "").strip().upper()
    if not code:
        return False
    p = await get_db().partners.find_one({"code": code}, {"_id": 0})
    return bool(p) and await attribute(business_org_id, p["org_id"], source, code)


# ------------------------------------------------------------------ revenue maths

def _months(n: int, until: Optional[str] = None) -> list:
    d = date.fromisoformat(until + "-01") if until else date.today().replace(day=1)
    out = []
    for _ in range(n):
        out.append(d.strftime("%Y-%m"))
        d = (d - timedelta(days=1)).replace(day=1)
    return list(reversed(out))


def _month_end(m: str) -> str:
    y, mo = int(m[:4]), int(m[5:])
    nxt = date(y + (mo == 12), 1 if mo == 12 else mo + 1, 1)
    return (nxt - timedelta(days=1)).isoformat() + "T23:59:59+00:00"


def _plan_at(org: dict, changes: list, moment: str) -> str:
    """Plan in force at `moment`, replayed from the plan-change log (oldest first)."""
    past = [c for c in changes if c["at"] <= moment]
    if past:
        return past[-1]["plan"]
    return (changes[0].get("from") or "free") if changes else (org.get("plan") or "free")


def _month_revenue(org: dict, changes: list, m: str) -> tuple:
    """(plan, monthly price ex VAT) the business was on at the end of month m — 0 before it was referred."""
    end = min(_month_end(m), now())
    since = (org.get("referred_by") or {}).get("at") or org.get("created_at") or ""
    if since[:7] > m:
        return None, 0.0
    plan = _plan_at(org, changes, end)
    return plan, float(PLANS.get(plan, PLANS["free"])["price"])


async def report(partner_org_id: str, months: int = 12) -> dict:
    d = get_db()
    p = await partner_of(partner_org_id)
    if not p:
        raise HTTPException(status_code=404, detail="Partner programme is for accounting-firm accounts")
    pct = float(p.get("share_pct") or 0)
    orgs = await d.orgs.find({"referred_by.partner_org_id": partner_org_id}, {"_id": 0}).to_list(5000)
    names = {b["org_id"]: b.get("business_name") or "—" for b in
             await d.business.find({"org_id": {"$in": [o["id"] for o in orgs]}}, {"_id": 0, "org_id": 1, "business_name": 1, "afm": 1}).to_list(5000)}
    changes = {}
    for c in await d.plan_changes.find({"org_id": {"$in": [o["id"] for o in orgs]}}, {"_id": 0}).sort("at", 1).to_list(50000):
        changes.setdefault(c["org_id"], []).append(c)
    payouts = {x["month"]: x for x in await d.partner_payouts.find({"partner_org_id": partner_org_id}, {"_id": 0}).to_list(500)}
    month_list = _months(max(1, min(months, 36)))
    rows = []
    for m in month_list:
        revenue, paying = 0.0, 0
        for o in orgs:
            _, price = _month_revenue(o, changes.get(o["id"], []), m)
            revenue += price
            paying += 1 if price > 0 else 0
        share = round(revenue * pct / 100, 2)
        po = payouts.get(m)
        rows.append({"month": m, "paying_clients": paying, "revenue": round(revenue, 2), "share": share,
                     "paid": bool(po), "paid_at": po.get("paid_at") if po else None, "paid_amount": po.get("amount") if po else None})
    current = month_list[-1]
    clients = []
    for o in sorted(orgs, key=lambda x: (x.get("referred_by") or {}).get("at") or "", reverse=True):
        plan, price = _month_revenue(o, changes.get(o["id"], []), current)
        rb = o.get("referred_by") or {}
        clients.append({"org_id": o["id"], "name": names.get(o["id"], "—"), "source": rb.get("source"), "since": rb.get("at"),
                        "plan": plan or o.get("plan"), "plan_name": PLANS.get(plan or o.get("plan") or "free", PLANS["free"])["name"],
                        "monthly": price, "your_share": round(price * pct / 100, 2)})
    closed = [r for r in rows if r["month"] < current]
    return {"code": p["code"], "link": f"{config.PUBLIC_URL}/r/{p['code']}", "share_pct": pct,
            "clients": clients, "months": rows,
            "totals": {"referred": len(orgs), "paying": sum(1 for c in clients if c["monthly"] > 0),
                       "this_month": rows[-1]["share"], "earned": round(sum(r["share"] for r in rows), 2),
                       "unpaid": round(sum(r["share"] for r in closed if not r["paid"]), 2)},
            "note": "Estimated from list prices (ex VAT) until billing is connected."}


# ------------------------------------------------------------------ firm endpoints

def _practice(ctx: Ctx):
    if ctx.org_kind != "practice":
        raise HTTPException(status_code=403, detail="The partner programme is for accounting-firm accounts")
    require_role(ctx, "owner", "admin")


@router.get("/partner")
async def my_partner(months: int = 12, ctx: Ctx = Depends(get_ctx)):
    _practice(ctx)
    return await report(ctx.org_id, months)


class CodeInput(BaseModel):
    code: str


@router.put("/partner/code")
async def set_code(data: CodeInput, ctx: Ctx = Depends(get_ctx)):
    """Firms can pick a memorable code once (e.g. PAPADOPOULOS). Old links stop working, so it's guarded."""
    _practice(ctx)
    code = (data.code or "").strip().upper()
    if not CODE_RE.fullmatch(code):
        raise HTTPException(status_code=400, detail="Use 3–24 letters, digits or dashes (Latin), e.g. PAPADOPOULOS")
    d = get_db()
    other = await d.partners.find_one({"code": code}, {"_id": 0, "org_id": 1})
    if other and other["org_id"] != ctx.org_id:
        raise HTTPException(status_code=409, detail="That code is taken — try another")
    await partner_of(ctx.org_id)
    await d.partners.update_one({"org_id": ctx.org_id}, {"$set": {"code": code, "updated_at": now()}})
    return await report(ctx.org_id)


@router.get("/partner/report.csv")
async def report_csv(months: int = 12, ctx: Ctx = Depends(get_ctx)):
    _practice(ctx)
    return _csv(await report(ctx.org_id, months))


def _csv(r: dict) -> StreamingResponse:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Month", "Paying clients", "Revenue (ex VAT)", f"Share {r['share_pct']:g}%", "Paid out"])
    for m in r["months"]:
        w.writerow([m["month"], m["paying_clients"], f"{m['revenue']:.2f}", f"{m['share']:.2f}", (m["paid_at"] or "")[:10]])
    w.writerow([])
    w.writerow(["Client", "Referred", "How", "Plan", "Monthly (ex VAT)", "Share"])
    for c in r["clients"]:
        name = c["name"]
        if name[:1] in ("=", "+", "-", "@"):
            name = "'" + name
        w.writerow([name, (c["since"] or "")[:10], c["source"], c["plan_name"], f"{c['monthly']:.2f}", f"{c['your_share']:.2f}"])
    return StreamingResponse(iter(["﻿" + buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="partner-{r["code"]}.csv"'})


# ------------------------------------------------------------------ public + business side

@router.get("/public/ref/{code}")
async def ref_info(code: str, request: Request):
    """Shown on the landing/sign-up page: 'Recommended by <firm>'."""
    rate_limit(request, "ref-info", 600)
    d = get_db()
    p = await d.partners.find_one({"code": code.strip().upper()}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Unknown referral code")
    biz = await d.business.find_one({"org_id": p["org_id"]}, {"_id": 0, "business_name": 1}) or {}
    return {"code": p["code"], "firm": biz.get("business_name") or "Your accountant"}


@router.get("/referral")
async def my_referral(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    org = await d.orgs.find_one({"id": ctx.org_id}, {"_id": 0}) or {}
    rb = org.get("referred_by")
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(org.get("created_at") or now())).days
    firm = None
    if rb:
        firm = (await d.business.find_one({"org_id": rb["partner_org_id"]}, {"_id": 0, "business_name": 1}) or {}).get("business_name")
    return {"referred": bool(rb), "firm": firm, "since": (rb or {}).get("at"), "can_add": not rb and org.get("kind") == "business" and age <= ATTRIBUTION_DAYS}


@router.post("/referral")
async def add_referral(data: CodeInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    info = await my_referral(ctx)
    if not info["can_add"]:
        raise HTTPException(status_code=400, detail="A referral can only be added once, within 60 days of signing up")
    if not await attribute_by_code(ctx.org_id, data.code, "code"):
        raise HTTPException(status_code=404, detail="That referral code wasn't found")
    return await my_referral(ctx)


# ------------------------------------------------------------------ platform admin

def _admin(u: dict):
    if not _is_admin(u):
        raise HTTPException(status_code=403, detail="Not allowed")


@router.get("/admin/partners")
async def all_partners(u: dict = Depends(current_user)):
    _admin(u)
    d = get_db()
    out = []
    for p in await d.partners.find({}, {"_id": 0}).to_list(2000):
        r = await report(p["org_id"], 12)
        biz = await d.business.find_one({"org_id": p["org_id"]}, {"_id": 0, "business_name": 1, "business_email": 1}) or {}
        out.append({"org_id": p["org_id"], "firm": biz.get("business_name"), "email": biz.get("business_email"), "code": p["code"],
                    "share_pct": r["share_pct"], **r["totals"], "months": r["months"]})
    return sorted(out, key=lambda x: -x["earned"])


class ShareInput(BaseModel):
    share_pct: float


@router.put("/admin/partners/{org_id}")
async def set_share(org_id: str, data: ShareInput, u: dict = Depends(current_user)):
    _admin(u)
    if not 0 <= data.share_pct <= 100:
        raise HTTPException(status_code=400, detail="Share must be between 0 and 100%")
    if not await partner_of(org_id):
        raise HTTPException(status_code=404, detail="Not an accounting-firm account")
    await get_db().partners.update_one({"org_id": org_id}, {"$set": {"share_pct": round(data.share_pct, 2)}})
    return {"ok": True}


class PayoutInput(BaseModel):
    month: str
    note: Optional[str] = ""


@router.post("/admin/partners/{org_id}/payouts")
async def mark_paid(org_id: str, data: PayoutInput, u: dict = Depends(current_user)):
    _admin(u)
    if not re.fullmatch(r"\d{4}-\d{2}", data.month or ""):
        raise HTTPException(status_code=400, detail="Month must be YYYY-MM")
    if data.month >= date.today().strftime("%Y-%m"):
        raise HTTPException(status_code=400, detail="Only finished months can be paid out")
    r = await report(org_id, 36)
    row = next((m for m in r["months"] if m["month"] == data.month), None)
    if not row:
        raise HTTPException(status_code=400, detail="Month is outside the report")
    await get_db().partner_payouts.update_one({"partner_org_id": org_id, "month": data.month},
                                              {"$set": {"amount": row["share"], "paid_at": now(), "by": u["email"], "note": (data.note or "")[:200]}},
                                              upsert=True)
    return {"ok": True, "amount": row["share"]}


@router.delete("/admin/partners/{org_id}/payouts/{month}")
async def unmark_paid(org_id: str, month: str, u: dict = Depends(current_user)):
    _admin(u)
    await get_db().partner_payouts.delete_one({"partner_org_id": org_id, "month": month})
    return {"ok": True}


@router.get("/admin/partners/{org_id}/report.csv")
async def admin_csv(org_id: str, months: int = 12, u: dict = Depends(current_user)):
    _admin(u)
    return _csv(await report(org_id, months))


@router.put("/admin/orgs/{org_id}/referral")
async def admin_set_referral(org_id: str, data: CodeInput, u: dict = Depends(current_user)):
    """Correct an attribution by hand (e.g. a firm forgot to send its link). Empty code removes it."""
    _admin(u)
    d = get_db()
    if not data.code.strip():
        await d.orgs.update_one({"id": org_id}, {"$set": {"referred_by": None}})
        return {"ok": True}
    p = await d.partners.find_one({"code": data.code.strip().upper()}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Unknown code")
    await d.orgs.update_one({"id": org_id, "kind": "business"},
                            {"$set": {"referred_by": {"partner_org_id": p["org_id"], "code": p["code"], "source": "admin", "at": now()}}})
    return {"ok": True}
