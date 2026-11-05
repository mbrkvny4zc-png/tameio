"""In-app notifications, scoped to an organisation."""
import uuid

from fastapi import APIRouter, Depends

from app.auth import Ctx, get_ctx
from app.db import get_db, now

router = APIRouter(tags=["notifications"])


async def notify(org_id: str, kind: str, message: str, link: str = "", user_id: str = ""):
    """Business-wide notification, or just for one person when user_id is given (e.g. an @mention)."""
    doc = {"id": str(uuid.uuid4()), "org_id": org_id, "type": kind, "message": message[:500], "link": link, "read": False, "created_at": now()}
    if user_id:
        doc["user_id"] = user_id
    await get_db().notifications.insert_one(doc)


def _mine(ctx: Ctx) -> dict:
    return {"org_id": ctx.org_id, "$or": [{"user_id": {"$exists": False}}, {"user_id": None}, {"user_id": ctx.user_id}]}


@router.get("/notifications")
async def list_notifications(ctx: Ctx = Depends(get_ctx)):
    items = await get_db().notifications.find(_mine(ctx), {"_id": 0}).sort("created_at", -1).to_list(50)
    return {"items": items, "unread": sum(1 for i in items if not i.get("read"))}


@router.post("/notifications/read")
async def mark_read(ctx: Ctx = Depends(get_ctx)):
    await get_db().notifications.update_many({**_mine(ctx), "read": False}, {"$set": {"read": True}})
    return {"ok": True}
