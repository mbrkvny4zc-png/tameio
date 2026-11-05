"""Your data: export everything (GDPR), delete a business, delete your account."""
import io
import json
import zipfile

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from app import config
from app.auth import Ctx, _check, current_user, get_ctx, require_role
from app.db import get_db, now

router = APIRouter(tags=["account"])

ORG_COLLECTIONS = ["business", "clients", "documents", "invoices", "expenses", "scans", "suppliers", "supplier_requirements", "mydata_settings",
                   "mydata_transmissions", "mydata_counters", "counters", "notifications", "received_docs", "received_sync", "classification_map",
                   "bank_txns", "receipt_requests", "period_closes", "viva_settings", "payment_attempts", "reminder_settings", "tax_settings", "tax_done",
                   "inbox_settings", "inbox_log", "invites", "memberships", "ask_log", "tax_questions", "comments"]
SECRET_FIELDS = {"subscription_key_enc", "client_secret_enc", "token", "public_token", "key", "password", "totp_secret", "totp_pending"}


def _scrub(v):
    if isinstance(v, dict):
        return {k: _scrub(x) for k, x in v.items() if k not in SECRET_FIELDS and k != "_id"}
    if isinstance(v, list):
        return [_scrub(x) for x in v]
    return v


@router.get("/account/export.zip")
async def export_all(ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    from app.routers.expenses import SCAN_DIR
    from app.routers.suppliers import SUPPLIER_DIR
    d = get_db()
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for coll in ORG_COLLECTIONS:
            rows = await d[coll].find({"org_id": ctx.org_id}).to_list(200000)
            z.writestr(f"data/{coll}.json", json.dumps(_scrub(rows), ensure_ascii=False, indent=1, default=str))
            for row in rows:  # include uploaded files
                files = [row.get("file")] + [x for x in row.get("documents", []) if isinstance(x, dict)]
                for f in files:
                    if f and f.get("stored_name"):
                        for base in (SCAN_DIR, SUPPLIER_DIR):
                            p = base / f["stored_name"]
                            if p.exists():
                                z.write(p, f"files/{coll}/{f['stored_name']}")
                                break
        z.writestr("README.txt", f"Full export of your business data from {config.APP_NAME}, {now()}.\nJSON files per data type; uploaded receipts and documents in files/.\n"
                                 "Credentials (AADE keys, payment secrets, private links) are left out on purpose.\n")
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="tameio-export.zip"'})


async def _delete_org_data(org_id: str):
    from app.routers.expenses import SCAN_DIR
    from app.routers.suppliers import SUPPLIER_DIR
    d = get_db()
    for coll in ("scans", "expenses", "suppliers", "invoices"):
        async for row in d[coll].find({"org_id": org_id}, {"_id": 0, "file": 1, "documents": 1}):
            for f in [row.get("file")] + [x for x in row.get("documents", []) if isinstance(x, dict)]:
                if f and f.get("stored_name"):
                    for base in (SCAN_DIR, SUPPLIER_DIR):
                        (base / f["stored_name"]).unlink(missing_ok=True)
    for coll in ORG_COLLECTIONS:
        await d[coll].delete_many({"org_id": org_id})
    await d.orgs.delete_one({"id": org_id})


class ConfirmInput(BaseModel):
    confirm: str
    password: str


@router.post("/account/delete-business")
async def delete_business(data: ConfirmInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner")
    d = get_db()
    u = await d.users.find_one({"id": ctx.user_id}, {"_id": 0})
    biz = await d.business.find_one({"org_id": ctx.org_id}, {"_id": 0, "business_name": 1}) or {}
    if not _check(data.password, u.get("password", "")):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    if data.confirm.strip() != (biz.get("business_name") or "DELETE"):
        raise HTTPException(status_code=400, detail="Type the business name exactly to confirm")
    await _delete_org_data(ctx.org_id)
    # Keep users able to sign in: point anyone whose default was this business at another one.
    async for user in d.users.find({"org_id": ctx.org_id}, {"_id": 0, "id": 1}):
        other = await d.memberships.find_one({"user_id": user["id"]}, {"_id": 0, "org_id": 1})
        await d.users.update_one({"id": user["id"]}, {"$set": {"org_id": other["org_id"] if other else None}})
    return {"ok": True}


class PasswordInput(BaseModel):
    password: str


@router.post("/account/delete")
async def delete_account(data: PasswordInput, u: dict = Depends(current_user)):
    d = get_db()
    if not _check(data.password, u.get("password", "")):
        raise HTTPException(status_code=400, detail="Password is incorrect")
    owned = await d.memberships.find({"user_id": u["id"], "role": "owner"}, {"_id": 0, "org_id": 1}).to_list(100)
    for m in owned:
        others = await d.memberships.count_documents({"org_id": m["org_id"], "user_id": {"$ne": u["id"]}, "role": {"$ne": "accountant"}})
        if others:
            raise HTTPException(status_code=409, detail="You own a business with other members — transfer or delete it first")
    for m in owned:
        await _delete_org_data(m["org_id"])
    practice = await d.orgs.find({"owner_id": u["id"], "kind": "practice"}, {"_id": 0, "id": 1}).to_list(10)
    for p in practice:
        await _delete_org_data(p["id"])
    await d.memberships.delete_many({"user_id": u["id"]})
    await d.sessions.delete_many({"user_id": u["id"]})
    await d.users.delete_one({"id": u["id"]})
    return {"ok": True}
