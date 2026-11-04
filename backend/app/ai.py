"""Reading receipts and invoices with Claude.

`extract_document` sends one image or PDF and gets back strictly-typed JSON
(structured outputs), so the rest of the app never parses free text.
"""
import base64
import json
import logging
from typing import Optional

import anthropic

from app import config

log = logging.getLogger("ai")

CATEGORIES = {
    "materials": "Goods & materials",
    "fuel": "Fuel & vehicle",
    "travel": "Travel & accommodation",
    "rent": "Rent & utilities",
    "telecom": "Phone & internet",
    "software": "Software & subscriptions",
    "professional": "Accountant, legal & fees",
    "marketing": "Marketing & ads",
    "meals": "Meals & hospitality",
    "equipment": "Equipment & tools",
    "insurance": "Insurance",
    "taxes": "Taxes & social security",
    "bank": "Bank & card fees",
    "other": "Other",
}

_num = {"anyOf": [{"type": "number"}, {"type": "null"}]}
_str = {"anyOf": [{"type": "string"}, {"type": "null"}]}

SCHEMA = {
    "type": "object",
    "properties": {
        "document_kind": {"type": "string", "enum": ["receipt", "purchase_invoice", "sales_invoice", "credit_note", "other"]},
        "issuer_name": _str, "issuer_afm": _str, "issuer_address": _str,
        "recipient_name": _str, "recipient_afm": _str,
        "document_number": _str, "issue_date": _str, "currency": _str,
        "net_amount": _num, "vat_amount": _num, "total_amount": _num,
        "vat_breakdown": {"type": "array", "items": {"type": "object", "properties": {"rate": {"type": "number"}, "net": _num, "vat": _num},
                                                     "required": ["rate", "net", "vat"], "additionalProperties": False}},
        "line_items": {"type": "array", "items": {"type": "object", "properties": {
            "description": {"type": "string"}, "quantity": _num, "unit_price": _num, "amount": _num},
            "required": ["description", "quantity", "unit_price", "amount"], "additionalProperties": False}},
        "payment_method": {"type": "string", "enum": ["cash", "card", "bank_transfer", "other", "unknown"]},
        "mydata_mark": _str,
        "suggested_category": {"type": "string", "enum": list(CATEGORIES)},
        "summary": {"type": "string"},
        "notes_for_user": {"type": "string"},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]},
    },
    "required": ["document_kind", "issuer_name", "issuer_afm", "issuer_address", "recipient_name", "recipient_afm", "document_number",
                 "issue_date", "currency", "net_amount", "vat_amount", "total_amount", "vat_breakdown", "line_items", "payment_method",
                 "mydata_mark", "suggested_category", "summary", "notes_for_user", "confidence"],
    "additionalProperties": False,
}

SYSTEM = """You read photos and PDFs of receipts and invoices for a small business bookkeeping app, mostly Greek documents.

Transcribe what is printed; never guess. If a value is not visible or not legible, return null for it and say so in notes_for_user.
- Amounts: plain numbers in the document currency, using the printed totals. Greek documents use a comma as the decimal separator (12,40 = 12.40).
- Greek labels: ΚΑΘΑΡΗ ΑΞΙΑ = net amount, ΦΠΑ = VAT, ΣΥΝΟΛΟ / ΠΛΗΡΩΤΕΟ = total, Α.Φ.Μ. = tax number (9 digits), ΜΑΡΚ = myDATA MARK,
  ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ (ΑΛΠ) / ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ (ΑΠΥ) = receipt, ΤΙΜΟΛΟΓΙΟ = invoice, ΠΙΣΤΩΤΙΚΟ = credit note.
- issue_date as YYYY-MM-DD. Greek dates are day/month/year.
- issuer = the business that issued the document (top of the page); recipient = the customer, if printed.
- document_kind: "sales_invoice" only when the issuer is the app's own business (given below); a document issued by anyone else to the business is "purchase_invoice" or "receipt".
- vat_breakdown: one entry per VAT rate printed on the document.
- suggested_category: the best fit for what was bought.
- summary: under 12 words, e.g. "Diesel fuel, 42 litres".
- confidence: "low" if the image is blurry, cut off or the totals don't add up."""


class ScanError(Exception):
    """Raised with a message that is safe to show to the user."""


def _business_line(biz: dict) -> str:
    return f"The app's own business: name {biz.get('business_name') or 'unknown'}, ΑΦΜ {biz.get('afm') or 'unknown'}."


async def extract_document(data: bytes, media_type: str, biz: dict) -> dict:
    if not config.AI_SCAN_ENABLED:
        raise ScanError("Document scanning is turned off on this server.")
    block_type = "document" if media_type == "application/pdf" else "image"
    content = [
        {"type": block_type, "source": {"type": "base64", "media_type": media_type, "data": base64.standard_b64encode(data).decode()}},
        {"type": "text", "text": _business_line(biz) + "\nExtract this document."},
    ]
    try:
        client = anthropic.AsyncAnthropic(timeout=120.0, max_retries=2)
        resp = await client.beta.messages.create(
            model=config.ANTHROPIC_MODEL,
            max_tokens=16000,
            system=SYSTEM,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": SCHEMA}},
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError:
        raise ScanError("AI scanning isn't configured on the server (missing or invalid Anthropic API key).")
    except anthropic.RateLimitError:
        raise ScanError("The AI service is busy right now — please try again in a minute.")
    except anthropic.BadRequestError as e:
        log.warning("Scan rejected: %s", e)
        raise ScanError("This file couldn't be read. Try a clearer photo or a PDF.")
    except anthropic.APIConnectionError:
        raise ScanError("Couldn't reach the AI service — please try again.")
    except anthropic.APIStatusError as e:
        log.error("AI error %s", e.status_code)
        raise ScanError("The AI service had a problem — please try again shortly.")
    except Exception as e:  # missing credentials raise before any request is sent
        if "api_key" in str(e).lower() or "auth" in str(e).lower():
            raise ScanError("AI scanning isn't configured on the server (missing Anthropic API key).")
        raise
    if resp.stop_reason == "refusal":
        raise ScanError("This document couldn't be processed.")
    if resp.stop_reason == "max_tokens":
        raise ScanError("The document was too long to read in one go — try a single page.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise ScanError("The AI response was incomplete — please try again.")


def category_label(key: Optional[str]) -> str:
    return CATEGORIES.get(key or "", key or "Other")
