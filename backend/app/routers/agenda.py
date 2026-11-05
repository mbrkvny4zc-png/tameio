"""Business calendar: every dated duty in one place, plus a private calendar feed for Google/Apple/Outlook.

Items come from the records themselves (an invoice's due date, a quote's expiry, a supplier certificate's
expiry...), so they appear and disappear on their own as work gets done. Tax deadlines and the business's
own reminders come from the tax calendar. Anything can also be ticked off by hand.

The feed is an iCalendar (.ics) URL with a long random token. Google Calendar, Apple Calendar and Outlook
subscribe to it and refresh it on their own schedule (Google: every few hours, up to a day).
"""
import secrets
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel

from app import config
from app.auth import Ctx, get_ctx
from app.common import esc
from app.db import get_db, now, today
from app.mailer import layout, send
from app.notify import notify
from app.ratelimit import rate_limit
from app.routers import taxes

router = APIRouter(tags=["agenda"])

# kind -> (English label, Greek label). The frontend shows these as filter chips and colours.
KINDS = {
    "tax": ("Tax deadline", "Φορολογική προθεσμία"),
    "get_paid": ("Payment due to you", "Είσπραξη"),
    "pay": ("Bill to pay", "Πληρωμή"),
    "mydata": ("Send to myDATA", "Διαβίβαση στο myDATA"),
    "quote": ("Quote expires", "Λήξη προσφοράς"),
    "supplier": ("Supplier document expires", "Λήξη εγγράφου προμηθευτή"),
    "delivery": ("Delivery to confirm", "Επιβεβαίωση παράδοσης"),
    "recurring": ("Recurring invoice", "Επαναλαμβανόμενο τιμολόγιο"),
    "receipts": ("Receipts for your accountant", "Αποδείξεις για τον λογιστή"),
    "reminder": ("Your reminder", "Υπενθύμισή σας"),
}


def _money(v) -> str:
    return f"€{(v or 0):,.2f}"


def _d(v) -> Optional[str]:
    """First 10 chars of an ISO date/datetime, or None."""
    if not v:
        return None
    s = str(v)[:10]
    try:
        date.fromisoformat(s)
        return s
    except ValueError:
        return None


def _item(key, kind, title, title_el, when, link, amount=None, notes="", auto=True) -> dict:
    return {"key": key, "kind": kind, "title": title, "title_el": title_el, "date": when, "link": link,
            "amount": round(amount, 2) if amount is not None else None, "notes": notes, "auto": auto}


async def build_agenda(org_id: str, start: date, end: date) -> list:
    """All open duties dated between start and end, plus anything overdue before start."""
    d = get_db()
    t = date.fromisoformat(today())
    out = []

    # Tax deadlines and the business's own reminders (from the tax calendar settings).
    months = max(1, min(13, (end.year - t.year) * 12 + end.month - t.month + 1))
    for it in await taxes.build_calendar(org_id, min(start, t), months):
        custom = it["kind"] == "custom"
        out.append({**_item(it["key"], "reminder" if custom else "tax", it["title_en"], it["title"], it["date"],
                            "/app/calendar", it.get("estimate"), it.get("notes", ""), auto=False), "sub": it["kind"]})

    # Money you're owed: open invoices with a due date.
    for inv in await d.invoices.find({"org_id": org_id, "status": {"$in": ["sent", "overdue", "partially_paid"]},
                                      "kind": {"$ne": "credit_note"}, "due_date": {"$ne": None}}, {"_id": 0}).to_list(5000):
        bal = inv.get("balance") if inv.get("balance") is not None else inv.get("total")
        who = inv.get("client_name") or ""
        out.append(_item(f"inv:{inv['id']}", "get_paid", f"Payment due: {inv['number']} · {who} · {_money(bal)}",
                         f"Είσπραξη: {inv['number']} · {who} · {_money(bal)}", _d(inv["due_date"]), "/app/invoices", bal))

    # Bills you owe: expenses saved as unpaid.
    for e in await d.expenses.find({"org_id": org_id, "payment_status": "unpaid"}, {"_id": 0}).to_list(5000):
        who = e.get("vendor_name") or ""
        when = _d(e.get("due_date")) or _d(e.get("date"))
        if when:
            out.append(_item(f"exp:{e['id']}", "pay", f"Pay {who} · {_money(e.get('total'))}", f"Πληρωμή {who} · {_money(e.get('total'))}",
                             when, "/app/expenses", e.get("total")))

    # Issued invoices not yet sent to myDATA — one line per day, so a backlog doesn't flood the calendar.
    unsent = defaultdict(list)
    for inv in await d.invoices.find({"org_id": org_id, "status": {"$ne": "draft"}, "mydata.state": {"$ne": "transmitted"}},
                                     {"_id": 0, "number": 1, "issue_date": 1}).to_list(5000):
        if _d(inv.get("issue_date")):
            unsent[_d(inv["issue_date"])].append(inv["number"])
    for day, nums in unsent.items():
        n = len(nums)
        out.append(_item(f"mydata:{day}", "mydata", f"Send to myDATA: {', '.join(nums[:3])}{'…' if n > 3 else ''}" if n <= 3 else f"Send {n} invoices to myDATA",
                         f"Διαβίβαση στο myDATA: {', '.join(nums[:3])}" if n <= 3 else f"Διαβίβαση {n} τιμολογίων στο myDATA", day, "/app/mydata"))

    # Quotes waiting for an answer.
    for q in await d.documents.find({"org_id": org_id, "doc_type": "quote", "status": {"$in": ["draft", "sent"]},
                                     "valid_until": {"$ne": None}}, {"_id": 0}).to_list(5000):
        who = q.get("client_name") or ""
        out.append(_item(f"quote:{q['id']}", "quote", f"Quote expires: {q['number']} · {who}", f"Λήγει η προσφορά {q['number']} · {who}",
                         _d(q["valid_until"]), "/app/quotes", q.get("total")))

    # Supplier certificates and contracts that expire.
    from app.routers import suppliers as sup  # local import: suppliers imports a lot
    reqs = await sup._requirements(org_id)
    for s in await d.suppliers.find({"org_id": org_id, "status": {"$ne": "archived"}}, {"_id": 0}).to_list(2000):
        for r in sup.compute_compliance(s, reqs)["items"]:
            if r.get("expiry_date") and r["state"] in ("valid", "expiring", "expired"):
                label = r["label"].split(" (")[0]
                out.append(_item(f"sup:{s['id']}:{r['key']}", "supplier", f"{s.get('name', '')}: {label} expires",
                                 f"{s.get('name', '')}: λήγει {r['label'].split('(')[-1].rstrip(')') if '(' in r['label'] else label}",
                                 _d(r["expiry_date"]), "/app/suppliers"))

    # Goods on the road: issued delivery notes not yet marked delivered.
    for n in await d.delivery_notes.find({"org_id": org_id, "status": "issued"}, {"_id": 0}).to_list(2000):
        when = _d(n.get("dispatch_date")) or _d(n.get("issued_at"))
        if when:
            who = n.get("recipient_name") or ""
            out.append(_item(f"dn:{n['id']}", "delivery", f"Confirm delivery: {n['number']} · {who}", f"Επιβεβαίωση παράδοσης: {n['number']} · {who}",
                             when, "/app/delivery-notes"))

    # Monthly invoices that will be drafted automatically.
    for inv in await d.invoices.find({"org_id": org_id, "recurring": "monthly", "next_recurring_at": {"$ne": None}}, {"_id": 0}).to_list(2000):
        who = inv.get("client_name") or ""
        out.append(_item(f"rec:{inv['id']}", "recurring", f"Recurring invoice drafted · {who} · {_money(inv.get('total'))}",
                         f"Δημιουργείται επαναλαμβανόμενο τιμολόγιο · {who} · {_money(inv.get('total'))}",
                         _d(inv["next_recurring_at"]), "/app/invoices", inv.get("total")))

    # The accountant asked for receipts.
    for r in await d.receipt_requests.find({"org_id": org_id, "status": "open"}, {"_id": 0}).to_list(500):
        n = sum(1 for i in r.get("items", []) if i.get("status") == "open")
        if n:
            out.append(_item(f"req:{r['id']}", "receipts", f"{r.get('requested_by_name', 'Your accountant')} needs {n} receipt{'s' if n != 1 else ''}",
                             f"{r.get('requested_by_name', 'Ο λογιστής')} ζητά {n} αποδείξεις", _d(r["created_at"]), "/app/requests"))

    done = {x["key"] for x in await d.tax_done.find({"org_id": org_id}, {"_id": 0, "key": 1}).to_list(5000)}
    s_iso, e_iso, t_iso = start.isoformat(), end.isoformat(), t.isoformat()
    seen, res = set(), []
    for it in sorted(out, key=lambda i: (i["date"] or "", i["kind"], i["title"])):
        if not it["date"] or it["key"] in seen:
            continue
        seen.add(it["key"])
        it["done"] = it["key"] in done
        it["overdue"] = it["date"] < t_iso and not it["done"]
        it["days_left"] = (date.fromisoformat(it["date"]) - t).days
        # In range, or older but still open (so nothing slips through the cracks).
        if s_iso <= it["date"] <= e_iso or (it["overdue"] and it["date"] < s_iso):
            res.append(it)
    return res


@router.get("/agenda")
async def agenda(start: Optional[str] = None, end: Optional[str] = None, ctx: Ctx = Depends(get_ctx)):
    t = date.fromisoformat(today())
    try:
        s = date.fromisoformat(start) if start else t.replace(day=1)
        e = date.fromisoformat(end) if end else s + timedelta(days=92)
    except ValueError:
        raise HTTPException(status_code=400, detail="Dates must be YYYY-MM-DD")
    if e < s or (e - s).days > 400:
        raise HTTPException(status_code=400, detail="Choose a range of up to a year")
    items = await build_agenda(ctx.org_id, s, e)
    return {"items": items, "kinds": {k: {"en": v[0], "el": v[1]} for k, v in KINDS.items()}, "today": t.isoformat()}


@router.get("/agenda/count")
async def count(ctx: Ctx = Depends(get_ctx)):
    """For the menu badge: what's overdue or due today, among the kinds this person follows."""
    t = date.fromisoformat(today())
    kinds = (await _settings(ctx.org_id, ctx.user_id))["kinds"]
    items = [i for i in await build_agenda(ctx.org_id, t, t) if not i["done"] and i["kind"] in kinds]
    return {"due": len(items), "overdue": sum(1 for i in items if i["overdue"])}


class DoneInput(BaseModel):
    key: str
    done: bool = True


@router.post("/agenda/done")
async def mark_done(data: DoneInput, ctx: Ctx = Depends(get_ctx)):
    return await taxes.mark_done(taxes.DoneInput(key=data.key, done=data.done), ctx)


# ------------------------------------------------------------------ personal settings (reminders) and the calendar feed

DEFAULTS = {"remind_days": 3, "email": True}


async def _settings(org_id: str, user_id: str) -> dict:
    doc = await get_db().agenda_settings.find_one({"org_id": org_id, "user_id": user_id}, {"_id": 0}) or {}
    return {"remind_days": doc.get("remind_days", DEFAULTS["remind_days"]), "email": doc.get("email", DEFAULTS["email"]),
            "kinds": doc.get("kinds") or list(KINDS), "lang": doc.get("lang", "el")}


class SettingsInput(BaseModel):
    remind_days: int = 3
    email: bool = True
    kinds: Optional[list] = None
    lang: str = "el"


@router.get("/agenda/settings")
async def read_settings(request: Request, ctx: Ctx = Depends(get_ctx)):
    feed = await get_db().calendar_feeds.find_one({"org_id": ctx.org_id, "user_id": ctx.user_id}, {"_id": 0})
    return {**await _settings(ctx.org_id, ctx.user_id), "feed_url": _feed_url(feed["token"]) if feed else None}


@router.put("/agenda/settings")
async def save_settings(data: SettingsInput, ctx: Ctx = Depends(get_ctx)):
    if data.remind_days not in (0, 1, 3, 7):
        raise HTTPException(status_code=400, detail="Reminders can be off, or 1, 3 or 7 days before")
    kinds = [k for k in (data.kinds or list(KINDS)) if k in KINDS] or list(KINDS)
    await get_db().agenda_settings.update_one({"org_id": ctx.org_id, "user_id": ctx.user_id},
                                              {"$set": {"remind_days": data.remind_days, "email": data.email, "kinds": kinds,
                                                                        "lang": "en" if data.lang == "en" else "el"}}, upsert=True)
    return await _settings(ctx.org_id, ctx.user_id)


def _feed_url(token: str) -> str:
    return f"{config.PUBLIC_URL}/api/calendar/{token}.ics"


class FeedInput(BaseModel):
    lang: str = "el"


@router.post("/agenda/feed")
async def create_feed(data: Optional[FeedInput] = None, ctx: Ctx = Depends(get_ctx)):
    """Create the private feed link — or replace it, which stops the old link working."""
    token = secrets.token_urlsafe(32)
    lang = "en" if data and data.lang == "en" else "el"
    await get_db().calendar_feeds.update_one({"org_id": ctx.org_id, "user_id": ctx.user_id},
                                             {"$set": {"token": token, "lang": lang, "created_at": now()}}, upsert=True)
    return {"feed_url": _feed_url(token)}


@router.delete("/agenda/feed")
async def delete_feed(ctx: Ctx = Depends(get_ctx)):
    await get_db().calendar_feeds.delete_one({"org_id": ctx.org_id, "user_id": ctx.user_id})
    return {"ok": True}


def _ics_text(s: str) -> str:
    return (s or "").replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\r", "").replace("\n", "\\n")


def _fold(line: str) -> str:
    """RFC 5545: lines longer than 75 octets continue on the next line, starting with a space."""
    b = line.encode("utf-8")
    if len(b) <= 75:
        return line
    parts, cur = [], b""
    for ch in line:
        e = ch.encode("utf-8")
        if len(cur) + len(e) > (75 if not parts else 74):
            parts.append(cur.decode("utf-8"))
            cur = b""
        cur += e
    parts.append(cur.decode("utf-8"))
    return "\r\n ".join(parts)


def to_ics(items: list, name: str, lang: str, remind_days: int) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tameio//Business calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             f"X-WR-CALNAME:{_ics_text(name)}", "X-WR-TIMEZONE:Europe/Athens", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H"]
    for it in items:
        day = date.fromisoformat(it["date"])
        title = it["title_el"] if lang == "el" else it["title"]
        kind = KINDS[it["kind"]][1 if lang == "el" else 0]
        desc = f"{kind}\n{config.PUBLIC_URL}{it['link']}" + (f"\n{it['notes']}" if it.get("notes") else "")
        lines += ["BEGIN:VEVENT", f"UID:{it['key'].replace(':', '-')}@tameio", f"DTSTAMP:{stamp}",
                  f"DTSTART;VALUE=DATE:{day:%Y%m%d}", f"DTEND;VALUE=DATE:{day + timedelta(days=1):%Y%m%d}",
                  f"SUMMARY:{_ics_text(('✓ ' if it['done'] else '') + title)}", f"DESCRIPTION:{_ics_text(desc)}",
                  f"URL:{config.PUBLIC_URL}{it['link']}", f"CATEGORIES:{_ics_text(kind)}", "TRANSP:TRANSPARENT"]
        if remind_days and not it["done"]:
            lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_text(title)}", f"TRIGGER:-P{remind_days}D", "END:VALARM"]
        lines.append("END:VEVENT")
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(x) for x in lines) + "\r\n"


@router.get("/calendar/{token}.ics")
async def feed(token: str, request: Request):
    """Public, token-protected. Calendar apps fetch this without a login."""
    rate_limit(request, f"ics:{token[:12]}", 120)
    d = get_db()
    f = await d.calendar_feeds.find_one({"token": token}, {"_id": 0}) if len(token) >= 20 else None
    if not f or not await d.memberships.find_one({"org_id": f["org_id"], "user_id": f["user_id"]}):
        raise HTTPException(status_code=404, detail="This calendar link isn't valid any more — create a new one in Tameio")
    t = date.fromisoformat(today())
    st = await _settings(f["org_id"], f["user_id"])
    items = [i for i in await build_agenda(f["org_id"], t - timedelta(days=60), t + timedelta(days=365)) if i["kind"] in st["kinds"]]
    org = await d.orgs.find_one({"id": f["org_id"]}, {"_id": 0, "name": 1}) or {}
    lang = f.get("lang") or st["lang"]
    await d.calendar_feeds.update_one({"token": token}, {"$set": {"last_fetched_at": now()}})
    body = to_ics(items, f"Tameio — {org.get('name', '')}".strip(" —"), lang, st["remind_days"])
    return Response(body, media_type="text/calendar; charset=utf-8",
                    headers={"Content-Disposition": 'inline; filename="tameio.ics"', "Cache-Control": "private, max-age=900"})


# ------------------------------------------------------------------ daily reminders (scheduler)

async def agenda_reminders(today_iso: Optional[str] = None) -> int:
    """Once a day per person: an in-app note and (if they want) an email listing what's due soon or overdue."""
    d = get_db()
    t = date.fromisoformat(today_iso or today())
    sent = 0
    members = await d.memberships.find({"role": {"$in": ["owner", "admin", "staff", "accountant"]}}, {"_id": 0}).to_list(200000)
    cache = {}
    for m in members:
        org_id, uid = m["org_id"], m["user_id"]
        st = await _settings(org_id, uid)
        if not st["remind_days"]:
            continue
        log_key = f"{org_id}:{uid}:{t.isoformat()}"
        if await d.agenda_reminder_log.find_one({"key": log_key}):
            continue
        org = await d.orgs.find_one({"id": org_id}, {"_id": 0, "kind": 1, "name": 1})
        if not org or org.get("kind") != "business":
            continue
        if org_id not in cache:
            cache[org_id] = await build_agenda(org_id, t, t + timedelta(days=7))
        due = [i for i in cache[org_id] if not i["done"] and i["kind"] in st["kinds"] and (i["overdue"] or 0 <= i["days_left"] <= st["remind_days"])]
        if m["role"] == "accountant":
            due = [i for i in due if i["kind"] in ("tax", "mydata", "receipts", "reminder")]
        await d.agenda_reminder_log.insert_one({"key": log_key, "at": now(), "count": len(due)})
        if not due:
            continue
        late = sum(1 for i in due if i["overdue"])
        msg = f"{len(due)} thing{'s' if len(due) != 1 else ''} due soon" + (f", {late} overdue" if late else "") + f" — {due[0]['title']}"
        await notify(org_id, "agenda", msg, "/app/calendar", user_id=uid)
        sent += 1
        user = await d.users.find_one({"id": uid}, {"_id": 0, "email": 1})
        if st["email"] and user and user.get("email"):
            el = st["lang"] == "el"
            rows = "".join(f"<li style='margin:4px 0'>{'<b style=color:#C0392B>' + ('Εκπρόθεσμο' if el else 'Overdue') + '</b> · ' if i['overdue'] else ''}"
                           f"{esc(i['date'])} — {esc(i['title_el'] if el else i['title'])}</li>" for i in due[:25])
            html = layout("Τι έχετε μπροστά σας" if el else "What's coming up", f"<p style='color:#555'>{esc(org.get('name', ''))}</p><ul style='padding-left:18px'>{rows}</ul>",
                          "Άνοιγμα ημερολογίου" if el else "Open your calendar", f"{config.PUBLIC_URL}/app/calendar", config.APP_NAME)
            try:
                await send(user["email"], ("Tameio — " + (f"{len(due)} εκκρεμότητες" if el else f"{len(due)} things due")), html)
            except Exception:  # noqa: BLE001 — never stop the run because email is down
                pass
    return sent
