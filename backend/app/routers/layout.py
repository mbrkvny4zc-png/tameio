"""Customisable layout.

- Business layout (owner/admin only, applies to everyone in the business): which menu items show, their order,
  which sit in the main list vs "more", and which dashboard sections show, in what order.
- Pins (each person): shortcuts to pages, clients, invoices, products or saved searches, shown at the top of
  the menu and on the dashboard.
"""
import re
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now

router = APIRouter(tags=["layout"])

WIDGETS = ("pins", "ask", "stats", "chart", "attention", "recent", "categories")
PIN_TYPES = ("page", "search", "client", "invoice", "product", "supplier", "link")
MAX_PINS = 16
PATH_RE = re.compile(r"^/app(/[A-Za-z0-9_\-/]*)?(\?[A-Za-z0-9_\-=&%.+~]*)?$")


def _path(p: str) -> str:
    p = (p or "").strip()
    if not PATH_RE.fullmatch(p):
        raise HTTPException(status_code=400, detail="Shortcuts can only point to pages inside Tameio")
    return p[:300]


class NavLayout(BaseModel):
    hidden: List[str] = []                 # paths hidden from the menu
    order: dict = {}                       # group key -> [paths] in the wanted order
    main: List[str] = []                   # paths promoted out of "more" into the main list
    more: List[str] = []                   # paths demoted into "more"


class DashboardLayout(BaseModel):
    widgets: List[dict] = []               # [{id, visible}] in order


class OrgLayoutInput(BaseModel):
    nav: Optional[NavLayout] = None
    dashboard: Optional[DashboardLayout] = None


def _clean_nav(n: NavLayout) -> dict:
    keep = lambda xs: [_path(x) for x in xs if x][:60]  # noqa: E731
    return {"hidden": [x for x in keep(n.hidden) if x not in ("/app", "/app/settings")],  # the essentials can't be hidden
            "order": {str(k)[:20]: keep(v) for k, v in list((n.order or {}).items())[:10] if isinstance(v, list)},
            "main": keep(n.main), "more": keep(n.more)}


def _clean_dashboard(dl: DashboardLayout) -> dict:
    seen, out = set(), []
    for w in dl.widgets:
        wid = str(w.get("id") or "")
        if wid in WIDGETS and wid not in seen:
            seen.add(wid)
            out.append({"id": wid, "visible": bool(w.get("visible", True))})
    out += [{"id": w, "visible": True} for w in WIDGETS if w not in seen]  # new widgets appear by default
    return {"widgets": out}


@router.get("/layout")
async def get_layout(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    org = await d.layouts.find_one({"org_id": ctx.org_id}, {"_id": 0}) or {}
    mine = await d.pins.find_one({"user_id": ctx.user_id, "org_id": ctx.org_id}, {"_id": 0}) or {}
    return {"nav": org.get("nav") or {"hidden": [], "order": {}, "main": [], "more": []},
            "dashboard": org.get("dashboard") or {"widgets": [{"id": w, "visible": True} for w in WIDGETS]},
            "pins": mine.get("items") or [], "can_edit": ctx.role in ("owner", "admin"),
            "updated_by": org.get("updated_by_name"), "updated_at": org.get("updated_at")}


@router.put("/layout")
async def save_layout(data: OrgLayoutInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    sets = {"updated_at": now(), "updated_by": ctx.user_id, "updated_by_name": ctx.name}
    if data.nav is not None:
        sets["nav"] = _clean_nav(data.nav)
    if data.dashboard is not None:
        sets["dashboard"] = _clean_dashboard(data.dashboard)
    await get_db().layouts.update_one({"org_id": ctx.org_id}, {"$set": sets, "$setOnInsert": {"org_id": ctx.org_id}}, upsert=True)
    return await get_layout(ctx)


@router.delete("/layout")
async def reset_layout(part: str = "all", ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    unset = {"nav": "", "dashboard": ""} if part == "all" else {part: ""} if part in ("nav", "dashboard") else {}
    if unset:
        await get_db().layouts.update_one({"org_id": ctx.org_id}, {"$unset": unset})
    return await get_layout(ctx)


# ------------------------------------------------------------------ pins (per person)

class PinInput(BaseModel):
    type: str = "page"
    label: str
    to: str
    icon: Optional[str] = ""


class PinsInput(BaseModel):
    items: List[PinInput]


def _clean_pin(p: PinInput, pid: Optional[str] = None) -> dict:
    label = (p.label or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="Give the shortcut a name")
    return {"id": pid or str(uuid.uuid4()), "type": p.type if p.type in PIN_TYPES else "link", "label": label[:60],
            "to": _path(p.to), "icon": re.sub(r"[^A-Za-z]", "", p.icon or "")[:30]}


async def _save_pins(ctx: Ctx, items: list):
    await get_db().pins.update_one({"user_id": ctx.user_id, "org_id": ctx.org_id},
                                   {"$set": {"items": items, "updated_at": now()}}, upsert=True)


@router.post("/layout/pins")
async def add_pin(data: PinInput, ctx: Ctx = Depends(get_ctx)):
    mine = (await get_layout(ctx))["pins"]
    pin = _clean_pin(data)
    if any(p["to"] == pin["to"] for p in mine):
        return {"pins": mine, "added": False}
    if len(mine) >= MAX_PINS:
        raise HTTPException(status_code=400, detail=f"You can pin up to {MAX_PINS} shortcuts — remove one first")
    await _save_pins(ctx, mine + [pin])
    return {"pins": mine + [pin], "added": True}


@router.put("/layout/pins")
async def replace_pins(data: PinsInput, ctx: Ctx = Depends(get_ctx)):
    """Reorder or rename pins (the whole list is sent back)."""
    if len(data.items) > MAX_PINS:
        raise HTTPException(status_code=400, detail=f"You can pin up to {MAX_PINS} shortcuts")
    items = [_clean_pin(p) for p in data.items]
    await _save_pins(ctx, items)
    return {"pins": items}


@router.delete("/layout/pins/{pin_id}")
async def remove_pin(pin_id: str, ctx: Ctx = Depends(get_ctx)):
    mine = [p for p in (await get_layout(ctx))["pins"] if p["id"] != pin_id]
    await _save_pins(ctx, mine)
    return {"pins": mine}
