"""The creator's management area, user feedback & bug reports, crash capture and automations.

Access: only emails in config.PLATFORM_ADMINS (always includes OWNER_EMAIL).
"""
import hashlib
import logging
import traceback
import uuid
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.auth import Ctx, current_user, get_ctx
from app.db import get_db, now
from app.mailer import layout, send
from app.notify import notify
from app.plans import PLANS
from app.ratelimit import rate_limit

log = logging.getLogger("admin")
router = APIRouter(tags=["admin"])


def is_admin(u: dict) -> bool:
    return (u.get("email") or "").lower() in config.PLATFORM_ADMINS


def _admin(u: dict):
    if not is_admin(u):
        raise HTTPException(status_code=403, detail="Not allowed")


def _days_ago(n: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=n)).isoformat()


# ------------------------------------------------------------------ overview report

@router.get("/admin/overview")
async def overview(days: int = 30, u: dict = Depends(current_user)):
    _admin(u)
    d = get_db()
    days = max(7, min(days, 365))
    since = _days_ago(days)
    users = await d.users.find({}, {"_id": 0, "id": 1, "created_at": 1, "last_login_at": 1, "account_type": 1}).to_list(100000)
    orgs = await d.orgs.find({}, {"_id": 0, "id": 1, "kind": 1, "plan": 1, "created_at": 1, "referred_by": 1}).to_list(100000)
    biz = [o for o in orgs if o.get("kind") == "business"]
    plans = Counter(o.get("plan") or "free" for o in biz)
    mrr = sum(PLANS.get(p, PLANS["free"])["price"] * n for p, n in plans.items())
    active_orgs = set(await d.invoices.distinct("org_id", {"created_at": {"$gte": since}})) | set(await d.expenses.distinct("org_id", {"created_at": {"$gte": since}}))

    # signups per day for the chart
    series = defaultdict(lambda: {"businesses": 0, "firms": 0})
    for o in orgs:
        day = (o.get("created_at") or "")[:10]
        if day >= since[:10]:
            series[day]["firms" if o.get("kind") == "practice" else "businesses"] += 1
    start = date.fromisoformat(since[:10])
    chart = [{"day": (start + timedelta(days=i)).isoformat(), **series[(start + timedelta(days=i)).isoformat()]} for i in range(days + 1)]

    docs = await d.invoices.find({"created_at": {"$gte": since}, "sample": {"$ne": True}}, {"_id": 0, "kind": 1, "total": 1, "org_id": 1}).to_list(200000)
    tx = await d.mydata_transmissions.find({"created_at": {"$gte": since}}, {"_id": 0, "ok": 1, "environment": 1}).to_list(200000)
    per_org = Counter(x["org_id"] for x in docs)
    names = {b["org_id"]: b.get("business_name") for b in await d.business.find({"org_id": {"$in": [k for k, _ in per_org.most_common(10)]}}, {"_id": 0, "org_id": 1, "business_name": 1}).to_list(10)}
    return {
        "period_days": days,
        "users": {"total": len(users), "new": sum(1 for x in users if (x.get("created_at") or "") >= since),
                  "active": sum(1 for x in users if (x.get("last_login_at") or x.get("created_at") or "") >= since),
                  "accountants": sum(1 for x in users if x.get("account_type") == "accountant")},
        "orgs": {"businesses": len(biz), "firms": sum(1 for o in orgs if o.get("kind") == "practice"), "active": len(active_orgs & {o["id"] for o in biz}),
                 "referred": sum(1 for o in biz if o.get("referred_by")), "new": sum(1 for o in biz if (o.get("created_at") or "") >= since)},
        "plans": {k: plans.get(k, 0) for k in PLANS if k != "practice"},
        "mrr": round(mrr, 2), "arr": round(mrr * 12, 2),
        "paying": sum(n for p, n in plans.items() if PLANS.get(p, PLANS["free"])["price"] > 0),
        "usage": {"invoices": sum(1 for x in docs if x.get("kind") in ("invoice", None)), "receipts": sum(1 for x in docs if x.get("kind") == "receipt"),
                  "credit_notes": sum(1 for x in docs if x.get("kind") == "credit_note"),
                  "invoiced_value": round(sum(x.get("total") or 0 for x in docs if x.get("kind") != "credit_note"), 2),
                  "mydata_ok": sum(1 for x in tx if x.get("ok")), "mydata_failed": sum(1 for x in tx if not x.get("ok")),
                  "mydata_live": sum(1 for x in tx if x.get("ok") and x.get("environment") == "production"),
                  "scans": await d.scans.count_documents({"created_at": {"$gte": since}}),
                  "ai_questions": await d.ask_log.count_documents({"created_at": {"$gte": since}}),
                  "delivery_notes": await d.delivery_notes.count_documents({"created_at": {"$gte": since}}),
                  "shop_orders": await d.shop_orders.count_documents({"created_at": {"$gte": since}})},
        "top_businesses": [{"org_id": k, "name": names.get(k) or "—", "documents": n} for k, n in per_org.most_common(10)],
        "feedback": {s: await d.feedback.count_documents({"status": s}) for s in ("new", "in_progress", "fixed", "wont_fix")},
        "errors_24h": await d.error_log.count_documents({"last_seen": {"$gte": _days_ago(1)}}),
        "signups": chart,
    }


@router.get("/admin/users")
async def users(q: str = "", u: dict = Depends(current_user)):
    _admin(u)
    d = get_db()
    query = {"$or": [{"email": {"$regex": q.strip(), "$options": "i"}}, {"name": {"$regex": q.strip(), "$options": "i"}}]} if q.strip() else {}
    rows = await d.users.find(query, {"_id": 0, "password": 0, "totp_secret": 0}).sort("created_at", -1).to_list(500)
    mem = await d.memberships.find({"user_id": {"$in": [r["id"] for r in rows]}}, {"_id": 0}).to_list(5000)
    org_ids = list({m["org_id"] for m in mem})
    orgs = {o["id"]: o for o in await d.orgs.find({"id": {"$in": org_ids}}, {"_id": 0}).to_list(5000)}
    names = {b["org_id"]: b.get("business_name") for b in await d.business.find({"org_id": {"$in": org_ids}}, {"_id": 0, "org_id": 1, "business_name": 1}).to_list(5000)}
    by_user = defaultdict(list)
    for m in mem:
        o = orgs.get(m["org_id"], {})
        by_user[m["user_id"]].append({"org_id": m["org_id"], "name": names.get(m["org_id"]) or "—", "role": m["role"], "kind": o.get("kind"), "plan": o.get("plan")})
    return [{"id": r["id"], "email": r["email"], "name": r.get("name"), "account_type": r.get("account_type", "business"), "created_at": r.get("created_at"),
             "last_login_at": r.get("last_login_at"), "two_factor": bool(r.get("totp_enabled")), "orgs": by_user.get(r["id"], [])} for r in rows]


# ------------------------------------------------------------------ feedback & bug reports

KINDS = ("bug", "idea", "question")
STATUSES = ("new", "in_progress", "fixed", "wont_fix")


class FeedbackInput(BaseModel):
    kind: str = "bug"
    message: str
    page: Optional[str] = ""
    user_agent: Optional[str] = ""
    screenshot: Optional[str] = ""  # data:image/... (optional)


@router.post("/feedback")
async def send_feedback(data: FeedbackInput, request: Request, ctx: Ctx = Depends(get_ctx)):
    rate_limit(request, f"feedback:{ctx.user_id}", 30)
    msg = (data.message or "").strip()
    if len(msg) < 5:
        raise HTTPException(status_code=400, detail="Tell us a bit more (at least a few words)")
    shot = data.screenshot or ""
    if shot and (not shot.startswith("data:image/") or len(shot) > 2_500_000):
        raise HTTPException(status_code=400, detail="Screenshot must be an image under ~2 MB")
    doc = {"id": str(uuid.uuid4()), "number": await _next_feedback_number(), "kind": data.kind if data.kind in KINDS else "bug",
           "message": msg[:5000], "page": (data.page or "")[:300], "user_agent": (data.user_agent or "")[:300], "screenshot": shot,
           "user_id": ctx.user_id, "email": ctx.email, "name": ctx.name, "org_id": ctx.org_id, "status": "new", "replies": [],
           "source": "user", "created_at": now(), "updated_at": now()}
    await get_db().feedback.insert_one({**doc})
    await _tell_owner(doc)
    return {k: v for k, v in doc.items() if k != "screenshot"}


async def _next_feedback_number() -> int:
    from pymongo import ReturnDocument
    c = await get_db().counters.find_one_and_update({"org_id": "_platform", "key": "feedback"}, {"$inc": {"seq": 1}}, upsert=True,
                                                    return_document=ReturnDocument.AFTER)
    return c["seq"]


async def _tell_owner(doc: dict):
    """Automation: every new report is emailed to the creator (when email is configured)."""
    if not config.OWNER_EMAIL:
        return
    label = {"bug": "Bug", "idea": "Idea", "question": "Question"}[doc["kind"]]
    html = layout(f"{label} #{doc['number']} from {doc.get('name') or doc.get('email')}",
                  f"<p>{doc['message'][:2000].replace('<', '&lt;')}</p><p style='color:#666'>Page: {doc.get('page') or '—'}</p>",
                  "Open in Tameio", f"{config.PUBLIC_URL}/app/admin?tab=reports", config.APP_NAME)
    try:
        await send(config.OWNER_EMAIL, f"[Tameio] {label} #{doc['number']}: {doc['message'][:60]}", html)
    except Exception as e:  # noqa: BLE001 — never fail the user's report because email is down
        log.warning("owner email failed: %s", e)


@router.get("/feedback")
async def my_feedback(ctx: Ctx = Depends(get_ctx)):
    return await get_db().feedback.find({"user_id": ctx.user_id, "source": "user"}, {"_id": 0, "screenshot": 0}).sort("created_at", -1).to_list(200)


@router.get("/admin/feedback")
async def all_feedback(status: str = "", kind: str = "", u: dict = Depends(current_user)):
    _admin(u)
    q = {}
    if status in STATUSES:
        q["status"] = status
    if kind in KINDS:
        q["kind"] = kind
    return await get_db().feedback.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)


class FeedbackUpdate(BaseModel):
    status: Optional[str] = None
    reply: Optional[str] = ""
    note: Optional[str] = None


@router.put("/admin/feedback/{fid}")
async def update_feedback(fid: str, data: FeedbackUpdate, u: dict = Depends(current_user)):
    _admin(u)
    d = get_db()
    fb = await d.feedback.find_one({"id": fid}, {"_id": 0})
    if not fb:
        raise HTTPException(status_code=404, detail="Report not found")
    sets = {"updated_at": now()}
    if data.status in STATUSES:
        sets["status"] = data.status
    if data.note is not None:
        sets["internal_note"] = data.note[:2000]
    upd = {"$set": sets}
    reply = (data.reply or "").strip()
    if reply:
        upd["$push"] = {"replies": {"text": reply[:3000], "by": u.get("name") or "Tameio", "at": now()}}
    await d.feedback.update_one({"id": fid}, upd)
    if fb.get("org_id") and (reply or (data.status and data.status != fb.get("status"))):
        label = {"fixed": "is fixed", "in_progress": "is being worked on", "wont_fix": "was closed", "new": "was reopened"}.get(data.status or "", "has a reply")
        await notify(fb["org_id"], "feedback", f"Your report #{fb['number']} {label}" + (f": {reply[:120]}" if reply else ""), "/app/feedback")
    return await d.feedback.find_one({"id": fid}, {"_id": 0})


# ------------------------------------------------------------------ crash capture

class CrashInput(BaseModel):
    message: str
    stack: Optional[str] = ""
    page: Optional[str] = ""
    user_agent: Optional[str] = ""


async def record_error(source: str, message: str, stack: str = "", page: str = "", user: str = "", user_agent: str = ""):
    """Group identical errors (same source + message + first stack line) and count them."""
    first = (stack or "").strip().splitlines()[:3]
    key = hashlib.sha1(f"{source}|{message[:300]}|{'|'.join(first)}".encode()).hexdigest()[:16]
    await get_db().error_log.update_one(
        {"key": key},
        {"$setOnInsert": {"key": key, "source": source, "message": message[:1000], "stack": (stack or "")[:8000], "first_seen": now(), "status": "open"},
         "$set": {"last_seen": now(), "last_page": page[:300], "last_user": user, "last_user_agent": user_agent[:300]}, "$inc": {"count": 1}},
        upsert=True)


@router.post("/errors")
async def report_crash(data: CrashInput, request: Request):
    """Called by the app when a screen crashes (no login required — the crash may be on the sign-in page)."""
    rate_limit(request, "crash", 120)
    u = ""
    try:
        u = (await current_user(request)).get("email", "")
    except HTTPException:
        pass
    await record_error("frontend", data.message or "Unknown error", data.stack or "", data.page or "", u, data.user_agent or "")
    return {"ok": True}


@router.get("/admin/errors")
async def errors(status: str = "open", u: dict = Depends(current_user)):
    _admin(u)
    q = {"status": status} if status in ("open", "resolved") else {}
    return await get_db().error_log.find(q, {"_id": 0}).sort("last_seen", -1).to_list(300)


class ErrorUpdate(BaseModel):
    status: str


@router.put("/admin/errors/{key}")
async def update_error(key: str, data: ErrorUpdate, u: dict = Depends(current_user)):
    _admin(u)
    await get_db().error_log.update_one({"key": key}, {"$set": {"status": "resolved" if data.status == "resolved" else "open"}})
    return {"ok": True}


# ------------------------------------------------------------------ automations

def jobs() -> dict:
    """Registry of background automations: name -> (title, description, coroutine function)."""
    from app.routers import custom_reports, invoices, payments, suppliers, taxes
    return {
        "overdue": ("Mark overdue invoices", "Sent invoices past their due date become “Overdue”.", invoices.flag_overdue),
        "recurring": ("Create recurring invoices", "Monthly invoices are copied as new drafts.", invoices.run_recurring),
        "supplier_reminders": ("Supplier document reminders", "Emails suppliers before their certificates expire.", suppliers.check_supplier_expiries),
        "payment_reminders": ("Payment reminders", "Polite emails to clients with overdue invoices.", payments.send_due_reminders),
        "tax_reminders": ("Tax deadline reminders", "Notifies businesses before VAT and other deadlines.", taxes.tax_reminders),
        "scheduled_reports": ("Send scheduled reports", "Emails each business's weekly (Mondays) and monthly (1st) reports to the chosen team members.", custom_reports.send_scheduled),
        "error_digest": ("Daily error digest", "Emails you a summary of new crashes and open bug reports.", error_digest),
    }


async def error_digest() -> int:
    d = get_db()
    since = _days_ago(1)
    errs = await d.error_log.find({"last_seen": {"$gte": since}, "status": "open"}, {"_id": 0}).to_list(50)
    new_fb = await d.feedback.find({"created_at": {"$gte": since}}, {"_id": 0, "screenshot": 0}).to_list(50)
    if not errs and not new_fb:
        return 0
    rows = "".join(f"<li>{e['count']}× {e['message'][:140].replace('<', '&lt;')}</li>" for e in errs)
    fb = "".join(f"<li>#{f['number']} {f['kind']}: {f['message'][:140].replace('<', '&lt;')}</li>" for f in new_fb)
    html = layout("Tameio — last 24 hours", f"<p><b>Errors</b></p><ul>{rows or '<li>None</li>'}</ul><p><b>New reports</b></p><ul>{fb or '<li>None</li>'}</ul>",
                  "Open management", f"{config.PUBLIC_URL}/app/admin", config.APP_NAME)
    await send(config.OWNER_EMAIL, "[Tameio] Daily digest", html)
    return len(errs) + len(new_fb)


async def automation_enabled(name: str) -> bool:
    s = await get_db().automation_settings.find_one({"name": name}, {"_id": 0})
    return not s or s.get("enabled", True)


async def run_job(name: str, trigger: str = "schedule") -> dict:
    title, _, fn = jobs()[name]
    started = datetime.now(timezone.utc)
    rec = {"id": str(uuid.uuid4()), "name": name, "trigger": trigger, "started_at": started.isoformat()}
    try:
        result = await fn()
        rec.update({"ok": True, "result": result if isinstance(result, (int, float, str)) else str(result)})
    except Exception as e:  # noqa: BLE001
        log.exception("automation %s failed", name)
        rec.update({"ok": False, "error": f"{type(e).__name__}: {e}"[:1000]})
        await record_error("automation", f"{title} failed: {e}", traceback.format_exc())
    rec["ms"] = int((datetime.now(timezone.utc) - started).total_seconds() * 1000)
    await get_db().automation_runs.insert_one({**rec})
    return rec


async def run_all(trigger: str = "schedule") -> dict:
    out = {}
    for name in jobs():
        if name == "error_digest":
            continue  # once a day, see below
        if await automation_enabled(name):
            out[name] = (await run_job(name, trigger)).get("result")
    last = await get_db().automation_runs.find_one({"name": "error_digest", "ok": True}, {"_id": 0}, sort=[("started_at", -1)])
    if await automation_enabled("error_digest") and (not last or last["started_at"] < _days_ago(1)):
        out["error_digest"] = (await run_job("error_digest", trigger)).get("result")
    return out


@router.get("/admin/automations")
async def list_automations(u: dict = Depends(current_user)):
    _admin(u)
    d = get_db()
    out = []
    for name, (title, desc, _) in jobs().items():
        runs = await d.automation_runs.find({"name": name}, {"_id": 0}).sort("started_at", -1).to_list(10)
        out.append({"name": name, "title": title, "description": desc, "enabled": await automation_enabled(name),
                    "last_run": runs[0] if runs else None, "recent": runs,
                    "failures": sum(1 for r in runs if not r.get("ok"))})
    return {"automations": out, "scheduler_enabled": config.SCHEDULER_ENABLED, "interval_minutes": 30}


@router.post("/admin/automations/{name}/run")
async def run_now(name: str, u: dict = Depends(current_user)):
    _admin(u)
    if name not in jobs():
        raise HTTPException(status_code=404, detail="Unknown automation")
    return await run_job(name, "manual")


class ToggleInput(BaseModel):
    enabled: bool


@router.put("/admin/automations/{name}")
async def toggle(name: str, data: ToggleInput, u: dict = Depends(current_user)):
    _admin(u)
    if name not in jobs():
        raise HTTPException(status_code=404, detail="Unknown automation")
    await get_db().automation_settings.update_one({"name": name}, {"$set": {"name": name, "enabled": data.enabled, "by": u["email"], "at": now()}}, upsert=True)
    return {"ok": True}
