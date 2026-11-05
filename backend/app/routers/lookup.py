"""ΑΦΜ auto-fill: name, address and tax office from public registries.

Two sources, best first:
  1. AADE "Βασικά Στοιχεία Μητρώου" (RgWsPublic2) — full details incl. ΔΟΥ and activities.
     Needs the special registry-search credentials (AADE_REGISTRY_USER / AADE_REGISTRY_PASS).
  2. EU VIES — free and keyless; returns name and address of VAT-registered Greek businesses.
Results are cached for 30 days so typing the same ΑΦΜ twice never calls out again.
"""
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from xml.sax.saxutils import escape

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from app import config, greek_tax as gt
from app.auth import Ctx, get_ctx
from app.db import get_db, now
from app.ratelimit import rate_limit

log = logging.getLogger("lookup")
router = APIRouter(tags=["lookup"])

AADE_URL = "https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2"
VIES_URL = "https://ec.europa.eu/taxation_customs/vies/rest-api/ms/EL/vat/{afm}"
CACHE_DAYS = 30


def _envelope(afm: str, caller: str) -> str:
    return f"""<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"
 xmlns:ns1="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
 xmlns:ns2="http://rgwspublic2/RgWsPublic2Service" xmlns:ns3="http://rgwspublic2/RgWsPublic2">
 <env:Header><ns1:Security><ns1:UsernameToken>
  <ns1:Username>{escape(config.AADE_REGISTRY_USER)}</ns1:Username><ns1:Password>{escape(config.AADE_REGISTRY_PASS)}</ns1:Password>
 </ns1:UsernameToken></ns1:Security></env:Header>
 <env:Body><ns2:rgWsPublic2AfmMethod><ns2:INPUT_REC>
  <ns3:afm_called_by>{escape(caller)}</ns3:afm_called_by><ns3:afm_called_for>{afm}</ns3:afm_called_for>
 </ns2:INPUT_REC></ns2:rgWsPublic2AfmMethod></env:Body></env:Envelope>"""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_aade(xml_text: str) -> dict:
    """Parse an RgWsPublic2 response into our flat shape. Raises ValueError with AADE's message on errors."""
    root = ET.fromstring(xml_text)
    vals, acts = {}, []
    for el in root.iter():
        name = _local(el.tag)
        if name == "item":
            row = {_local(c.tag): (c.text or "").strip() for c in el}
            if row.get("firm_act_descr"):
                acts.append({"code": row.get("firm_act_code", ""), "description": row["firm_act_descr"],
                             "main": row.get("firm_act_kind") == "1"})
        elif len(el) == 0 and (el.text or "").strip():
            vals.setdefault(name, el.text.strip())
    if vals.get("error_code"):
        raise ValueError(vals.get("error_descr") or vals["error_code"])
    if not vals.get("onomasia"):
        raise ValueError("No business found for this ΑΦΜ")
    street = " ".join(x for x in (vals.get("postal_address"), vals.get("postal_address_no")) if x)
    return {
        "afm": vals.get("afm", ""), "name": vals.get("onomasia", ""), "trade_name": vals.get("commer_title", ""),
        "address": street, "postal_code": vals.get("postal_zip_code", ""), "city": vals.get("postal_area_description", ""),
        "doy": vals.get("doy_descr", ""), "legal_form": vals.get("legal_status_descr", ""),
        "active": vals.get("deactivation_flag", "1") == "1", "status_text": vals.get("deactivation_flag_descr", ""),
        "activities": sorted(acts, key=lambda a: not a["main"])[:10], "source": "aade",
    }


def parse_vies_address(raw: str) -> dict:
    """VIES gives one free-text line, e.g. 'ΛΕΩΦ ΚΗΦΙΣΙΑΣ 12 15125 - ΜΑΡΟΥΣΙ'. Pull out street, postcode and city."""
    text = re.sub(r"\s+", " ", (raw or "").replace("\n", " ")).strip(" -")
    m = re.search(r"\b(\d{3} ?\d{2})\b", text)
    if not m:
        return {"address": text, "postal_code": "", "city": ""}
    street = text[:m.start()].strip(" ,-")
    city = text[m.end():].strip(" ,-")
    return {"address": street, "postal_code": m.group(1).replace(" ", ""), "city": city}


async def _from_aade(afm: str, caller: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(AADE_URL, content=_envelope(afm, caller).encode(), headers={"Content-Type": "application/soap+xml; charset=utf-8"})
    return parse_aade(r.text)


async def _from_vies(afm: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(VIES_URL.format(afm=afm))
    if r.status_code != 200:
        raise ValueError("The EU VAT registry is unavailable right now")
    data = r.json()
    if not data.get("isValid"):
        raise ValueError("This ΑΦΜ isn't registered for VAT, so its details aren't public — enter them by hand")
    name = (data.get("name") or "").strip()
    if not name or name == "---":
        raise ValueError("The registry didn't return a name for this ΑΦΜ — enter it by hand")
    return {"afm": afm, "name": name, "trade_name": "", **parse_vies_address(data.get("address") or ""),
            "doy": "", "legal_form": "", "active": True, "status_text": "", "activities": [], "source": "vies"}


async def lookup_afm(afm: str, caller: str = "") -> dict:
    afm = gt.normalize_afm(afm)
    if not gt.is_valid_afm(afm):
        raise HTTPException(status_code=400, detail="That ΑΦΜ fails the checksum — please double-check it")
    d = get_db()
    cutoff = (datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)).isoformat()
    cached = await d.afm_cache.find_one({"afm": afm, "fetched_at": {"$gt": cutoff}}, {"_id": 0})
    if cached:
        return cached["data"]
    errors = []
    sources = ([lambda: _from_aade(afm, caller)] if config.AADE_REGISTRY_USER and config.AADE_REGISTRY_PASS else []) + [lambda: _from_vies(afm)]
    for fetch in sources:
        try:
            data = await fetch()
            await d.afm_cache.update_one({"afm": afm}, {"$set": {"afm": afm, "data": data, "fetched_at": now()}}, upsert=True)
            return data
        except ValueError as e:
            errors.append(str(e))
        except (httpx.HTTPError, ET.ParseError) as e:
            log.warning("ΑΦΜ lookup failed: %s", e)
            errors.append("The registry couldn't be reached — try again or enter the details by hand")
    raise HTTPException(status_code=404, detail=errors[0] if errors else "No details found for this ΑΦΜ")


@router.get("/lookup/afm/{afm}")
async def afm_lookup(afm: str, request: Request, ctx: Ctx = Depends(get_ctx)):
    rate_limit(request, f"afm:{ctx.org_id}", 300)
    biz = await get_db().business.find_one({"org_id": ctx.org_id}, {"_id": 0, "afm": 1}) or {}
    return await lookup_afm(afm, biz.get("afm", ""))
