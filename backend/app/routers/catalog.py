"""Saved products & services, and importing clients / products / past invoices from Excel or CSV."""
import csv
import io
import re
import unicodedata
import uuid
from datetime import date, datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app import greek_tax as gt
from app.auth import Ctx, get_ctx
from app.common import next_number, totals
from app.db import get_db, now

router = APIRouter(tags=["catalog"])

UNITS = ("pcs", "hour", "day", "month", "kg", "lt", "m", "m2", "service")


# ------------------------------------------------------------------ products

class ProductInput(BaseModel):
    name: str
    code: Optional[str] = ""
    description: Optional[str] = ""
    unit_price: float = 0
    tax_rate: Optional[float] = 24
    unit: Optional[str] = "pcs"
    kind: Optional[str] = "service"
    track_stock: Optional[bool] = False
    low_stock: Optional[float] = 0


def _clean_product(p: ProductInput) -> dict:
    name = (p.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Give the product or service a name")
    if p.unit_price < 0 or p.unit_price != p.unit_price:
        raise HTTPException(status_code=400, detail="Price can't be negative")
    rate = p.tax_rate if p.tax_rate in gt.VAT_CATEGORIES else 24
    return {"name": name[:200], "code": (p.code or "").strip()[:50], "description": (p.description or "").strip()[:500],
            "unit_price": round(p.unit_price, 4), "tax_rate": rate, "unit": p.unit if p.unit in UNITS else "pcs",
            "kind": "goods" if p.kind == "goods" else "service",
            "track_stock": bool(p.track_stock) and p.kind == "goods", "low_stock": max(0.0, float(p.low_stock or 0))}


@router.get("/products")
async def list_products(ctx: Ctx = Depends(get_ctx)):
    return await get_db().products.find({"org_id": ctx.org_id}, {"_id": 0}).sort([("uses", -1), ("name", 1)]).to_list(5000)


@router.post("/products")
async def create_product(data: ProductInput, ctx: Ctx = Depends(get_ctx)):
    doc = {"id": str(uuid.uuid4()), "org_id": ctx.org_id, **_clean_product(data), "uses": 0, "stock": 0.0, "created_at": now(), "updated_at": now()}
    await get_db().products.insert_one({**doc})
    return doc


@router.put("/products/{product_id}")
async def update_product(product_id: str, data: ProductInput, ctx: Ctx = Depends(get_ctx)):
    r = await get_db().products.update_one({"id": product_id, "org_id": ctx.org_id}, {"$set": {**_clean_product(data), "updated_at": now()}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Product not found")
    return await get_db().products.find_one({"id": product_id}, {"_id": 0})


@router.delete("/products/{product_id}")
async def delete_product(product_id: str, ctx: Ctx = Depends(get_ctx)):
    r = await get_db().products.delete_one({"id": product_id, "org_id": ctx.org_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"ok": True}


@router.post("/products/{product_id}/used")
async def product_used(product_id: str, ctx: Ctx = Depends(get_ctx)):
    """Most-used items float to the top of the picker."""
    await get_db().products.update_one({"id": product_id, "org_id": ctx.org_id}, {"$inc": {"uses": 1}})
    return {"ok": True}


# ------------------------------------------------------------------ stock

class StockInput(BaseModel):
    qty: float
    note: Optional[str] = ""


async def _move(org_id: str, product: dict, qty: float, reason: str, ref: str = "", ref_id: str = "", user_id: str = ""):
    d = get_db()
    await d.products.update_one({"id": product["id"]}, {"$inc": {"stock": qty}})
    await d.stock_moves.insert_one({"id": str(uuid.uuid4()), "org_id": org_id, "product_id": product["id"], "qty": qty, "reason": reason,
                                    "ref": ref, "ref_id": ref_id, "user_id": user_id, "created_at": now()})
    after = (product.get("stock") or 0) + qty
    low = product.get("low_stock") or 0
    if qty < 0 and low > 0 and after <= low < (product.get("stock") or 0):
        from app.notify import notify
        await notify(org_id, "stock", f"Low stock: {product['name']} ({after:g} left)", "/app/products")


async def apply_stock(org_id: str, doc: dict, sign: int, reason: str):
    """Move stock for every line that came from a tracked product. sign -1 = goods out (sale), +1 = goods back."""
    ids = [i["product_id"] for i in doc.get("items") or [] if i.get("product_id")]
    if not ids:
        return
    prods = {p["id"]: p for p in await get_db().products.find({"org_id": org_id, "id": {"$in": ids}, "track_stock": True}, {"_id": 0}).to_list(500)}
    for i in doc["items"]:
        p = prods.get(i.get("product_id"))
        if p:
            await _move(org_id, p, sign * float(i.get("qty") or 0), reason, doc.get("number", ""), doc.get("id", ""))
            p["stock"] = (p.get("stock") or 0) + sign * float(i.get("qty") or 0)


@router.post("/products/{product_id}/stock")
async def adjust_stock(product_id: str, data: StockInput, ctx: Ctx = Depends(get_ctx)):
    p = await get_db().products.find_one({"id": product_id, "org_id": ctx.org_id}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    if not p.get("track_stock"):
        raise HTTPException(status_code=400, detail="Turn on stock tracking for this product first")
    if not data.qty:
        raise HTTPException(status_code=400, detail="Enter a quantity (negative to remove)")
    await _move(ctx.org_id, p, round(data.qty, 3), "adjustment", (data.note or "").strip()[:120], user_id=ctx.user_id)
    return await get_db().products.find_one({"id": product_id}, {"_id": 0})


@router.get("/products/{product_id}/moves")
async def stock_moves(product_id: str, ctx: Ctx = Depends(get_ctx)):
    return await get_db().stock_moves.find({"org_id": ctx.org_id, "product_id": product_id}, {"_id": 0}).sort("created_at", -1).to_list(200)


# ------------------------------------------------------------------ import

def _norm(h) -> str:
    s = unicodedata.normalize("NFD", str(h or "").strip().lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # drop Greek accents
    return re.sub(r"[^a-z0-9α-ω]+", " ", s).strip()


# Accepted column names (English, Greek, and what common Greek tools export), normalised by _norm.
SYNONYMS = {
    "clients": {
        "name": ["name", "client", "customer", "full name", "ονομα", "επωνυμια", "πελατης", "ονοματεπωνυμο", "επωνυμια πελατη"],
        "company": ["company", "business", "εταιρεια", "διακριτικος τιτλος", "επιχειρηση"],
        "email": ["email", "e mail", "mail", "ηλεκτρονικο ταχυδρομειο"],
        "phone": ["phone", "telephone", "mobile", "τηλεφωνο", "κινητο", "τηλ"],
        "afm": ["afm", "vat", "vat number", "tax id", "αφμ", "α φ μ"],
        "doy": ["doy", "tax office", "δου", "δ ο υ"],
        "address": ["address", "street", "διευθυνση", "οδος"],
        "city": ["city", "town", "πολη", "περιοχη"],
        "postal_code": ["postal code", "zip", "postcode", "τκ", "τ κ", "ταχυδρομικος κωδικας"],
        "country": ["country", "χωρα"],
    },
    "products": {
        "name": ["name", "product", "service", "item", "description", "ονομα", "προιον", "υπηρεσια", "περιγραφη", "ειδος"],
        "code": ["code", "sku", "κωδικος"],
        "unit_price": ["price", "unit price", "net price", "τιμη", "τιμη μοναδας", "καθαρη τιμη"],
        "tax_rate": ["vat", "vat rate", "tax", "φπα", "συντελεστης φπα"],
        "unit": ["unit", "μοναδα", "μ μ", "μονάδα μέτρησης"],
    },
    "invoices": {
        "number": ["number", "invoice", "invoice number", "no", "αριθμος", "αρ παραστατικου", "αριθμος τιμολογιου"],
        "issue_date": ["date", "issue date", "invoice date", "ημερομηνια", "ημ νια", "ημερομηνια εκδοσης"],
        "client_name": ["client", "customer", "name", "πελατης", "επωνυμια", "ονομα"],
        "client_afm": ["afm", "vat", "αφμ", "αφμ πελατη"],
        "net": ["net", "net amount", "subtotal", "amount", "καθαρη αξια", "καθαρο", "αξια"],
        "tax_rate": ["vat rate", "φπα %", "συντελεστης φπα", "vat %"],
        "vat": ["vat", "vat amount", "tax", "φπα", "ποσο φπα"],
        "total": ["total", "gross", "συνολο", "πληρωτεο", "τελικο ποσο", "συνολικη αξια"],
        "status": ["status", "paid", "κατασταση", "εξοφληθηκε"],
        "due_date": ["due", "due date", "ληξη", "ημερομηνια ληξης"],
    },
}
REQUIRED = {"clients": ["name"], "products": ["name"], "invoices": ["client_name"]}
MAX_ROWS = 5000


def read_table(raw: bytes, filename: str) -> list[list]:
    name = (filename or "").lower()
    if name.endswith((".xlsx", ".xlsm")):
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        except Exception:
            raise HTTPException(status_code=400, detail="This Excel file couldn't be opened — save it as .xlsx or .csv and try again")
        rows = [list(r) for r in wb.worksheets[0].iter_rows(values_only=True)]
    elif name.endswith((".csv", ".txt")):
        for enc in ("utf-8-sig", "cp1253", "latin-1"):  # Greek Windows exports are often cp1253
            try:
                text = raw.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        try:
            dialect = csv.Sniffer().sniff(text[:4000], delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        rows = list(csv.reader(io.StringIO(text), dialect))
    else:
        raise HTTPException(status_code=400, detail="Upload an Excel (.xlsx) or CSV file")
    rows = [r for r in rows if any(str(c or "").strip() for c in r)]
    if len(rows) < 2:
        raise HTTPException(status_code=400, detail="The file needs a header row and at least one data row")
    return rows[:MAX_ROWS + 1]


def guess_mapping(kind: str, headers: list) -> dict:
    """field -> column index, matching header names against SYNONYMS (exact first, then 'contains')."""
    normed = [_norm(h) for h in headers]
    mapping, used = {}, set()
    for exact in (True, False):
        for field, names in SYNONYMS[kind].items():
            if field in mapping:
                continue
            targets = [_norm(n) for n in names]
            for i, h in enumerate(normed):
                if i in used or not h:
                    continue
                if (h in targets) if exact else any(t and (t in h) for t in targets if len(t) > 2):
                    mapping[field] = i
                    used.add(i)
                    break
    return mapping


def _num(v) -> Optional[float]:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = re.sub(r"[^\d,.\-]", "", str(v))
    if "," in s and "." in s:  # 1.234,56 (Greek) or 1,234.56
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _date(v) -> Optional[str]:
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s[:10], fmt).date().isoformat()
        except ValueError:
            continue
    return None


def _str(v, n=300) -> str:
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()[:n]


def build_rows(kind: str, rows: list, mapping: dict) -> tuple[list, list]:
    """Turn spreadsheet rows into documents. Returns (good, problems) — problems carry the 1-based spreadsheet row."""
    good, problems = [], []
    for n, r in enumerate(rows[1:], start=2):
        get = lambda f: r[mapping[f]] if f in mapping and mapping[f] < len(r) else None  # noqa: E731
        try:
            if kind == "clients":
                afm = gt.normalize_afm(_str(get("afm"), 20))
                country = (_str(get("country"), 2) or "GR").upper()
                if afm and country == "GR" and not gt.is_valid_afm(afm):
                    raise ValueError(f"ΑΦΜ {afm} fails the checksum")
                doc = {"name": _str(get("name")), "company": _str(get("company")), "email": _str(get("email")).lower(),
                       "phone": _str(get("phone"), 50), "afm": afm, "doy": _str(get("doy"), 100), "address": _str(get("address")),
                       "city": _str(get("city"), 100), "postal_code": _str(get("postal_code"), 10), "country": country, "notes": ""}
                if not doc["name"]:
                    raise ValueError("missing name")
            elif kind == "products":
                price = _num(get("unit_price")) or 0
                rate = _num(get("tax_rate"))
                rate = int(rate * 100) if rate is not None and 0 < rate < 1 else (int(rate) if rate is not None else 24)
                if rate not in gt.VAT_CATEGORIES:
                    raise ValueError(f"VAT {rate}% isn't a Greek rate")
                doc = {"name": _str(get("name"), 200), "code": _str(get("code"), 50), "description": "", "unit_price": round(price, 4),
                       "tax_rate": rate, "unit": "pcs", "kind": "service", "uses": 0}
                if not doc["name"]:
                    raise ValueError("missing name")
            else:
                net, vat, total = _num(get("net")), _num(get("vat")), _num(get("total"))
                rate = _num(get("tax_rate"))
                if rate is not None and 0 < rate < 1:
                    rate *= 100
                if net is None and total is not None:
                    net = round(total / (1 + (rate if rate is not None else 24) / 100), 2) if vat is None else round(total - vat, 2)
                if net is None:
                    raise ValueError("needs a net or total amount")
                if rate is None:
                    rate = round(vat / net * 100) if vat is not None and net else 24
                rate = min(gt.VAT_CATEGORIES, key=lambda x: abs(x - rate))
                items = [{"description": "Imported invoice", "qty": 1, "unit_price": round(net, 2)}]
                sub, tax, tot = totals(items, rate)
                status_raw = _norm(get("status"))
                paid = status_raw in ("paid", "yes", "ναι", "εξοφλημενο", "εξοφληθηκε", "πληρωμενο", "1", "true")
                doc = {"number_imported": _str(get("number"), 50), "issue_date": _date(get("issue_date")) or date.today().isoformat(),
                       "due_date": _date(get("due_date")), "client_name": _str(get("client_name")),
                       "client_afm": gt.normalize_afm(_str(get("client_afm"), 20)), "items": items, "tax_rate": rate,
                       "subtotal": sub, "tax": tax, "total": tot, "status": "paid" if paid else "sent"}
                if not doc["client_name"]:
                    raise ValueError("missing client")
            good.append(doc)
        except ValueError as e:
            problems.append({"row": n, "error": str(e)})
    return good, problems


@router.post("/import/{kind}")
async def import_file(kind: str, file: UploadFile = File(...), commit: bool = Form(False), mapping: Optional[str] = Form(None),
                      ctx: Ctx = Depends(get_ctx)):
    if kind not in SYNONYMS:
        raise HTTPException(status_code=404, detail="Unknown import type")
    raw = await file.read()
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is too large (10 MB max)")
    rows = read_table(raw, file.filename or "")
    headers = [_str(h, 80) for h in rows[0]]
    m = guess_mapping(kind, headers)
    if mapping:  # user-adjusted mapping "field=index,field=index"
        for part in mapping.split(","):
            if "=" in part:
                f, _, i = part.partition("=")
                if f in SYNONYMS[kind]:
                    if i.strip() == "" or i.strip() == "-1":
                        m.pop(f, None)
                    elif i.strip().isdigit() and int(i) < len(headers):
                        m[f] = int(i)
    missing = [f for f in REQUIRED[kind] if f not in m]
    good, problems = build_rows(kind, rows, m) if not missing else ([], [])

    d = get_db()
    dupes = 0
    if kind == "clients" and good:
        existing = await d.clients.find({"org_id": ctx.org_id}, {"_id": 0, "afm": 1, "name": 1}).to_list(20000)
        seen = {c["afm"] for c in existing if c.get("afm")} | {_norm(c["name"]) for c in existing}
        fresh = []
        for g in good:
            key = g["afm"] or _norm(g["name"])
            if key in seen:
                dupes += 1
                continue
            seen.add(key)
            fresh.append(g)
        good = fresh
    if kind == "products" and good:
        existing = {_norm(p["name"]) for p in await d.products.find({"org_id": ctx.org_id}, {"_id": 0, "name": 1}).to_list(20000)}
        before = len(good)
        good = [g for g in good if _norm(g["name"]) not in existing and not existing.add(_norm(g["name"]))]
        dupes = before - len(good)

    result = {"headers": headers, "mapping": m, "fields": list(SYNONYMS[kind]), "required": REQUIRED[kind], "missing": missing,
              "rows": len(rows) - 1, "ready": len(good), "duplicates": dupes, "problems": problems[:50],
              "preview": good[:5], "created": 0}
    if not commit or missing or not good:
        return result

    stamp = now()
    if kind == "clients":
        await d.clients.insert_many([{"id": str(uuid.uuid4()), "org_id": ctx.org_id, **g, "imported": True, "created_at": stamp, "updated_at": stamp} for g in good])
    elif kind == "products":
        await d.products.insert_many([{"id": str(uuid.uuid4()), "org_id": ctx.org_id, **g, "imported": True, "created_at": stamp, "updated_at": stamp} for g in good])
    else:
        clients = {c["name"].lower(): c for c in await d.clients.find({"org_id": ctx.org_id}, {"_id": 0}).to_list(20000)}
        docs = []
        for g in good:
            c = clients.get(g["client_name"].lower())
            docs.append({"id": str(uuid.uuid4()), "org_id": ctx.org_id, "kind": "invoice", "imported": True,
                         "number": g.pop("number_imported") or await next_number(ctx.org_id, "imported", "IMP"),
                         "client_id": c["id"] if c else None, "client_company": "", "client_email": (c or {}).get("email", ""),
                         "client_country": "GR", **g, "notes": "", "currency": "EUR", "recurring": "none",
                         "paid_at": (g["issue_date"] + "T12:00:00+00:00") if g["status"] == "paid" else None,
                         "created_by": ctx.user_id, "created_at": stamp, "updated_at": stamp})
        await d.invoices.insert_many(docs)
    result["created"] = len(good)
    return result
