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


SUGGEST_SCHEMA = {
    "type": "object",
    "properties": {"suggestions": {"type": "array", "items": {"type": "object", "properties": {
        "id": {"type": "string"}, "category": {"type": "string", "enum": list(CATEGORIES)},
        "confidence": {"type": "string", "enum": ["low", "medium", "high"]}},
        "required": ["id", "category", "confidence"], "additionalProperties": False}}},
    "required": ["suggestions"], "additionalProperties": False,
}


async def suggest_categories(docs: list) -> dict:
    """docs: [{id, issuer, afm, lines: [str], net}] -> {id: (category, confidence)}. One request per batch of up to 40."""
    if not config.AI_SCAN_ENABLED or not docs:
        return {}
    listing = "\n".join(json.dumps(d, ensure_ascii=False) for d in docs[:40])
    prompt = ("Pick the best expense category for each purchase invoice a small Greek business received. "
              "Use the supplier name and line descriptions. Categories: " + ", ".join(f"{k} ({v})" for k, v in CATEGORIES.items())
              + ".\nUse low confidence when the supplier or lines don't make the purpose clear.\n\n" + listing)
    try:
        client = anthropic.AsyncAnthropic(timeout=90.0, max_retries=2)
        resp = await client.beta.messages.create(
            model=config.ANTHROPIC_MODEL, max_tokens=8000, messages=[{"role": "user", "content": prompt}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": SUGGEST_SCHEMA}},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    except anthropic.AuthenticationError:
        raise ScanError("AI isn't configured on the server (missing or invalid Anthropic API key).")
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("AI suggestion failed: %s", e)
        raise ScanError("The AI service is unavailable right now — try again shortly.")
    except Exception as e:
        if "api_key" in str(e).lower() or "auth" in str(e).lower():
            raise ScanError("AI isn't configured on the server (missing Anthropic API key).")
        raise
    if resp.stop_reason in ("refusal", "max_tokens"):
        return {}
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    valid = {d["id"] for d in docs}
    return {s["id"]: (s["category"], s["confidence"]) for s in data.get("suggestions", []) if s["id"] in valid}


# ------------------------------------------------------------------ "Ask your numbers"

ASK_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string"},
        "highlights": {"type": "array", "items": {"type": "object", "properties": {
            "label": {"type": "string"}, "value": {"type": "string"}}, "required": ["label", "value"], "additionalProperties": False}},
        "follow_ups": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["answer", "highlights", "follow_ups"], "additionalProperties": False,
}

ASK_SYSTEM = """You answer a Greek small-business owner's questions about their own bookkeeping data.
Rules:
- Use ONLY the JSON data provided. Never invent numbers. If the data can't answer the question, say what is missing.
- Amounts are EUR. Write money like €1.234,56 when answering in Greek and €1,234.56 in English.
- Answer in the same language as the question. Be short and plain: 1-4 sentences, no markdown headings, no tables.
- "highlights": up to 4 key figures you used (label + formatted value). "follow_ups": up to 3 short next questions they might ask.
- You are not their accountant: for tax-law questions give the figure from the data and suggest confirming with their accountant."""


async def ask_numbers(question: str, data: dict, history: list) -> dict:
    if not config.AI_SCAN_ENABLED:
        raise ScanError("AI is turned off on this server.")
    msgs = []
    for h in history[-6:]:
        if h.get("q") and h.get("a"):
            msgs += [{"role": "user", "content": h["q"][:500]}, {"role": "assistant", "content": h["a"][:2000]}]
    msgs.append({"role": "user", "content": f"<data>\n{json.dumps(data, ensure_ascii=False, default=str)}\n</data>\n\nQuestion: {question}"})
    try:
        client = anthropic.AsyncAnthropic(timeout=90.0, max_retries=2)
        resp = await client.beta.messages.create(
            model=config.ANTHROPIC_MODEL, max_tokens=4000, system=ASK_SYSTEM, messages=msgs,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": ASK_SCHEMA}},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    except anthropic.AuthenticationError:
        raise ScanError("AI isn't configured on the server (missing or invalid Anthropic API key).")
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("Ask failed: %s", e)
        raise ScanError("The AI service is unavailable right now — try again shortly.")
    except Exception as e:
        if "api_key" in str(e).lower() or "auth" in str(e).lower():
            raise ScanError("AI isn't configured on the server (missing Anthropic API key).")
        raise
    if resp.stop_reason == "refusal":
        raise ScanError("I can't help with that question.")
    if resp.stop_reason == "max_tokens":
        raise ScanError("That question needs a longer answer than I can give — try narrowing it down.")
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        raise ScanError("The AI response was incomplete — please try again.")


# ------------------------------------------------------------------ "Write the invoice for me"

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "doc_kind": {"type": "string", "enum": ["invoice", "receipt", "quote"]},
        "client_id": _str, "client_name": _str, "client_afm": _str,
        "items": {"type": "array", "items": {"type": "object", "properties": {
            "product_id": _str, "description": {"type": "string"}, "qty": {"type": "number"}, "unit_price": _num},
            "required": ["product_id", "description", "qty", "unit_price"], "additionalProperties": False}},
        "prices_include_vat": {"type": "boolean"},
        "tax_rate": {"anyOf": [{"type": "integer", "enum": [24, 13, 6, 17, 9, 4, 0]}, {"type": "null"}]},
        "due_in_days": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
        "notes": {"type": "string"},
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["doc_kind", "client_id", "client_name", "client_afm", "items", "prices_include_vat", "tax_rate", "due_in_days", "notes", "questions"],
    "additionalProperties": False,
}

DRAFT_SYSTEM = """You turn a Greek small-business owner's sentence into a draft sales document. They will review it before anything is issued.
Rules:
- Match the client to one of the listed clients (use its id) when the name, nickname or ΑΦΜ clearly fits; otherwise client_id null and put the name/ΑΦΜ as written.
- Match each line to a listed product (use its id) when it clearly fits; copy the description in the user's wording or the product name.
- unit_price: use the price the user said; else null (the app fills in saved product prices). Never invent prices.
- If the user gave a total or VAT-inclusive price ("με ΦΠΑ", "including VAT", "τελική"), set prices_include_vat true.
- doc_kind: "receipt" for a walk-in / retail sale, "quote" for an offer/προσφορά, otherwise "invoice".
- tax_rate only if the user said one, else null. due_in_days only if they said when it's due.
- notes: only text the user explicitly wants printed on the document, else "".
- questions: short questions (in the user's language) about anything essential that's missing or ambiguous; [] if none."""


async def draft_invoice(text: str, clients: list, products: list) -> dict:
    if not config.AI_SCAN_ENABLED:
        raise ScanError("AI is turned off on this server.")
    listing = json.dumps({"clients": clients, "products": products}, ensure_ascii=False)
    try:
        client = anthropic.AsyncAnthropic(timeout=60.0, max_retries=2)
        resp = await client.beta.messages.create(
            model=config.ANTHROPIC_MODEL, max_tokens=4000, system=DRAFT_SYSTEM,
            messages=[{"role": "user", "content": f"<catalog>\n{listing}\n</catalog>\n\nRequest: {text}"}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": DRAFT_SCHEMA}},
            betas=["server-side-fallback-2026-07-01"], fallbacks="default")
    except anthropic.AuthenticationError:
        raise ScanError("AI isn't configured on the server (missing or invalid Anthropic API key).")
    except (anthropic.RateLimitError, anthropic.APIConnectionError, anthropic.APIStatusError) as e:
        log.warning("Draft failed: %s", e)
        raise ScanError("The AI service is unavailable right now — try again shortly.")
    except Exception as e:
        if "api_key" in str(e).lower() or "auth" in str(e).lower():
            raise ScanError("AI isn't configured on the server (missing Anthropic API key).")
        raise
    if resp.stop_reason in ("refusal", "max_tokens"):
        raise ScanError("I couldn't turn that into an invoice — try describing the client and what you sold.")
    text_out = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        return json.loads(text_out)
    except json.JSONDecodeError:
        raise ScanError("The AI response was incomplete — please try again.")
