"""Organisations a user belongs to, team members, and invitations (including inviting your accountant)."""
import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.auth import Ctx, current_user, get_ctx, require_role
from app.common import esc
from app.db import get_db, now
from app.mailer import layout, send
from app.notify import notify
from app.plans import enforce
from app.ratelimit import rate_limit

router = APIRouter(tags=["team"])
ROLE_LABELS = {"owner": "Owner", "admin": "Admin", "staff": "Staff", "accountant": "Accountant"}
INVITE_DAYS = 14


async def org_name(org_id: str) -> str:
    b = await get_db().business.find_one({"org_id": org_id}, {"_id": 0, "business_name": 1}) or {}
    return b.get("business_name") or "Untitled business"


def can_manage(ctx: Ctx) -> bool:
    """Owner/admin manage the team. In a business an accountant set up for a client (no owner yet), the accountant does."""
    return ctx.role in ("owner", "admin") or (ctx.role == "accountant" and getattr(ctx, "org_has_owner", True) is False)


@router.get("/orgs")
async def my_orgs(u: dict = Depends(current_user)):
    d = get_db()
    out = []
    for m in await d.memberships.find({"user_id": u["id"]}, {"_id": 0}).sort("created_at", 1).to_list(1000):
        org = await d.orgs.find_one({"id": m["org_id"]}, {"_id": 0}) or {}
        out.append({"id": m["org_id"], "name": await org_name(m["org_id"]), "role": m["role"], "kind": org.get("kind", "business"),
                    "is_default": m["org_id"] == u.get("org_id")})
    return out


async def _with_owner_flag(ctx: Ctx) -> Ctx:
    org = await get_db().orgs.find_one({"id": ctx.org_id}, {"_id": 0, "owner_id": 1}) or {}
    ctx.org_has_owner = bool(org.get("owner_id"))
    return ctx


@router.get("/team/members")
async def members(ctx: Ctx = Depends(get_ctx)):
    ctx = await _with_owner_flag(ctx)
    d = get_db()
    out = []
    for m in await d.memberships.find({"org_id": ctx.org_id}, {"_id": 0}).sort("created_at", 1).to_list(500):
        u = await d.users.find_one({"id": m["user_id"]}, {"_id": 0, "name": 1, "email": 1}) or {}
        out.append({"user_id": m["user_id"], "name": u.get("name", ""), "email": u.get("email", ""), "role": m["role"], "since": m["created_at"],
                    "you": m["user_id"] == ctx.user_id})
    invites = await d.invites.find({"org_id": ctx.org_id, "accepted_at": None}, {"_id": 0, "token": 0}).sort("created_at", -1).to_list(200) if can_manage(ctx) else []
    return {"members": out, "invites": invites, "can_manage": can_manage(ctx), "your_role": ctx.role}


class InviteInput(BaseModel):
    email: str
    role: str = "staff"
    message: Optional[str] = ""


async def _send_invite(org_id: str, inviter: str, email: str, role: str, token: str, message: str = "") -> bool:
    name = await org_name(org_id)
    url = f"{config.PUBLIC_URL}/invite/{token}"
    what = "keep the books for" if role == "accountant" else "join"
    body = (f'<p style="color:#3A4358;font-size:14px;">{esc(inviter)} invited you to {what} <b>{esc(name)}</b> on {esc(config.APP_NAME)} as {ROLE_LABELS[role].lower()}.</p>'
            + (f'<p style="background:#F6F8FB;border-radius:10px;padding:10px 12px;font-size:13px;color:#3A4358;">{esc(message)}</p>' if message else "")
            + f'<p style="font-size:12px;color:#5B6478;">The invitation expires in {INVITE_DAYS} days.</p>')
    return await send(email, f"{inviter} invited you to {name}", layout(f"Join {name}", body, "Accept invitation", url))


async def create_invite(org_id: str, inviter_id: str, inviter_name: str, email: str, role: str, message: str = "") -> dict:
    email = email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    d = get_db()
    existing_user = await d.users.find_one({"email": email}, {"_id": 0, "id": 1})
    if existing_user and await d.memberships.find_one({"org_id": org_id, "user_id": existing_user["id"]}):
        raise HTTPException(status_code=409, detail="That person is already in this business")
    if await d.invites.find_one({"org_id": org_id, "email": email, "accepted_at": None}):
        raise HTTPException(status_code=409, detail="There's already a pending invitation for that email")
    if role not in ("accountant", "owner"):
        await enforce(org_id, "members")
    token = secrets.token_urlsafe(24)
    doc = {"id": secrets.token_hex(8), "org_id": org_id, "email": email, "role": role, "token": token, "invited_by": inviter_id,
           "created_at": now(), "expires_at": (datetime.now(timezone.utc) + timedelta(days=INVITE_DAYS)).isoformat(), "accepted_at": None}
    await d.invites.insert_one({**doc})
    emailed = await _send_invite(org_id, inviter_name, email, role, token, (message or "").strip()[:500])
    return {"emailed": emailed, "url": f"{config.PUBLIC_URL}/invite/{token}", "invite": {k: v for k, v in doc.items() if k != "token"}}



@router.post("/team/invites")
async def invite(data: InviteInput, request: Request, ctx: Ctx = Depends(get_ctx)):
    ctx = await _with_owner_flag(ctx)
    if not can_manage(ctx):
        raise HTTPException(status_code=403, detail="Only the owner or an admin can invite people")
    rate_limit(request, f"invite:{ctx.org_id}", 30)
    email = data.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    allowed = ("admin", "staff", "accountant") + (() if ctx.org_has_owner else ("owner",))
    if data.role not in allowed:
        raise HTTPException(status_code=400, detail="Choose admin, staff or accountant")
    return await create_invite(ctx.org_id, ctx.user_id, ctx.name, email, data.role, data.message or "")


@router.delete("/team/invites/{invite_id}")
async def revoke_invite(invite_id: str, ctx: Ctx = Depends(get_ctx)):
    ctx = await _with_owner_flag(ctx)
    if not can_manage(ctx):
        raise HTTPException(status_code=403, detail="Not allowed")
    await get_db().invites.delete_one({"id": invite_id, "org_id": ctx.org_id, "accepted_at": None})
    return {"ok": True}


class RoleInput(BaseModel):
    role: str


@router.put("/team/members/{user_id}")
async def change_role(user_id: str, data: RoleInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner")
    if data.role not in ("admin", "staff", "accountant"):
        raise HTTPException(status_code=400, detail="Invalid role")
    if user_id == ctx.user_id:
        raise HTTPException(status_code=400, detail="You can't change your own role")
    r = await get_db().memberships.update_one({"org_id": ctx.org_id, "user_id": user_id, "role": {"$ne": "owner"}}, {"$set": {"role": data.role}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"ok": True}


@router.delete("/team/members/{user_id}")
async def remove_member(user_id: str, ctx: Ctx = Depends(get_ctx)):
    if user_id != ctx.user_id and not can_manage(ctx):
        raise HTTPException(status_code=403, detail="Not allowed")
    d = get_db()
    m = await d.memberships.find_one({"org_id": ctx.org_id, "user_id": user_id}, {"_id": 0})
    if not m:
        raise HTTPException(status_code=404, detail="Member not found")
    if m["role"] == "owner":
        raise HTTPException(status_code=400, detail="The owner can't be removed")
    if m["role"] == "admin" and ctx.role != "owner" and user_id != ctx.user_id:
        raise HTTPException(status_code=403, detail="Only the owner can remove an admin")
    await d.memberships.delete_one({"org_id": ctx.org_id, "user_id": user_id})
    return {"ok": True}


# ------------------------------------------------------------------ accepting

async def _valid_invite(token: str) -> dict:
    inv = await get_db().invites.find_one({"token": token}, {"_id": 0}) if token and len(token) >= 20 else None
    if not inv or inv.get("accepted_at"):
        raise HTTPException(status_code=404, detail="This invitation isn't valid any more")
    if inv["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=410, detail="This invitation has expired — ask for a new one")
    return inv


@router.get("/public/invites/{token}")
async def invite_info(token: str, request: Request):
    rate_limit(request, "invite-info", 60)
    inv = await _valid_invite(token)
    inviter = await get_db().users.find_one({"id": inv["invited_by"]}, {"_id": 0, "name": 1}) or {}
    return {"business": await org_name(inv["org_id"]), "role": inv["role"], "email": inv["email"], "invited_by": inviter.get("name", "")}


@router.post("/invites/{token}/accept")
async def accept(token: str, u: dict = Depends(current_user)):
    inv = await _valid_invite(token)
    if inv["email"] != u["email"].lower():
        raise HTTPException(status_code=403, detail=f"This invitation is for {inv['email']} — sign in with that email to accept it")
    d = get_db()
    if not await d.memberships.find_one({"org_id": inv["org_id"], "user_id": u["id"]}):
        await d.memberships.insert_one({"org_id": inv["org_id"], "user_id": u["id"], "role": inv["role"], "created_at": now()})
    # A business an accountant set up for a client gets its real owner when the client accepts.
    if inv["role"] == "owner":
        claimed = await d.orgs.update_one({"id": inv["org_id"], "owner_id": None}, {"$set": {"owner_id": u["id"]}})
        if not claimed.modified_count:
            await d.memberships.delete_one({"org_id": inv["org_id"], "user_id": u["id"], "role": "owner"})
            raise HTTPException(status_code=409, detail="This business already has an owner")
    await d.invites.update_one({"token": token}, {"$set": {"accepted_at": now(), "accepted_by": u["id"]}})
    await notify(inv["org_id"], "team", f"{u.get('name') or u['email']} joined as {ROLE_LABELS[inv['role']].lower()}", "/app/settings?tab=team")
    return {"org_id": inv["org_id"], "role": inv["role"]}
