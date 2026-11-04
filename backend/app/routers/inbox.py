"""Receipts by email: each business gets receipts+<token>@INBOUND_DOMAIN.

Point your email provider's inbound webhook (Postmark, Mailgun routes, Cloudflare Email Workers,
Resend inbound…) at POST /api/inbound/email with the shared secret. Attachments from known senders
are read by AI and wait in the Scan inbox for a quick review.
"""
import base64
import hmac
import re
import secrets
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now
from app.notify import notify
from app.plans import PLANS, plan_of, usage

router = APIRouter(tags=["inbox"])
ADDR_RE = re.compile(r"receipts\+([A-Za-z0-9_-]{12,})@", re.I)
MAX_ATTACHMENTS = 10


async def _inbox(org_id: str) -> dict:
    d = get_db()
    doc = await d.inbox_settings.find_one({"org_id": org_id}, {"_id": 0})
    if not doc:
        doc = {"org_id": org_id, "token": secrets.token_urlsafe(12).replace("-", "x").replace("_", "y"), "allowed": [], "created_at": now()}
        await d.inbox_settings.insert_one({**doc})
    return doc


async def _member_emails(org_id: str) -> List[str]:
    d = get_db()
    ids = [m["user_id"] for m in await d.memberships.find({"org_id": org_id}, {"_id": 0, "user_id": 1}).to_list(500)]
    return [u["email"].lower() for u in await d.users.find({"id": {"$in": ids}}, {"_id": 0, "email": 1}).to_list(500)]


@router.get("/inbox/address")
async def address(ctx: Ctx = Depends(get_ctx)):
    doc = await _inbox(ctx.org_id)
    return {"address": f"receipts+{doc['token']}@{config.INBOUND_DOMAIN}" if config.INBOUND_DOMAIN else "",
            "configured": bool(config.INBOUND_DOMAIN and config.INBOUND_SECRET), "allowed": doc.get("allowed", []),
            "members": await _member_emails(ctx.org_id)}


class SendersInput(BaseModel):
    allowed: List[str]


@router.put("/inbox/senders")
async def senders(data: SendersInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    clean = sorted({e.strip().lower() for e in data.allowed if re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+|@[^@\s]+\.[^@\s]+", e.strip())})[:50]
    await _inbox(ctx.org_id)
    await get_db().inbox_settings.update_one({"org_id": ctx.org_id}, {"$set": {"allowed": clean}})
    return {"allowed": clean}


@router.post("/inbox/rotate")
async def rotate(ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    await _inbox(ctx.org_id)
    await get_db().inbox_settings.update_one({"org_id": ctx.org_id}, {"$set": {"token": secrets.token_urlsafe(12).replace("-", "x").replace("_", "y")}})
    return await address(ctx)


def _addr(v) -> str:
    """'Maria <maria@x.gr>' -> 'maria@x.gr'"""
    if isinstance(v, dict):
        v = v.get("Email") or v.get("email") or v.get("address") or ""
    m = re.search(r"[^<\s\"']+@[^>\s\"']+", str(v or ""))
    return m.group(0).lower() if m else ""


def _normalise(payload: dict) -> dict:
    """Accept a generic shape or Postmark's inbound JSON."""
    to = payload.get("to") or payload.get("To") or payload.get("OriginalRecipient") or ""
    if isinstance(to, list):
        to = " ".join(_addr(x) for x in to)
    to_full = payload.get("ToFull")
    if isinstance(to_full, list):
        to = to + " " + " ".join(_addr(x) for x in to_full)
    sender = _addr(payload.get("from") or payload.get("FromFull") or payload.get("From"))
    atts = []
    for a in payload.get("attachments") or payload.get("Attachments") or []:
        atts.append({"filename": a.get("filename") or a.get("Name") or "attachment",
                     "content_type": a.get("content_type") or a.get("contentType") or a.get("ContentType") or "",
                     "content": a.get("content") or a.get("Content") or ""})
    return {"to": str(to), "from": sender, "subject": (payload.get("subject") or payload.get("Subject") or "")[:200], "attachments": atts}


@router.post("/inbound/email")
async def inbound(request: Request, secret: Optional[str] = None):
    from app.routers.expenses import process_scan
    given = request.headers.get("x-inbound-secret") or secret or ""
    if not config.INBOUND_SECRET or not hmac.compare_digest(given, config.INBOUND_SECRET):
        raise HTTPException(status_code=401, detail="Invalid secret")
    try:
        msg = _normalise(await request.json())
    except ValueError:
        raise HTTPException(status_code=400, detail="Expected JSON")
    m = ADDR_RE.search(msg["to"])
    if not m:
        return {"accepted": 0, "reason": "no inbox address"}
    d = get_db()
    inbox = await d.inbox_settings.find_one({"token": m.group(1)}, {"_id": 0})
    if not inbox:
        return {"accepted": 0, "reason": "unknown inbox"}
    org_id = inbox["org_id"]
    allowed = set(await _member_emails(org_id)) | set(inbox.get("allowed", []))
    sender = msg["from"]
    if sender not in allowed and f"@{sender.split('@')[-1]}" not in allowed:
        await d.inbox_log.insert_one({"org_id": org_id, "from": sender, "subject": msg["subject"], "result": "rejected_sender", "created_at": now()})
        return {"accepted": 0, "reason": "sender not allowed"}
    key, plan = await plan_of(org_id)
    room = plan["scans_month"] - (await usage(org_id))["scans_month"] if plan["scans_month"] >= 0 else MAX_ATTACHMENTS
    accepted, skipped = 0, []
    for a in msg["attachments"][:MAX_ATTACHMENTS]:
        if accepted >= room:
            skipped.append(f"{a['filename']}: monthly scan limit reached")
            continue
        try:
            data = base64.b64decode(a["content"], validate=False)
            await process_scan(org_id, None, data, a["filename"], a["content_type"], source="email", meta={"email_from": sender, "email_subject": msg["subject"]})
            accepted += 1
        except HTTPException as e:  # not a receipt (signature images, .ics …) — skip quietly
            skipped.append(f"{a['filename']}: {e.detail}")
        except (ValueError, TypeError):
            skipped.append(f"{a['filename']}: unreadable attachment")
    await d.inbox_log.insert_one({"org_id": org_id, "from": sender, "subject": msg["subject"], "result": "ok", "accepted": accepted,
                                  "skipped": skipped, "created_at": now()})
    if accepted:
        await notify(org_id, "inbox", f"{accepted} document{'s' if accepted != 1 else ''} arrived by email from {sender} — ready to review", "/app/scan")
    return {"accepted": accepted, "skipped": skipped}
