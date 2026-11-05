"""Email/password auth with server-side sessions, two-factor login, and role-aware organisation access.

A user can belong to several organisations (their own business, client businesses
they keep books for, a business they were invited to). The active organisation is
chosen per request with the `X-Org-Id` header and checked against `memberships`.
"""
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app import config, totp
from app.db import get_db, now
from app.ratelimit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "session"
ROLES = ("owner", "admin", "staff", "accountant")


@dataclass
class Ctx:
    user_id: str
    org_id: str
    email: str
    name: str
    role: str = "owner"
    org_kind: str = "business"


def require_role(ctx: Ctx, *roles: str):
    if ctx.role not in roles:
        raise HTTPException(status_code=403, detail="You don't have permission to do this in this business")


def _hash(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def _check(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


async def _create_session(user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(days=config.SESSION_DAYS)
    await get_db().sessions.insert_one({"token": token, "user_id": user_id, "expires_at": expires.isoformat(), "created_at": now()})
    return token


def _set_cookie(resp: Response, token: str):
    resp.set_cookie(COOKIE, token, httponly=True, secure=config.COOKIE_SECURE, samesite="lax",
                    max_age=config.SESSION_DAYS * 86400, path="/")


def _token_from(request: Request) -> Optional[str]:
    token = request.cookies.get(COOKIE)
    auth = request.headers.get("authorization", "")
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    return token


async def current_user(request: Request) -> dict:
    token = _token_from(request)
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in")
    s = await get_db().sessions.find_one({"token": token}, {"_id": 0})
    if not s or s["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=401, detail="Your session expired — please sign in again")
    u = await get_db().users.find_one({"id": s["user_id"]}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=401, detail="Please sign in")
    return u


async def get_ctx(request: Request) -> Ctx:
    u = await current_user(request)
    d = get_db()
    requested = (request.headers.get("x-org-id") or "").strip()
    org_id = requested or u.get("org_id")
    m = await d.memberships.find_one({"org_id": org_id, "user_id": u["id"]}, {"_id": 0})
    if not m:
        if requested:
            raise HTTPException(status_code=403, detail="You don't have access to this business")
        m = await d.memberships.find_one({"user_id": u["id"]}, {"_id": 0}, sort=[("created_at", 1)])
        if not m:
            raise HTTPException(status_code=403, detail="Your account isn't linked to a business")
    org = await d.orgs.find_one({"id": m["org_id"]}, {"_id": 0, "kind": 1}) or {}
    return Ctx(user_id=u["id"], org_id=m["org_id"], email=u["email"], name=u.get("name", ""), role=m["role"], org_kind=org.get("kind", "business"))


async def create_org(owner_id: str, kind: str, business_name: str = "", email: str = "", role: str = "owner", created_by: str = "") -> str:
    d = get_db()
    org_id = str(uuid.uuid4())
    await d.orgs.insert_one({"id": org_id, "kind": kind, "owner_id": owner_id if role == "owner" else None,
                             "plan": config.DEFAULT_PLAN if kind == "business" else "practice", "created_by": created_by or owner_id, "created_at": now()})
    await d.business.insert_one({"org_id": org_id, "business_name": business_name.strip(), "business_email": email, "created_at": now()})
    await d.memberships.insert_one({"org_id": org_id, "user_id": owner_id, "role": role, "created_at": now()})
    return org_id


class SignupInput(BaseModel):
    name: str
    email: str
    password: str
    business_name: Optional[str] = ""
    account_type: Optional[str] = "business"  # "business" | "accountant"
    ref: Optional[str] = ""                    # accounting-firm referral code from /r/{code}
    accept_terms: bool = False                 # ticked "I agree to the Terms, Privacy Policy and DPA"


class LoginInput(BaseModel):
    email: str
    password: str
    code: Optional[str] = None


def _public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u.get("name", ""), "org_id": u["org_id"],
            "account_type": u.get("account_type", "business"), "two_factor": bool(u.get("totp_enabled")),
            "platform_admin": u["email"].lower() in config.PLATFORM_ADMINS}


@router.post("/signup")
async def signup(data: SignupInput, request: Request, response: Response):
    rate_limit(request, "signup", 10)
    email = data.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=400, detail="Enter a valid email address")
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Use a password of at least 8 characters")
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Enter your name")
    if not data.accept_terms:
        raise HTTPException(status_code=400, detail="Please accept the Terms of Service and the Privacy Policy to continue")
    d = get_db()
    if await d.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    account_type = "accountant" if data.account_type == "accountant" else "business"
    user_id = str(uuid.uuid4())
    org_id = await create_org(user_id, "practice" if account_type == "accountant" else "business", data.business_name or "", email)
    user = {"id": user_id, "org_id": org_id, "email": email, "name": data.name.strip(), "password": _hash(data.password),
            "account_type": account_type, "created_at": now(),
            "terms_accepted": {"version": config.LEGAL_VERSION, "at": now()}}
    await d.users.insert_one({**user})
    if account_type == "business" and data.ref:
        from app.routers.partners import attribute_by_code
        await attribute_by_code(org_id, data.ref, "link")
    token = await _create_session(user_id)
    _set_cookie(response, token)
    return {"user": _public_user(user), "token": token}


@router.get("/legal/company")
async def legal_company():
    """Who operates the service — shown on the public legal pages."""
    return {**config.LEGAL, "version": config.LEGAL_VERSION}


@router.post("/login")
async def login(data: LoginInput, request: Request, response: Response):
    rate_limit(request, "login", 20, 900)
    u = await get_db().users.find_one({"email": data.email.strip().lower()}, {"_id": 0})
    if not u or not _check(data.password, u.get("password", "")):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    if u.get("totp_enabled"):
        if not data.code:
            raise HTTPException(status_code=401, detail={"message": "Enter the 6-digit code from your authenticator app", "two_factor_required": True})
        rate_limit(request, f"2fa:{u['id']}", 10, 900)
        if not totp.verify(u["totp_secret"], data.code):
            raise HTTPException(status_code=401, detail={"message": "That code isn't right — try the newest one", "two_factor_required": True})
    token = await _create_session(u["id"])
    await get_db().users.update_one({"id": u["id"]}, {"$set": {"last_login_at": now()}})
    _set_cookie(response, token)
    return {"user": _public_user(u), "token": token}


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = _token_from(request)
    if token:
        await get_db().sessions.delete_one({"token": token})
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(request: Request):
    u = await current_user(request)
    return {"user": _public_user(u)}


# ------------------------------------------------------------------ two-factor

class CodeInput(BaseModel):
    code: str
    password: Optional[str] = None


@router.post("/2fa/setup")
async def two_factor_setup(request: Request):
    u = await current_user(request)
    if u.get("totp_enabled"):
        raise HTTPException(status_code=400, detail="Two-factor sign-in is already on")
    secret = totp.new_secret()
    await get_db().users.update_one({"id": u["id"]}, {"$set": {"totp_pending": secret}})
    return {"secret": secret, "otpauth_uri": totp.otpauth_uri(secret, u["email"], config.APP_NAME)}


@router.post("/2fa/enable")
async def two_factor_enable(data: CodeInput, request: Request):
    u = await current_user(request)
    secret = u.get("totp_pending")
    if not secret:
        raise HTTPException(status_code=400, detail="Start the setup again")
    if not totp.verify(secret, data.code):
        raise HTTPException(status_code=400, detail="That code isn't right — check your phone's time and try the newest code")
    await get_db().users.update_one({"id": u["id"]}, {"$set": {"totp_secret": secret, "totp_enabled": True, "updated_at": now()}, "$unset": {"totp_pending": ""}})
    return {"ok": True}


@router.post("/2fa/disable")
async def two_factor_disable(data: CodeInput, request: Request):
    u = await current_user(request)
    if not u.get("totp_enabled"):
        return {"ok": True}
    if not _check(data.password or "", u.get("password", "")) or not totp.verify(u["totp_secret"], data.code):
        raise HTTPException(status_code=400, detail="Password or code is incorrect")
    await get_db().users.update_one({"id": u["id"]}, {"$set": {"totp_enabled": False}, "$unset": {"totp_secret": ""}})
    return {"ok": True}
