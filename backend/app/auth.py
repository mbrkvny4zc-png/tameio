"""Email/password auth with server-side sessions (httpOnly cookie or Bearer token)."""
import re
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from app import config
from app.db import get_db, now
from app.ratelimit import rate_limit

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE = "session"


@dataclass
class Ctx:
    user_id: str
    org_id: str
    email: str
    name: str


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


async def get_ctx(request: Request) -> Ctx:
    token = _token_from(request)
    if not token:
        raise HTTPException(status_code=401, detail="Please sign in")
    s = await get_db().sessions.find_one({"token": token}, {"_id": 0})
    if not s or s["expires_at"] < datetime.now(timezone.utc).isoformat():
        raise HTTPException(status_code=401, detail="Your session expired — please sign in again")
    u = await get_db().users.find_one({"id": s["user_id"]}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=401, detail="Please sign in")
    return Ctx(user_id=u["id"], org_id=u["org_id"], email=u["email"], name=u.get("name", ""))


class SignupInput(BaseModel):
    name: str
    email: str
    password: str
    business_name: Optional[str] = ""


class LoginInput(BaseModel):
    email: str
    password: str


def _public_user(u: dict) -> dict:
    return {"id": u["id"], "email": u["email"], "name": u.get("name", ""), "org_id": u["org_id"]}


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
    d = get_db()
    if await d.users.find_one({"email": email}):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    org_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    await d.orgs.insert_one({"id": org_id, "owner_id": user_id, "created_at": now()})
    await d.business.insert_one({"org_id": org_id, "business_name": (data.business_name or "").strip(), "business_email": email, "created_at": now()})
    user = {"id": user_id, "org_id": org_id, "email": email, "name": data.name.strip(), "password": _hash(data.password), "created_at": now()}
    await d.users.insert_one({**user})
    token = await _create_session(user_id)
    _set_cookie(response, token)
    return {"user": _public_user(user), "token": token}


@router.post("/login")
async def login(data: LoginInput, request: Request, response: Response):
    rate_limit(request, "login", 20, 900)
    u = await get_db().users.find_one({"email": data.email.strip().lower()}, {"_id": 0})
    if not u or not _check(data.password, u.get("password", "")):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    token = await _create_session(u["id"])
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
async def me(ctx: Ctx = Depends(get_ctx)):
    u = await get_db().users.find_one({"id": ctx.user_id}, {"_id": 0})
    return {"user": _public_user(u)}
