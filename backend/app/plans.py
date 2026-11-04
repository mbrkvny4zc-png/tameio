"""Plans and usage limits. -1 = unlimited. Accountants never count toward member limits."""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import config
from app.auth import Ctx, current_user, get_ctx
from app.db import get_db, now

router = APIRouter(tags=["plans"])

PLANS = {
    "free": {"name": "Free", "price": 0, "invoices_month": 10, "scans_month": 15, "suppliers": 3, "members": 1},
    "solo": {"name": "Solo", "price": 9, "invoices_month": -1, "scans_month": 30, "suppliers": 10, "members": 1},
    "business": {"name": "Business", "price": 19, "invoices_month": -1, "scans_month": 200, "suppliers": 100, "members": 5},
    "team": {"name": "Team", "price": 39, "invoices_month": -1, "scans_month": -1, "suppliers": -1, "members": -1},
    "practice": {"name": "Accountant", "price": 0, "invoices_month": -1, "scans_month": -1, "suppliers": -1, "members": -1},
}


def _month_start() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-01")


async def plan_of(org_id: str) -> tuple:
    org = await get_db().orgs.find_one({"id": org_id}, {"_id": 0, "plan": 1}) or {}
    key = org.get("plan") or config.DEFAULT_PLAN
    return key, PLANS.get(key, PLANS["free"])


async def usage(org_id: str) -> dict:
    d = get_db()
    start = _month_start()
    return {
        "invoices_month": await d.invoices.count_documents({"org_id": org_id, "kind": {"$ne": "credit_note"}, "created_at": {"$gte": start}}),
        "scans_month": await d.scans.count_documents({"org_id": org_id, "created_at": {"$gte": start}}),
        "suppliers": await d.suppliers.count_documents({"org_id": org_id}),
        "members": await d.memberships.count_documents({"org_id": org_id, "role": {"$ne": "accountant"}})
                   + await d.invites.count_documents({"org_id": org_id, "role": {"$ne": "accountant"}, "accepted_at": None}),
    }


async def enforce(org_id: str, key: str, adding: int = 1):
    plan_key, plan = await plan_of(org_id)
    limit = plan[key]
    if limit < 0:
        return
    used = (await usage(org_id))[key]
    if used + adding > limit:
        label = {"invoices_month": "invoices this month", "scans_month": "scans this month", "suppliers": "suppliers", "members": "team members"}[key]
        raise HTTPException(status_code=402, detail={"message": f"The {plan['name']} plan includes {limit} {label}. Upgrade to add more.", "upgrade": True, "limit": key})


@router.get("/plan")
async def get_plan(ctx: Ctx = Depends(get_ctx)):
    key, plan = await plan_of(ctx.org_id)
    return {"plan": key, "limits": plan, "usage": await usage(ctx.org_id),
            "plans": {k: v for k, v in PLANS.items() if k != "practice"}}


class PlanInput(BaseModel):
    plan: str


@router.put("/admin/orgs/{org_id}/plan")
async def set_plan(org_id: str, data: PlanInput, u: dict = Depends(current_user)):
    """Platform admins only, until self-serve billing is connected."""
    if u["email"].lower() not in config.PLATFORM_ADMINS:
        raise HTTPException(status_code=403, detail="Not allowed")
    if data.plan not in PLANS:
        raise HTTPException(status_code=400, detail="Unknown plan")
    r = await get_db().orgs.update_one({"id": org_id}, {"$set": {"plan": data.plan, "plan_changed_at": now()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Organisation not found")
    return {"ok": True}
