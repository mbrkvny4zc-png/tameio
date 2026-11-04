"""Shared building blocks: line items, totals, numbering, formatting."""
import html
from decimal import Decimal, ROUND_HALF_UP
from typing import List, Optional

from fastapi import HTTPException
from pydantic import BaseModel, field_validator
from pymongo import ReturnDocument

from app.db import get_db

CURRENCIES = ("EUR", "USD", "GBP")


class Item(BaseModel):
    description: str
    qty: float = 1
    unit_price: float = 0

    @field_validator("qty", "unit_price")
    @classmethod
    def _finite(cls, v):
        if v != v or v in (float("inf"), float("-inf")):
            raise ValueError("must be a number")
        return v


def _r(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def totals(items: List[dict], tax_rate: float):
    """Per-line rounding, matching how myDATA sums invoices."""
    net = Decimal(0)
    vat = Decimal(0)
    for i in items:
        line = _r(Decimal(str(i.get("qty") or 0)) * Decimal(str(i.get("unit_price") or 0)))
        net += line
        vat += _r(line * Decimal(str(tax_rate or 0)) / Decimal(100))
    return float(net), float(vat), float(net + vat)


def clean_items(items: List[Item]) -> List[dict]:
    out = []
    for i in items:
        if not i.description.strip():
            continue
        if i.qty < 0 or i.unit_price < 0:
            raise HTTPException(status_code=400, detail="Quantities and prices cannot be negative")
        out.append({"description": i.description.strip()[:500], "qty": i.qty, "unit_price": i.unit_price})
    return out


def valid_currency(c: Optional[str]) -> str:
    return c if c in CURRENCIES else "EUR"


async def next_number(org_id: str, key: str, prefix: str, width: int = 4) -> str:
    """Atomic, gap-free per-org counter (deleting a document never reuses its number)."""
    doc = await get_db().counters.find_one_and_update(
        {"org_id": org_id, "key": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=ReturnDocument.AFTER)
    return f"{prefix}-{doc['seq']:0{width}d}"


def money(v, cur: str = "EUR") -> str:
    sym = {"EUR": "€", "USD": "$", "GBP": "£"}.get(cur, "")
    return f"{sym}{(v or 0):,.2f}"


def esc(v) -> str:
    return html.escape(str(v or ""))
