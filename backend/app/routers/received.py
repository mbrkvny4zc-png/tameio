"""Purchase invoices other businesses reported to myDATA about you: import, match to expenses, classify, send.

Flow: sync (RequestDocs) -> auto-match to recorded expenses -> suggest a category
(matched expense > earlier classification of the same supplier > AI) -> the
accountant/owner reviews -> send the expense classification to AADE.
"""
import hashlib
import random
import uuid
from datetime import date, timedelta
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app import ai, greek_tax as gt
from app.auth import Ctx, get_ctx, require_role
from app.common import next_number
from app.db import get_db, now
from app.routers.mydata import _decrypt_key, _settings

router = APIRouter(tags=["received"])

# Default link from app categories to myDATA classification categories. E3 codes are left for the
# accountant to confirm in Settings → Classification codes (they depend on the business's books).
DEFAULT_MAP = {
    "materials": "category2_1", "fuel": "category2_4", "travel": "category2_4", "rent": "category2_4", "telecom": "category2_4",
    "software": "category2_3", "professional": "category2_3", "marketing": "category2_3", "meals": "category2_5", "equipment": "category2_7",
    "insurance": "category2_4", "taxes": "category2_5", "bank": "category2_4", "other": "category2_4",
}


async def get_map(org_id: str) -> dict:
    doc = await get_db().classification_map.find_one({"org_id": org_id}, {"_id": 0}) or {}
    saved = doc.get("items", {})
    return {k: {"category": saved.get(k, {}).get("category") or DEFAULT_MAP[k], "e3_type": saved.get(k, {}).get("e3_type", "")}
            for k in ai.CATEGORIES}


@router.get("/received/classification-map")
async def read_map(ctx: Ctx = Depends(get_ctx)):
    return {"items": await get_map(ctx.org_id), "mydata_categories": gt.EXPENSE_CATEGORIES,
            "labels": ai.CATEGORIES}


class MapInput(BaseModel):
    items: dict


@router.put("/received/classification-map")
async def save_map(data: MapInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    clean = {}
    for k, v in (data.items or {}).items():
        if k not in ai.CATEGORIES or not isinstance(v, dict):
            continue
        cat = v.get("category") if v.get("category") in gt.EXPENSE_CATEGORIES else DEFAULT_MAP[k]
        e3 = str(v.get("e3_type") or "").strip().upper()[:20]
        if e3 and not e3.startswith("E3_"):
            raise HTTPException(status_code=400, detail=f"E3 codes look like E3_102_001 (got '{e3}')")
        clean[k] = {"category": cat, "e3_type": e3}
    await get_db().classification_map.update_one({"org_id": ctx.org_id}, {"$set": {"items": clean, "updated_at": now()}}, upsert=True)
    return {"items": await get_map(ctx.org_id)}


# ------------------------------------------------------------------ sync

async def _request_docs(settings: dict, params: dict) -> str:
    headers = {"aade-user-id": settings.get("aade_user_id", ""), "Ocp-Apim-Subscription-Key": await _decrypt_key(settings)}
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(f"{gt.ENDPOINTS[settings['environment']]}/RequestDocs", headers=headers, params=params)
    if r.status_code in (401, 403):
        raise HTTPException(status_code=502, detail="AADE rejected your credentials — check the user ID and subscription key in myDATA settings")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"AADE returned an error ({r.status_code})")
    return r.text


SIM_VENDORS = [("ΗΛΕΚΤΡΙΚΗ ΕΝΕΡΓΕΙΑ ΑΤΤΙΚΗΣ ΑΕ", "Electricity bill"), ("ΤΗΛΕΠΙΚΟΙΝΩΝΙΕΣ ΑΙΓΑΙΟΥ ΑΕ", "Mobile & internet"),
               ("ΧΑΛΚΟΣ & ΚΑΛΩΔΙΑ ΟΕ", "Copper cable 3x2.5 100m"), ("ΛΟΓΙΣΤΙΚΟ ΓΡΑΦΕΙΟ ΔΗΜΗΤΡΙΟΥ", "Accounting services")]


def _fake_afm(seed: str) -> str:
    rnd = random.Random(seed)
    p = "".join(str(rnd.randint(0, 9)) for _ in range(8))
    t = sum(int(p[i]) * 2 ** (8 - i) for i in range(8))
    return p + str((t % 11) % 10)


async def _simulated_docs(org_id: str) -> list:
    """Demo data: mirror recorded expenses that carry a ΜΑΡΚ, plus a few typical bills."""
    d = get_db()
    out = []
    for x in await d.expenses.find({"org_id": org_id, "mark": {"$nin": ["", None]}}, {"_id": 0}).to_list(50):
        out.append({"mark": x["mark"], "issuer_afm": x.get("vendor_afm", ""), "issuer_name": x.get("vendor_name", ""), "series": "A",
                    "aa": x.get("document_number") or "1", "issue_date": x["date"], "invoice_type": "11.1", "currency": "EUR",
                    "net": x["net"], "vat": x["vat"], "gross": x["total"], "lines": [{"line_number": 1, "net": x["net"], "vat": x["vat"], "description": x.get("description", "")}],
                    "cancelled_by_mark": ""})
    today = date.today()
    for i, (name, line) in enumerate(SIM_VENDORS):
        net = round(random.Random(org_id + name).uniform(30, 400), 2)
        out.append({"mark": str(400009000000000 + int(hashlib.sha1((org_id + name).encode()).hexdigest(), 16) % 10**9), "issuer_afm": _fake_afm(name), "issuer_name": name,
                    "series": "Β", "aa": str(1000 + i), "issue_date": (today - timedelta(days=3 + i * 4)).isoformat(), "invoice_type": "1.1" if i == 2 else "2.1",
                    "currency": "EUR", "net": net, "vat": round(net * 0.24, 2), "gross": round(net * 1.24, 2),
                    "lines": [{"line_number": 1, "net": net, "vat": round(net * 0.24, 2), "description": line}], "cancelled_by_mark": ""})
    return out


async def _match_and_suggest(org_id: str) -> int:
    """Match unmatched documents to expenses, and fill suggestions from expenses / supplier history."""
    d = get_db()
    matched = 0
    for doc in await d.received_docs.find({"org_id": org_id, "match": None}, {"_id": 0}).to_list(5000):
        exp = await d.expenses.find_one({"org_id": org_id, "mark": doc["mark"]}, {"_id": 0})
        if not exp and doc.get("issuer_afm") and doc.get("issue_date"):
            dt = date.fromisoformat(doc["issue_date"][:10])
            cands = await d.expenses.find({"org_id": org_id, "vendor_afm": doc["issuer_afm"],
                                           "date": {"$gte": (dt - timedelta(days=5)).isoformat(), "$lte": (dt + timedelta(days=5)).isoformat()}},
                                          {"_id": 0}).to_list(50)
            exp = next((c for c in cands if abs((c.get("total") or 0) - doc["gross"]) <= 0.05), None)
        sets = {}
        if exp and not await d.received_docs.find_one({"org_id": org_id, "match.id": exp["id"]}):
            sets["match"] = {"type": "expense", "id": exp["id"], "number": exp["number"]}
            if not doc.get("suggestion"):
                sets["suggestion"] = {"category": exp.get("category") or "other", "source": "expense", "confidence": "high"}
            if not exp.get("mark"):
                await d.expenses.update_one({"id": exp["id"]}, {"$set": {"mark": doc["mark"]}})
            matched += 1
        if not doc.get("suggestion") and "suggestion" not in sets and doc.get("issuer_afm"):
            prev = await d.received_docs.find_one({"org_id": org_id, "issuer_afm": doc["issuer_afm"], "classification.state": "sent"},
                                                  {"_id": 0, "classification": 1}, sort=[("issue_date", -1)])
            if prev:
                sets["suggestion"] = {"category": prev["classification"]["category"], "source": "history", "confidence": "high"}
        if sets:
            await d.received_docs.update_one({"id": doc["id"]}, {"$set": sets})
    return matched


@router.post("/received/sync")
async def sync(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    settings = await _settings(ctx.org_id)
    env = settings.get("environment", "simulation")
    state = await d.received_sync.find_one({"org_id": ctx.org_id}, {"_id": 0}) or {}
    if env == "simulation":
        docs = await _simulated_docs(ctx.org_id)
    else:
        params = {"mark": state.get("last_mark", "0")}
        docs, pages = [], 0
        while True:
            parsed = gt.parse_requested_docs(await _request_docs(settings, params))
            docs += parsed["docs"]
            pages += 1
            if not parsed["continuation"] or pages >= 25:
                break
            params = {**params, **parsed["continuation"]}
    added = 0
    suppliers = {s["afm"]: s for s in await d.suppliers.find({"org_id": ctx.org_id, "afm": {"$ne": ""}}, {"_id": 0, "afm": 1, "name": 1, "id": 1}).to_list(5000)}
    for x in docs:
        if not x.get("mark") or await d.received_docs.find_one({"org_id": ctx.org_id, "mark": x["mark"]}):
            continue
        sup = suppliers.get(x.get("issuer_afm"))
        await d.received_docs.insert_one({"id": str(uuid.uuid4()), "org_id": ctx.org_id, **x,
                                          "issuer_name": x.get("issuer_name") or (sup or {}).get("name") or "", "supplier_id": (sup or {}).get("id"),
                                          "simulated": env == "simulation", "environment": env, "match": None, "suggestion": None,
                                          "classification": {"state": "none"}, "ignored": bool(x.get("cancelled_by_mark")), "created_at": now()})
        added += 1
    marks = [int(x["mark"]) for x in docs if str(x.get("mark", "")).isdigit()]
    await d.received_sync.update_one({"org_id": ctx.org_id}, {"$set": {"last_sync": now(), "environment": env,
                                                                       **({"last_mark": str(max(marks))} if marks and env != "simulation" else {})}}, upsert=True)
    matched = await _match_and_suggest(ctx.org_id)
    return {"added": added, "matched": matched, "environment": env}


@router.get("/received")
async def list_received(ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    docs = await d.received_docs.find({"org_id": ctx.org_id}, {"_id": 0}).sort("issue_date", -1).to_list(5000)
    state = await d.received_sync.find_one({"org_id": ctx.org_id}, {"_id": 0}) or {}
    return {"items": docs, "last_sync": state.get("last_sync"), "map": await get_map(ctx.org_id)}


@router.post("/received/suggest")
async def suggest(ctx: Ctx = Depends(get_ctx)):
    """Ask the AI for categories on documents that have no suggestion yet."""
    d = get_db()
    pending = await d.received_docs.find({"org_id": ctx.org_id, "suggestion": None, "ignored": {"$ne": True}}, {"_id": 0}).to_list(200)
    done = 0
    for i in range(0, len(pending), 40):
        batch = pending[i:i + 40]
        try:
            res = await ai.suggest_categories([{"id": p["id"], "issuer": p.get("issuer_name"), "afm": p.get("issuer_afm"), "net": p.get("net"),
                                                "lines": [l.get("description") for l in p.get("lines", []) if l.get("description")][:10]} for p in batch])
        except ai.ScanError as e:
            raise HTTPException(status_code=503, detail=str(e))
        for doc_id, (cat, conf) in res.items():
            await d.received_docs.update_one({"id": doc_id}, {"$set": {"suggestion": {"category": cat, "source": "ai", "confidence": conf}}})
            done += 1
    return {"suggested": done, "remaining": len(pending) - done}


class ClassifyInput(BaseModel):
    category: str


@router.put("/received/{doc_id}/classification")
async def classify(doc_id: str, data: ClassifyInput, ctx: Ctx = Depends(get_ctx)):
    if data.category not in ai.CATEGORIES:
        raise HTTPException(status_code=400, detail="Unknown category")
    d = get_db()
    doc = await d.received_docs.find_one({"id": doc_id, "org_id": ctx.org_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if (doc.get("classification") or {}).get("state") == "sent":
        raise HTTPException(status_code=409, detail="Already classified at AADE")
    m = (await get_map(ctx.org_id))[data.category]
    await d.received_docs.update_one({"id": doc_id}, {"$set": {"classification": {"state": "draft", "category": data.category,
                                                                                    "mydata_category": m["category"], "e3_type": m["e3_type"]}}})
    if doc.get("match") and doc["match"].get("type") == "expense":
        await d.expenses.update_one({"id": doc["match"]["id"], "org_id": ctx.org_id}, {"$set": {"category": data.category}})
    return await d.received_docs.find_one({"id": doc_id}, {"_id": 0})


class IgnoreInput(BaseModel):
    ignored: bool = True


@router.put("/received/{doc_id}/ignore")
async def ignore(doc_id: str, data: IgnoreInput, ctx: Ctx = Depends(get_ctx)):
    await get_db().received_docs.update_one({"id": doc_id, "org_id": ctx.org_id}, {"$set": {"ignored": data.ignored}})
    return {"ok": True}


@router.post("/received/{doc_id}/create-expense")
async def create_expense(doc_id: str, ctx: Ctx = Depends(get_ctx)):
    d = get_db()
    doc = await d.received_docs.find_one({"id": doc_id, "org_id": ctx.org_id}, {"_id": 0})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    if doc.get("match"):
        raise HTTPException(status_code=409, detail=f"Already linked to {doc['match']['number']}")
    cat = (doc.get("classification") or {}).get("category") or (doc.get("suggestion") or {}).get("category") or "other"
    exp_id = str(uuid.uuid4())
    number = await next_number(ctx.org_id, "expense", "EXP")
    rate = round(doc["vat"] / doc["net"] * 100) if doc.get("net") else 0
    await d.expenses.insert_one({"id": exp_id, "org_id": ctx.org_id, "number": number, "date": doc["issue_date"][:10],
                                 "vendor_name": doc.get("issuer_name") or doc.get("issuer_afm"), "vendor_afm": doc.get("issuer_afm", ""),
                                 "supplier_id": doc.get("supplier_id"), "category": cat,
                                 "description": "; ".join(l["description"] for l in doc.get("lines", []) if l.get("description"))[:300],
                                 "net": round(doc["net"], 2), "vat": round(doc["vat"], 2), "total": round(doc["gross"] or doc["net"] + doc["vat"], 2),
                                 "vat_rate": rate, "currency": doc.get("currency", "EUR"), "payment_method": "bank_transfer", "payment_status": "unpaid",
                                 "document_number": f"{doc.get('series', '')} {doc.get('aa', '')}".strip(), "mark": doc["mark"], "source": "mydata",
                                 "created_by": ctx.user_id, "created_at": now(), "updated_at": now()})
    await d.received_docs.update_one({"id": doc_id}, {"$set": {"match": {"type": "expense", "id": exp_id, "number": number}}})
    return {"id": exp_id, "number": number}


class SendInput(BaseModel):
    ids: List[str]


@router.post("/received/send")
async def send_classifications(data: SendInput, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin", "accountant")
    d = get_db()
    docs = await d.received_docs.find({"org_id": ctx.org_id, "id": {"$in": data.ids[:200]}}, {"_id": 0}).to_list(200)
    ready = [x for x in docs if (x.get("classification") or {}).get("state") in ("draft", "error")]
    if not ready:
        raise HTTPException(status_code=400, detail="Choose a category for the documents first")
    missing = sorted({ai.category_label(x["classification"]["category"]) for x in ready if not x["classification"].get("e3_type")})
    settings = await _settings(ctx.org_id)
    env = settings.get("environment", "simulation")
    if missing and env != "simulation":
        raise HTTPException(status_code=422, detail={"message": "Set the E3 code for these categories in Settings → Classification codes",
                                                     "errors": missing})
    items = [{"mark": x["mark"], "category": x["classification"]["mydata_category"], "e3_type": x["classification"].get("e3_type") or "E3_SIMULATED",
              "lines": x.get("lines") or [{"line_number": 1, "net": x["net"]}]} for x in ready]
    xml = gt.build_expenses_classification(items)
    if env == "simulation" or all(x.get("simulated") for x in ready):
        results = [{"ok": True, "status": "Success", "classification_mark": str(400000000000000 + random.randint(0, 99999999999)), "errors": []} for _ in ready]
    else:
        from app.routers.mydata import _post_aade
        try:
            resp = await _post_aade(settings, "SendExpensesClassification", xml)
            results = gt.parse_responses(resp.text)
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Couldn't reach AADE — nothing was sent, try again")
    sent, failed = 0, []
    for x, r in zip(ready, results + [{"ok": False, "errors": [{"code": "", "message": "No response for this document"}]}] * len(ready)):
        if r.get("ok"):
            sent += 1
            await d.received_docs.update_one({"id": x["id"]}, {"$set": {"classification.state": "sent", "classification.mark": r.get("classification_mark"),
                                                                        "classification.sent_at": now(), "classification.simulated": env == "simulation"}})
        else:
            msg = "; ".join(f"{e['code']} {e['message']}".strip() for e in r.get("errors", [])) or r.get("status", "Rejected")
            failed.append(f"{x.get('issuer_name') or x['mark']}: {msg}")
            await d.received_docs.update_one({"id": x["id"]}, {"$set": {"classification.state": "error", "classification.error": msg}})
    await d.mydata_transmissions.insert_one({"id": str(uuid.uuid4()), "org_id": ctx.org_id, "user_id": ctx.user_id, "invoice_id": None,
                                             "invoice_number": f"{len(ready)} purchase invoice(s)", "client_name": "Expense classification",
                                             "action": "classify", "environment": env, "ok": not failed, "status": "Success" if not failed else "Partial",
                                             "mark": None, "errors": [{"code": "", "message": f} for f in failed], "xml": xml[:200_000], "created_at": now()})
    return {"sent": sent, "failed": failed}
