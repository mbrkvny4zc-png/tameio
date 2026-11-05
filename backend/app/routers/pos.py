"""Card terminal (e-POS) linking: the receipt's amount is pushed to the shop's Viva card terminal, and the
terminal's transaction id travels with the receipt to myDATA.

Flow: create receipt (unreported) -> POST /receipts/{id}/terminal (sends a sale to the terminal via Viva's
Cloud Terminal API) -> the app polls GET /receipts/{id}/terminal -> on approval the receipt is marked paid and
reported to myDATA with paymentMethodDetails.transactionId / tid.

NOTE: built from Viva's Cloud Terminal API (/ecr/v1). It has not been run against a real terminal. The full
Greek e-POS protocol also requires a signature from a licensed e-invoicing provider (aadeProvider* fields);
that comes with the provider partnership.
"""
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import Ctx, get_ctx, require_role
from app.db import get_db, now
from app.routers.payments import VIVA_HOSTS, _viva, _viva_token

router = APIRouter(tags=["pos"])


class TerminalSettings(BaseModel):
    terminal_id: Optional[str] = ""
    cash_register_id: Optional[str] = ""
    simulate: Optional[bool] = False


@router.get("/pos/settings")
async def read_pos(ctx: Ctx = Depends(get_ctx)):
    v = await _viva(ctx.org_id)
    return {"terminal_id": v.get("terminal_id", ""), "cash_register_id": v.get("cash_register_id", ""), "simulate": bool(v.get("pos_simulate")),
            "viva_ready": bool(v.get("client_id") and v.get("client_secret_enc"))}


@router.put("/pos/settings")
async def save_pos(data: TerminalSettings, ctx: Ctx = Depends(get_ctx)):
    require_role(ctx, "owner", "admin")
    sets = {"terminal_id": (data.terminal_id or "").strip()[:40], "cash_register_id": (data.cash_register_id or "").strip()[:60] or "TAMEIO-1",
            "pos_simulate": bool(data.simulate)}
    await get_db().viva_settings.update_one({"org_id": ctx.org_id}, {"$set": sets}, upsert=True)
    return await read_pos(ctx)


async def _receipt(org_id: str, rid: str) -> dict:
    r = await get_db().invoices.find_one({"id": rid, "org_id": org_id, "kind": "receipt"}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Receipt not found")
    return r


@router.post("/receipts/{rid}/terminal")
async def start_terminal_sale(rid: str, ctx: Ctx = Depends(get_ctx)):
    rec = await _receipt(ctx.org_id, rid)
    if (rec.get("mydata") or {}).get("state") == "transmitted" or (rec.get("terminal") or {}).get("status") == "approved":
        raise HTTPException(status_code=409, detail="This receipt is already paid")
    v = await _viva(ctx.org_id)
    if not v.get("terminal_id") and not v.get("pos_simulate"):
        raise HTTPException(status_code=400, detail="Add your card terminal ID in Settings → Connections first")
    session = str(uuid.uuid4())
    term = {"session_id": session, "status": "pending", "started_at": now(), "amount": rec["total"]}
    if not v.get("pos_simulate"):
        token = await _viva_token(v)
        body = {"sessionId": session, "terminalId": v["terminal_id"], "cashRegisterId": v.get("cash_register_id") or "TAMEIO-1",
                "amount": int(round(rec["total"] * 100)), "currencyCode": "978", "merchantReference": rec["number"],
                "customerTrns": rec["number"], "preauth": False, "maxInstalments": 0, "tipAmount": 0}
        try:
            async with httpx.AsyncClient(timeout=20) as c:
                r = await c.post(f"{VIVA_HOSTS[v.get('environment', 'demo')]['api']}/ecr/v1/transactions:sale", json=body,
                                 headers={"Authorization": f"Bearer {token}"})
        except httpx.HTTPError:
            raise HTTPException(status_code=502, detail="Couldn't reach the card terminal service — try again")
        if r.status_code >= 300:
            raise HTTPException(status_code=502, detail="The card terminal didn't accept the request — check the terminal ID and that it's online")
    await get_db().invoices.update_one({"id": rid}, {"$set": {"terminal": term, "payment": "card", "status": "draft"}})
    return term


async def _finish(ctx: Ctx, rec: dict, txn: str, tid: str) -> dict:
    from app.routers.mydata import MyDataInput, _settings, submit
    from app.routers.invoices import sync_stock
    d = get_db()
    await d.invoices.update_one({"id": rec["id"]}, {"$set": {"terminal.status": "approved", "terminal.transaction_id": txn, "terminal.terminal_id": tid,
                                                             "status": "paid", "paid_at": now(), "mydata.transaction_id": txn, "mydata.terminal_id": tid}})
    rec = await _receipt(ctx.org_id, rec["id"])
    await sync_stock(rec)
    md = rec.get("mydata") or {}
    out = {"status": "approved", "transaction_id": txn, "mydata": None, "mydata_error": None}
    if (await _settings(ctx.org_id)).get("vat_number") and md.get("state") != "transmitted":
        try:
            r = await submit(rec["id"], MyDataInput(invoice_type=md.get("invoice_type") or "11.1", payment_method=7), ctx)
            out["mydata"] = (r.get("mydata") or {}).get("mark")
        except HTTPException as e:
            out["mydata_error"] = e.detail.get("message") if isinstance(e.detail, dict) else str(e.detail)
    return out


@router.get("/receipts/{rid}/terminal")
async def poll_terminal_sale(rid: str, ctx: Ctx = Depends(get_ctx)):
    rec = await _receipt(ctx.org_id, rid)
    term = rec.get("terminal") or {}
    if term.get("status") != "pending":
        return {"status": term.get("status") or "none", "transaction_id": term.get("transaction_id")}
    v = await _viva(ctx.org_id)
    if v.get("pos_simulate"):  # demo mode: approve after the first poll
        return await _finish(ctx, rec, f"SIM-{uuid.uuid4().hex[:12].upper()}", v.get("terminal_id") or "SIM-TERMINAL")
    token = await _viva_token(v)
    try:
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.get(f"{VIVA_HOSTS[v.get('environment', 'demo')]['api']}/ecr/v1/sessions/{term['session_id']}",
                            headers={"Authorization": f"Bearer {token}"})
    except httpx.HTTPError:
        return {"status": "pending"}
    if r.status_code == 404:
        return {"status": "pending"}
    data = r.json() if r.status_code == 200 else {}
    if data.get("success") is True:
        return await _finish(ctx, rec, str(data.get("transactionId") or ""), str(data.get("terminalId") or v.get("terminal_id")))
    if data.get("success") is False:
        await get_db().invoices.update_one({"id": rid}, {"$set": {"terminal.status": "declined", "terminal.message": str(data.get("message") or "")[:200]}})
        return {"status": "declined", "message": data.get("message") or "Payment declined"}
    return {"status": "pending"}


@router.post("/receipts/{rid}/terminal/cancel")
async def cancel_terminal_sale(rid: str, ctx: Ctx = Depends(get_ctx)):
    rec = await _receipt(ctx.org_id, rid)
    if (rec.get("terminal") or {}).get("status") == "approved":
        raise HTTPException(status_code=409, detail="Already paid")
    await get_db().invoices.update_one({"id": rid}, {"$set": {"terminal.status": "cancelled"}})
    return {"status": "cancelled"}
