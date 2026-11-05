"""Comments with @mentions on records (invoices, expenses, clients, suppliers, purchase invoices, delivery notes...).

Questions stay attached to the thing they're about. Mentioned people get a personal notification (and an email
when email is set up) and see the comment in their "Mentions" inbox until they mark it done.
"""
import re
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config
from app.auth import Ctx, get_ctx
from app.common import esc
from app.db import get_db, now
from app.mailer import layout, send
from app.notify import notify
from app.ratelimit import rate_limit

router = APIRouter(tags=["comments"])

# target type -> (collection, label builder, page that lists it)
TARGETS = {
    "invoice": ("invoices", lambda d: f"{d.get('number')} · {d.get('client_name') or ''}".strip(" ·"), "/app/invoices"),
    "expense": ("expenses", lambda d: f"{d.get('vendor_name') or ''} · {d.get('date') or ''}".strip(" ·"), "/app/expenses"),
    "client": ("clients", lambda d: d.get("name") or "", "/app/clients"),
    "supplier": ("suppliers", lambda d: d.get("name") or "", "/app/suppliers"),
    "received": ("received_docs", lambda d: f"{d.get('issuer_name') or d.get('issuer_afm') or ''} · {d.get('number') or d.get('mark') or ''}".strip(" ·"), "/app/received"),
    "delivery_note": ("delivery_notes", lambda d: f"{d.get('number')} · {d.get('recipient_name') or ''}".strip(" ·"), "/app/delivery-notes"),
    "document": ("documents", lambda d: f"{d.get('number')} · {d.get('client_name') or d.get('supplier_name') or ''}".strip(" ·"), "/app/quotes"),
    "product": ("products", lambda d: d.get("name") or "", "/app/products"),
    "question": ("tax_questions", lambda d: d.get("question") or "", "/app/ask"),
}
TYPE_LABEL = {"invoice": "invoice", "expense": "expense", "client": "client", "supplier": "supplier", "received": "purchase invoice",
              "delivery_note": "delivery note", "document": "document", "product": "product", "question": "tax question"}


async def _target(ctx: Ctx, ttype: str, tid: str) -> dict:
    if ttype not in TARGETS:
        raise HTTPException(status_code=400, detail="Comments aren't available on this kind of record")
    coll, label, page = TARGETS[ttype]
    doc = await get_db()[coll].find_one({"id": tid, "org_id": ctx.org_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Record not found")
    return {"label": label(doc)[:120] or TYPE_LABEL[ttype], "page": page}


async def members(org_id: str) -> dict:
    d = get_db()
    mem = await d.memberships.find({"org_id": org_id}, {"_id": 0}).to_list(500)
    users = {u["id"]: u for u in await d.users.find({"id": {"$in": [m["user_id"] for m in mem]}}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)}
    return {m["user_id"]: {"id": m["user_id"], "name": users.get(m["user_id"], {}).get("name") or "", "email": users.get(m["user_id"], {}).get("email") or "",
                           "role": m["role"]} for m in mem}


@router.get("/comments/people")
async def people(ctx: Ctx = Depends(get_ctx)):
    """Who can be @mentioned in this business (the team and the accountant)."""
    return [p for p in (await members(ctx.org_id)).values() if p["id"] != ctx.user_id]


@router.get("/comments")
async def thread(target_type: str, target_id: str, ctx: Ctx = Depends(get_ctx)):
    info = await _target(ctx, target_type, target_id)
    items = await get_db().comments.find({"org_id": ctx.org_id, "target_type": target_type, "target_id": target_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
    for c in items:
        c["mine"] = c["author_id"] == ctx.user_id
        c["mentions_me"] = ctx.user_id in c.get("mentions", [])
        c["done"] = ctx.user_id in c.get("done_by", [])
    return {"target": {"type": target_type, "id": target_id, **info}, "comments": items}


@router.get("/comments/counts")
async def counts(target_type: str, ctx: Ctx = Depends(get_ctx)):
    """{record id: number of comments} — for the small badges in lists."""
    out = {}
    for c in await get_db().comments.find({"org_id": ctx.org_id, "target_type": target_type}, {"_id": 0, "target_id": 1}).to_list(50000):
        out[c["target_id"]] = out.get(c["target_id"], 0) + 1
    return out


class CommentInput(BaseModel):
    target_type: str
    target_id: str
    text: str
    mentions: List[str] = []


def _mentions_from_text(text: str, people: dict) -> set:
    """Also catch @Name typed by hand (first name or full name)."""
    found = set()
    low = text.lower()
    for p in people.values():
        for n in {p["name"], (p["name"] or "").split(" ")[0]}:
            if n and re.search(r"@" + re.escape(n.lower()) + r"(?![\w])", low):
                found.add(p["id"])
    return found


@router.post("/comments")
async def add_comment(data: CommentInput, request: Request, ctx: Ctx = Depends(get_ctx)):
    rate_limit(request, f"comment:{ctx.user_id}", 300)
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first")
    if len(text) > 4000:
        raise HTTPException(status_code=400, detail="Keep comments under 4000 characters")
    info = await _target(ctx, data.target_type, data.target_id)
    ppl = await members(ctx.org_id)
    mentioned = ({m for m in data.mentions if m in ppl} | _mentions_from_text(text, ppl)) - {ctx.user_id}
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "target_type": data.target_type, "target_id": data.target_id,
           "target_label": info["label"], "target_page": info["page"], "text": text, "mentions": sorted(mentioned), "done_by": [],
           "author_id": ctx.user_id, "author_name": ctx.name, "created_at": now(), "edited_at": None}
    await get_db().comments.insert_one({**doc})
    await _tell(ctx, doc, mentioned, ppl)
    return {**doc, "mine": True, "mentions_me": False, "done": False}


async def _tell(ctx: Ctx, doc: dict, who: set, ppl: dict):
    if not who:
        return
    what = TYPE_LABEL[doc["target_type"]]
    for uid in who:
        await notify(ctx.org_id, "mention", f"{ctx.name} mentioned you on {what} {doc['target_label']}: {doc['text'][:120]}", "/app/mentions", user_id=uid)
        email = ppl.get(uid, {}).get("email")
        if email:
            html = layout(f"{ctx.name} mentioned you", f"<p style='color:#555'>On {esc(what)} <b>{esc(doc['target_label'])}</b>:</p>"
                          f"<blockquote style='margin:0;padding:10px 14px;border-left:3px solid #1E4FD8;background:#F4F6FA'>{esc(doc['text'][:1500])}</blockquote>",
                          "Reply in Tameio", f"{config.PUBLIC_URL}/app/mentions", config.APP_NAME)
            try:
                await send(email, f"{ctx.name} mentioned you — {doc['target_label']}", html)
            except Exception:  # noqa: BLE001 — never fail the comment because email is down
                pass


class EditInput(BaseModel):
    text: str
    mentions: Optional[List[str]] = None


@router.put("/comments/{cid}")
async def edit_comment(cid: str, data: EditInput, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    c = await d.comments.find_one({"id": cid, "org_id": ctx.org_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c["author_id"] != ctx.user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own comments")
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Write something first")
    ppl = await members(ctx.org_id)
    mentioned = ({m for m in (data.mentions or []) if m in ppl} | set(c["mentions"]) | _mentions_from_text(text, ppl)) - {ctx.user_id}
    new = mentioned - set(c["mentions"])
    await d.comments.update_one({"id": cid}, {"$set": {"text": text[:4000], "mentions": sorted(mentioned), "edited_at": now()}})
    await _tell(ctx, {**c, "text": text}, new, ppl)
    return await d.comments.find_one({"id": cid}, {"_id": 0})


@router.delete("/comments/{cid}")
async def delete_comment(cid: str, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    c = await d.comments.find_one({"id": cid, "org_id": ctx.org_id}, {"_id": 0})
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found")
    if c["author_id"] != ctx.user_id and ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="You can only delete your own comments")
    await d.comments.delete_one({"id": cid})
    return {"ok": True}


# ------------------------------------------------------------------ mentions inbox

@router.get("/mentions")
async def my_mentions(status: str = "open", ctx: Ctx = Depends(get_ctx)):
    q = {"org_id": ctx.org_id, "mentions": ctx.user_id}
    if status == "open":
        q["done_by"] = {"$ne": ctx.user_id}
    elif status == "done":
        q["done_by"] = ctx.user_id
    items = await get_db().comments.find(q, {"_id": 0}).sort("created_at", -1).to_list(300)
    for c in items:
        c["done"] = ctx.user_id in c.get("done_by", [])
    return items


@router.get("/mentions/count")
async def mention_count(ctx: Ctx = Depends(get_ctx)):
    return {"open": await get_db().comments.count_documents({"org_id": ctx.org_id, "mentions": ctx.user_id, "done_by": {"$ne": ctx.user_id}})}


class DoneInput(BaseModel):
    done: bool = True


@router.post("/mentions/{cid}/done")
async def mark_done(cid: str, data: DoneInput, ctx: Ctx = Depends(get_ctx)):
    op = {"$addToSet": {"done_by": ctx.user_id}} if data.done else {"$pull": {"done_by": ctx.user_id}}
    r = await get_db().comments.update_one({"id": cid, "org_id": ctx.org_id, "mentions": ctx.user_id}, op)
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Mention not found")
    return {"ok": True}
