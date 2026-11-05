"""Online shop connections: paid WooCommerce / Shopify orders become receipts (or invoices) automatically.

Each connection gets a private webhook URL and a signing secret. The shop signs every webhook with HMAC-SHA256
(base64) — Shopify in `X-Shopify-Hmac-Sha256`, WooCommerce in `X-WC-Webhook-Signature` — and we reject anything
unsigned. Orders are processed once (idempotent on platform + order id).
"""
import base64
import hashlib
import hmac
import json
import logging
import secrets
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx, require_role
from app.common import next_number
from app.db import get_db, now, today
from app.ratelimit import rate_limit

log = logging.getLogger("shops")
router = APIRouter(tags=["shops"])
PLATFORMS = ("woocommerce", "shopify")


class ShopInput(BaseModel):
    platform: str
    name: Optional[str] = ""
    secret: Optional[str] = None
    mode: Optional[str] = "receipt"          # receipt | invoice_if_vat (invoice when the buyer gave a VAT number)
    auto_mydata: Optional[bool] = True
    receipt_kind: Optional[str] = "goods"    # goods (11.1) | services (11.2)


def _public(c: dict) -> dict:
    return {**{k: c.get(k) for k in ("id", "platform", "name", "mode", "auto_mydata", "receipt_kind", "orders", "last_order_at", "created_at")},
            "webhook_url": f"{config.PUBLIC_URL}/api/hooks/shop/{c['token']}", "secret_hint": "••••" + c["secret"][-4:]}


@router.get("/shops")
async def list_shops(ctx: Ctx = Depends(get_ctx)):
    return [_public(c) for c in await get_db().shop_connections.find({"org_id": ctx.org_id}, {"_id": 0}).to_list(50)]


@router.post("/shops")
async def add_shop(data: ShopInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    if data.platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail="Choose WooCommerce or Shopify")
    secret = (data.secret or "").strip() or secrets.token_urlsafe(32)
    if len(secret) < 16:
        raise HTTPException(status_code=400, detail="The signing secret should be at least 16 characters")
    c = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, "platform": data.platform, "name": (data.name or data.platform.title()).strip()[:60],
         "token": secrets.token_urlsafe(24), "secret": secret, "mode": "invoice_if_vat" if data.mode == "invoice_if_vat" else "receipt",
         "auto_mydata": bool(data.auto_mydata), "receipt_kind": "services" if data.receipt_kind == "services" else "goods",
         "orders": 0, "created_at": now()}
    await get_db().shop_connections.insert_one({**c})
    return {**_public(c), "secret": secret}  # shown once, to paste into the shop


@router.put("/shops/{shop_id}")
async def update_shop(shop_id: str, data: ShopInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    sets = {"name": (data.name or "").strip()[:60] or data.platform.title(), "mode": "invoice_if_vat" if data.mode == "invoice_if_vat" else "receipt",
            "auto_mydata": bool(data.auto_mydata), "receipt_kind": "services" if data.receipt_kind == "services" else "goods"}
    r = await get_db().shop_connections.update_one({"id": shop_id, "org_id": ctx.org_id}, {"$set": sets})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Shop not found")
    return _public(await get_db().shop_connections.find_one({"id": shop_id}, {"_id": 0}))


@router.delete("/shops/{shop_id}")
async def delete_shop(shop_id: str, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    await get_db().shop_connections.delete_one({"id": shop_id, "org_id": ctx.org_id})
    return {"ok": True}


# ------------------------------------------------------------------ order mapping

def _snap_rate(rate: float) -> int:
    return min(gt.VAT_CATEGORIES, key=lambda x: abs(x - rate))


def parse_shopify(o: dict) -> Optional[dict]:
    if o.get("financial_status") not in ("paid", "partially_refunded"):
        return None
    incl = bool(o.get("taxes_included"))
    lines, rates = [], []
    for li in o.get("line_items") or []:
        qty = float(li.get("quantity") or 0)
        price = float(li.get("price") or 0)
        disc = float(li.get("total_discount") or 0)
        rate = sum(float(t.get("rate") or 0) for t in li.get("tax_lines") or []) * 100
        rates.append(rate)
        unit = (price * qty - disc) / qty if qty else 0
        if incl:
            unit = unit / (1 + rate / 100)
        if qty > 0:
            lines.append({"description": (li.get("title") or li.get("name") or "Item")[:300], "qty": qty, "unit_price": round(unit, 4), "sku": li.get("sku") or ""})
    for sl in o.get("shipping_lines") or []:
        price = float(sl.get("discounted_price") or sl.get("price") or 0)
        rate = sum(float(t.get("rate") or 0) for t in sl.get("tax_lines") or []) * 100 or (rates[0] if rates else 24)
        if price > 0:
            lines.append({"description": f"Shipping — {sl.get('title') or ''}".strip(" —")[:300], "qty": 1,
                          "unit_price": round(price / (1 + rate / 100) if incl else price, 4), "sku": ""})
    b = o.get("billing_address") or {}
    return {"order_id": str(o.get("id")), "order_number": str(o.get("name") or o.get("order_number") or o.get("id")),
            "email": o.get("email") or o.get("contact_email") or "", "name": (f"{b.get('first_name') or ''} {b.get('last_name') or ''}").strip(),
            "company": b.get("company") or "", "vat": "", "address": b.get("address1") or "", "city": b.get("city") or "",
            "postal_code": b.get("zip") or "", "country": (b.get("country_code") or "GR").upper(), "lines": lines,
            "rate": _snap_rate(rates[0] if rates else 24), "total": float(o.get("total_price") or 0)}


def parse_woocommerce(o: dict) -> Optional[dict]:
    if o.get("status") not in ("processing", "completed"):
        return None
    lines, rates = [], []
    for li in o.get("line_items") or []:
        qty = float(li.get("quantity") or 0)
        net = float(li.get("total") or 0)
        tax = float(li.get("total_tax") or 0)
        rates.append(tax / net * 100 if net else 0)
        if qty > 0:
            lines.append({"description": (li.get("name") or "Item")[:300], "qty": qty, "unit_price": round(net / qty, 4), "sku": li.get("sku") or ""})
    ship = float(o.get("shipping_total") or 0)
    if ship > 0:
        lines.append({"description": "Shipping", "qty": 1, "unit_price": ship, "sku": ""})
    b = o.get("billing") or {}
    vat = ""
    for m in o.get("meta_data") or []:  # common Greek invoice plugins store ΑΦΜ in order meta
        if str(m.get("key", "")).lower().lstrip("_") in ("billing_vat", "vat_number", "billing_afm", "afm", "_billing_vat_id", "billing_vat_id"):
            vat = str(m.get("value") or "")
    return {"order_id": str(o.get("id")), "order_number": str(o.get("number") or o.get("id")), "email": b.get("email") or "",
            "name": f"{b.get('first_name') or ''} {b.get('last_name') or ''}".strip(), "company": b.get("company") or "",
            "vat": gt.normalize_afm(vat), "address": b.get("address_1") or "", "city": b.get("city") or "", "postal_code": b.get("postcode") or "",
            "country": (b.get("country") or "GR").upper(), "lines": lines, "rate": _snap_rate(rates[0] if rates else 24),
            "total": float(o.get("total") or 0)}


def verify(platform: str, secret: str, raw: bytes, headers) -> bool:
    sig = headers.get("x-shopify-hmac-sha256") if platform == "shopify" else headers.get("x-wc-webhook-signature")
    if not sig:
        return False
    expected = base64.b64encode(hmac.new(secret.encode(), raw, hashlib.sha256).digest()).decode()
    return hmac.compare_digest(expected, sig.strip())


@router.post("/hooks/shop/{token}")
async def shop_webhook(token: str, request: Request):
    rate_limit(request, "shop-hook", 3000)
    d = get_db()
    conn = await d.shop_connections.find_one({"token": token}, {"_id": 0})
    if not conn:
        raise HTTPException(status_code=404, detail="Unknown webhook")
    raw = await request.body()
    if conn["platform"] == "woocommerce" and request.headers.get("x-wc-webhook-topic") is None and raw.startswith(b"webhook_id="):
        return {"ok": True, "ping": True}  # WooCommerce's unsigned test ping when the webhook is saved
    if not verify(conn["platform"], conn["secret"], raw, request.headers):
        raise HTTPException(status_code=401, detail="Bad signature")
    try:
        order = json.loads(raw)
    except ValueError:
        raise HTTPException(status_code=400, detail="Not JSON")
    o = parse_shopify(order) if conn["platform"] == "shopify" else parse_woocommerce(order)
    if not o or not o["lines"]:
        return {"ok": True, "skipped": "not paid yet"}
    claim = await d.shop_orders.update_one({"org_id": conn["org_id"], "platform": conn["platform"], "order_id": o["order_id"]},
                                           {"$setOnInsert": {"created_at": now(), "shop_id": conn["id"]}}, upsert=True)
    if not claim.upserted_id:
        return {"ok": True, "duplicate": True}
    doc = await create_from_order(conn, o)
    await d.shop_orders.update_one({"org_id": conn["org_id"], "platform": conn["platform"], "order_id": o["order_id"]},
                                   {"$set": {"invoice_id": doc["id"], "number": doc["number"]}})
    await d.shop_connections.update_one({"id": conn["id"]}, {"$inc": {"orders": 1}, "$set": {"last_order_at": now()}})
    return {"ok": True, "number": doc["number"]}


async def create_from_order(conn: dict, o: dict) -> dict:
    from app.common import totals
    from app.routers.invoices import sync_stock
    from app.routers.mydata import MyDataInput, _settings, submit
    from app.auth import Ctx as C
    d = get_db()
    org = conn["org_id"]
    # Link lines to saved products by SKU (code) or exact name so stock moves too.
    prods = await d.products.find({"org_id": org}, {"_id": 0, "id": 1, "name": 1, "code": 1}).to_list(5000)
    by_code = {p["code"]: p["id"] for p in prods if p.get("code")}
    by_name = {p["name"].lower(): p["id"] for p in prods}
    items = []
    for li in o["lines"]:
        row = {"description": li["description"], "qty": li["qty"], "unit_price": li["unit_price"]}
        pid = by_code.get(li["sku"]) or by_name.get(li["description"].lower())
        if pid:
            row["product_id"] = pid
        items.append(row)
    net, vat, total = totals(items, o["rate"])
    as_invoice = conn["mode"] == "invoice_if_vat" and o["vat"] and o["country"] == "GR" and gt.is_valid_afm(o["vat"])
    kind = "invoice" if as_invoice else "receipt"
    itype = "1.1" if as_invoice else ("11.2" if conn.get("receipt_kind") == "services" else "11.1")
    doc = {"id": str(uuid.uuid4()), "org_id": org, "kind": kind,
           "number": await next_number(org, kind, "INV" if as_invoice else "REC"), "client_id": None,
           "client_name": (o["company"] or o["name"] or "Online customer") if as_invoice else (o["name"] or "Online customer"),
           "client_company": o["company"], "client_email": o["email"], "client_afm": o["vat"] if as_invoice else "",
           "client_country": o["country"], "client_address": o["address"], "client_city": o["city"], "client_postal_code": o["postal_code"],
           "items": items, "tax_rate": o["rate"], "subtotal": net, "tax": vat, "total": total, "notes": f"{conn['name']} order {o['order_number']}",
           "currency": "EUR", "issue_date": today(), "due_date": None, "recurring": "none", "status": "paid", "paid_at": now(),
           "payment": "card", "source": {"platform": conn["platform"], "shop_id": conn["id"], "order_id": o["order_id"], "order_number": o["order_number"]},
           "mydata": {"invoice_type": itype, "payment_method": 7}, "created_at": now(), "updated_at": now()}
    if abs(total - o["total"]) > 0.05:
        doc["source"]["total_mismatch"] = round(o["total"] - total, 2)  # e.g. mixed VAT rates — shown for review
    await d.invoices.insert_one({**doc})
    await sync_stock(doc)
    if conn.get("auto_mydata") and not doc["source"].get("total_mismatch"):
        settings = await _settings(org)
        if settings.get("vat_number"):
            ctx = C(user_id="shop:" + conn["id"], org_id=org, email="", name=conn["name"], role="admin", org_kind="business")
            md = MyDataInput(invoice_type=itype, payment_method=7, counterpart_vat=o["vat"] if as_invoice else "", counterpart_country="GR")
            try:
                await submit(doc["id"], md, ctx)
            except HTTPException as e:
                log.warning("shop order %s not reported: %s", o["order_number"], e.detail)
    return doc
