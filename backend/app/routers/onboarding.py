"""First-run guide: progress checklist, plus sample data a new user can explore and then clear in one click."""
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends

from app.auth import Ctx, get_ctx, require_role
from app.common import totals
from app.db import get_db, now, today

router = APIRouter(tags=["onboarding"])

SAMPLE_CLIENTS = [
    ("Καφέ Αθηνά", "ΚΑΦΕ ΑΘΗΝΑ ΙΚΕ", "orders@kafe-athina.example", "Ερμού 45", "Αθήνα", "10563"),
    ("Studio Λευκό", "ΛΕΥΚΟ ΣΤΟΥΝΤΙΟ ΟΕ", "hello@studio-lefko.example", "Τσιμισκή 112", "Θεσσαλονίκη", "54622"),
    ("Ξενοδοχείο Γαλήνη", "ΓΑΛΗΝΗ ΑΕ", "info@galini-hotel.example", "Παραλία 3", "Νάξος", "84300"),
]
SAMPLE_PRODUCTS = [("Web design — hourly", 45, 24, "hour"), ("Monthly maintenance", 120, 24, "month"),
                   ("Photo shoot (half day)", 280, 24, "service"), ("Printed menus (100 pcs)", 90, 24, "pcs")]
SAMPLE_EXPENSES = [("COSMOTE", "telecom", 32.26, 24), ("Shell Κηφισίας", "fuel", 48.39, 24), ("Adobe", "software", 59.99, 24),
                   ("Λογιστικό Γραφείο Παπαδόπουλος", "professional", 150.0, 24), ("Ενοίκιο γραφείου", "rent", 450.0, 0),
                   ("Πλαίσιο", "equipment", 241.13, 24), ("Google Ads", "marketing", 80.65, 24)]


@router.get("/onboarding")
async def progress(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    q = {"org_id": ctx.org_id}
    biz = await d.business.find_one(q, {"_id": 0}) or {}
    md = await d.mydata_settings.find_one(q, {"_id": 0, "vat_number": 1}) or {}
    real = {**q, "sample": {"$ne": True}}
    steps = [
        {"key": "business", "done": bool(biz.get("business_name") and biz.get("afm")), "to": "/app/settings"},
        {"key": "mydata", "done": bool(md.get("vat_number")), "to": "/app/mydata"},
        {"key": "client", "done": bool(await d.clients.find_one(real, {"_id": 1})), "to": "/app/clients"},
        {"key": "invoice", "done": bool(await d.invoices.find_one(real, {"_id": 1})), "to": "/app/invoices"},
        {"key": "expense", "done": bool(await d.expenses.find_one(real, {"_id": 1})), "to": "/app/scan"},
    ]
    has_sample = bool(await d.invoices.find_one({**q, "sample": True}, {"_id": 1}) or await d.clients.find_one({**q, "sample": True}, {"_id": 1}))
    return {"steps": steps, "done": sum(s["done"] for s in steps), "total": len(steps), "has_sample": has_sample,
            "dismissed": bool(biz.get("onboarding_dismissed"))}


@router.post("/onboarding/dismiss")
async def dismiss(ctx: Ctx = Depends(get_ctx)):
    await get_db().business.update_one({"org_id": ctx.org_id}, {"$set": {"onboarding_dismissed": True}}, upsert=True)
    return {"ok": True}


@router.post("/onboarding/sample-data")
async def add_sample(ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    d = get_db()
    if await d.clients.find_one({"org_id": ctx.org_id, "sample": True}, {"_id": 1}):
        return {"ok": True, "already": True}
    stamp = now()
    base = {"org_id": ctx.org_id, "sample": True, "created_at": stamp, "updated_at": stamp}
    clients = [{"id": str(uuid.uuid4()), **base, "name": n, "company": c, "email": e, "phone": "", "afm": "", "doy": "", "country": "GR",
                "address": a, "city": city, "postal_code": pc, "notes": "Sample client"} for n, c, e, a, city, pc in SAMPLE_CLIENTS]
    await d.clients.insert_many([{**c} for c in clients])
    await d.products.insert_many([{"id": str(uuid.uuid4()), **base, "name": n, "code": "", "description": "", "unit_price": p,
                                   "tax_rate": r, "unit": u, "kind": "service", "uses": 0} for n, p, r, u in SAMPLE_PRODUCTS])
    t = date.fromisoformat(today())
    # Spread over the last two months so the dashboard, charts and "who owes me" all have something to show.
    plan = [(0, [(SAMPLE_PRODUCTS[0], 12)], "paid", 38), (1, [(SAMPLE_PRODUCTS[2], 1), (SAMPLE_PRODUCTS[3], 2)], "paid", 2),
            (2, [(SAMPLE_PRODUCTS[1], 1)], "overdue", 45), (0, [(SAMPLE_PRODUCTS[1], 1)], "sent", 1),
            (1, [(SAMPLE_PRODUCTS[0], 6)], "sent", 20), (2, [(SAMPLE_PRODUCTS[2], 2)], "draft", 0)]
    invs = []
    for n, (ci, lines, status, ago) in enumerate(plan, start=1):
        items = [{"description": p[0], "qty": q, "unit_price": p[1]} for p, q in lines]
        net, vat, tot = totals(items, 24)
        issued = (t - timedelta(days=ago)).isoformat()
        c = clients[ci]
        invs.append({"id": str(uuid.uuid4()), **base, "kind": "invoice", "number": f"SAMPLE-{n:03d}", "client_id": c["id"],
                     "client_name": c["name"], "client_company": c["company"], "client_email": c["email"], "client_afm": "",
                     "client_country": "GR", "client_address": c["address"], "client_city": c["city"], "client_postal_code": c["postal_code"],
                     "items": items, "tax_rate": 24, "subtotal": net, "tax": vat, "total": tot, "notes": "", "currency": "EUR",
                     "status": status, "issue_date": issued, "due_date": (t - timedelta(days=ago - 30)).isoformat(),
                     "recurring": "none", "paid_at": (t - timedelta(days=max(ago - 10, 0))).isoformat() + "T10:00:00+00:00" if status == "paid" else None})
    await d.invoices.insert_many(invs)
    exps = []
    for n, (vendor, cat, gross, rate) in enumerate(SAMPLE_EXPENSES):
        net = round(gross / (1 + rate / 100), 2)
        exps.append({"id": str(uuid.uuid4()), **base, "date": (t - timedelta(days=n * 6)).isoformat(), "vendor_name": vendor,
                     "vendor_afm": "", "supplier_id": None, "category": cat, "description": "Sample expense", "net": net,
                     "vat": round(gross - net, 2), "total": gross, "vat_rate": rate, "currency": "EUR", "payment_method": "card",
                     "payment_status": "paid", "document_number": "", "mark": ""})
    await d.expenses.insert_many(exps)
    return {"ok": True, "clients": len(clients), "invoices": len(invs), "expenses": len(exps)}


@router.delete("/onboarding/sample-data")
async def clear_sample(ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    d = get_db()
    removed = 0
    for coll in ("clients", "products", "invoices", "expenses"):
        removed += (await d[coll].delete_many({"org_id": ctx.org_id, "sample": True})).deleted_count
    return {"ok": True, "removed": removed}
