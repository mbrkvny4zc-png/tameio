"""Greek tax helpers: AFM/IBAN validation and AADE myDATA invoice XML.

Pure functions only (no DB, no network) so they can be unit-tested in isolation.

References: AADE myDATA REST API technical documentation (InvoicesDoc v1.0.x).
Codes below cover the common micro-business cases (sales/service invoices and
retail receipts). Anything outside that set is rejected by `validate_for_mydata`
rather than guessed.
"""
from __future__ import annotations

import re
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional
from xml.etree import ElementTree as ET

# ---------------------------------------------------------------- validation

def normalize_afm(value: str) -> str:
    v = re.sub(r"[\s.-]", "", (value or "").upper())
    if v.startswith("EL") or v.startswith("GR"):
        v = v[2:]
    return v


def is_valid_afm(value: str) -> bool:
    """Greek tax number (ΑΦΜ) checksum: 9 digits, mod-11 weighted by powers of 2."""
    afm = normalize_afm(value)
    if not re.fullmatch(r"\d{9}", afm) or afm == "000000000":
        return False
    total = sum(int(afm[i]) * (2 ** (8 - i)) for i in range(8))
    return (total % 11) % 10 == int(afm[8])


def normalize_iban(value: str) -> str:
    return re.sub(r"\s", "", (value or "").upper())


def is_valid_iban(value: str) -> bool:
    iban = normalize_iban(value)
    if not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{10,30}", iban):
        return False
    if iban.startswith("GR") and len(iban) != 27:
        return False
    rearranged = iban[4:] + iban[:4]
    digits = "".join(str(int(c, 36)) for c in rearranged)
    return int(digits) % 97 == 1


# ---------------------------------------------------------------- myDATA codes

INVOICE_TYPES = {
    "1.1": "Sales invoice (Τιμολόγιο Πώλησης)",
    "1.2": "Sales invoice — intra-EU supplies",
    "1.3": "Sales invoice — third-country supplies",
    "2.1": "Service invoice (Τιμολόγιο Παροχής Υπηρεσιών)",
    "2.2": "Service invoice — intra-EU",
    "2.3": "Service invoice — third country",
    "11.1": "Retail sales receipt (ΑΛΠ)",
    "11.2": "Service receipt (ΑΠΥ)",
    "5.1": "Credit note — associated (Πιστωτικό Τιμολόγιο Συσχετιζόμενο)",
}
CREDIT_TYPES = {"5.1"}
RETAIL_TYPES = {"11.1", "11.2"}
FOREIGN_TYPES = {"1.2", "1.3", "2.2", "2.3"}

# Withholding tax — myDATA table 8.4 (withheldPercentCategory). Only the percentage-based codes are offered;
# verify against the current AADE appendix before going live.
WITHHOLDING = {
    1: ("Interest (Τόκοι)", 15),
    2: ("Royalties (Δικαιώματα)", 20),
    3: ("Professional / management fees (Αμοιβές συμβουλών διοίκησης)", 20),
    4: ("Technical works (Τεχνικά έργα)", 3),
    5: ("Fuel & tobacco products (Υγρά καύσιμα & καπνικά)", 1),
    6: ("Other goods (Λοιπά αγαθά)", 4),
    7: ("Services (Παροχή υπηρεσιών)", 8),
    8: ("Architects & engineers — studies (Μελέτες & σχέδια)", 4),
    9: ("Architects & engineers — other works (Λοιπά έργα)", 10),
    10: ("Lawyers' fees (Αμοιβές δικηγόρων)", 15),
}
# Stamp duty — myDATA table 8.6 (stampDutyPercentCategory)
STAMP_DUTY = {1: ("Stamp duty 1.2% (Χαρτόσημο 1,2%)", 1.2), 2: ("Stamp duty 2.4% (Χαρτόσημο 2,4%)", 2.4), 3: ("Stamp duty 3.6% (Χαρτόσημο 3,6%)", 3.6)}

# VAT rate (%) -> myDATA vatCategory
VAT_CATEGORIES = {24: 1, 13: 2, 6: 3, 17: 4, 9: 5, 4: 6, 0: 7}

PAYMENT_METHODS = {
    1: "Domestic bank account",
    2: "Foreign bank account",
    3: "Cash",
    4: "Cheque",
    5: "On credit",
    6: "Web banking",
    7: "POS / e-POS",
}

# invoice type -> (income classificationCategory, classificationType)
DEFAULT_CLASSIFICATION = {
    "1.1": ("category1_1", "E3_561_001"),
    "1.2": ("category1_1", "E3_561_005"),
    "1.3": ("category1_1", "E3_561_006"),
    "2.1": ("category1_3", "E3_561_001"),
    "2.2": ("category1_3", "E3_561_005"),
    "2.3": ("category1_3", "E3_561_006"),
    "11.1": ("category1_1", "E3_561_003"),
    "11.2": ("category1_3", "E3_561_003"),
    "5.1": ("category1_3", "E3_561_001"),  # normally copied from the credited invoice
}

EU_COUNTRIES = {
    "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "HR", "HU", "IE",
    "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK", "GR",
}

NS_INV = "http://www.aade.gr/myDATA/invoice/v1.0"
NS_ICLS = "https://www.aade.gr/myDATA/incomeClassificaton/v1.0"  # (sic) AADE spelling

ENDPOINTS = {
    "sandbox": "https://mydataapidev.aade.gr",
    "production": "https://mydatapi.aade.gr/myDATA",
}


def _d(v) -> Decimal:
    return Decimal(str(v or 0))


def _r(v: Decimal) -> Decimal:
    return v.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _s(v: Decimal) -> str:
    return f"{_r(v):.2f}"


def compute_lines(invoice: dict) -> list[dict]:
    """Per-line net/VAT/withholding/stamp amounts as myDATA expects them (rounded per line)."""
    rate = int(round(float(invoice.get("tax_rate") or 0)))
    wcat = int(invoice.get("withholding_category") or 0)
    scat = int(invoice.get("stamp_category") or 0)
    wpct = _d(WITHHOLDING[wcat][1]) if wcat in WITHHOLDING else Decimal(0)
    spct = _d(STAMP_DUTY[scat][1]) if scat in STAMP_DUTY else Decimal(0)
    lines = []
    for idx, item in enumerate(invoice.get("items") or [], start=1):
        net = _r(_d(item.get("qty")) * _d(item.get("unit_price")))
        vat = _r(net * Decimal(rate) / Decimal(100))
        lines.append({"line_number": idx, "description": item.get("description", ""), "qty": _d(item.get("qty")),
                      "net": net, "vat": vat, "vat_rate": rate,
                      "withheld": _r(net * wpct / Decimal(100)), "withheld_cat": wcat if wpct else 0,
                      "stamp": _r(net * spct / Decimal(100)), "stamp_cat": scat if spct else 0})
    return lines


def document_totals(items: list, tax_rate, withholding_category=0, stamp_category=0) -> dict:
    """Net, VAT, withholding, stamp duty and the amount the client actually pays — summed per line like myDATA."""
    lines = compute_lines({"items": items, "tax_rate": tax_rate, "withholding_category": withholding_category, "stamp_category": stamp_category})
    net = sum((l["net"] for l in lines), Decimal(0))
    vat = sum((l["vat"] for l in lines), Decimal(0))
    wh = sum((l["withheld"] for l in lines), Decimal(0))
    st = sum((l["stamp"] for l in lines), Decimal(0))
    return {"net": float(net), "vat": float(vat), "withheld": float(wh), "stamp_duty": float(st),
            "gross": float(net + vat), "payable": float(net + vat + st - wh)}


def validate_for_mydata(invoice: dict, issuer: dict, md: dict) -> list[str]:
    """Return a list of human-readable problems. Empty list == ready to transmit."""
    errors: list[str] = []
    itype = md.get("invoice_type") or ""
    if itype not in INVOICE_TYPES:
        errors.append("Choose a supported myDATA document type.")
    if not is_valid_afm(issuer.get("vat_number", "")):
        errors.append("Your business ΑΦΜ (in e-Invoicing settings) is missing or fails the checksum.")
    if (invoice.get("currency") or "EUR") != "EUR":
        errors.append("myDATA invoices from this app must be in EUR.")
    lines = compute_lines(invoice)
    if not lines:
        errors.append("Add at least one line item.")
    if any(l["net"] <= 0 for l in lines):
        errors.append("Every line needs a positive amount (use a credit note for refunds).")
    rate = int(round(float(invoice.get("tax_rate") or 0)))
    if rate not in VAT_CATEGORIES:
        errors.append(f"VAT rate {invoice.get('tax_rate')}% is not a Greek VAT rate (24, 13, 6, 17, 9, 4 or 0).")
    if rate == 0 and not md.get("vat_exemption_category"):
        errors.append("0% VAT needs a VAT exemption category (ΑΑΔΕ table code).")
    if int(md.get("payment_method") or 0) not in PAYMENT_METHODS:
        errors.append("Choose a payment method.")
    if itype in RETAIL_TYPES and (invoice.get("withholding_category") or invoice.get("stamp_category")):
        errors.append("Retail receipts can't carry withholding tax or stamp duty.")
    dn = invoice.get("delivery")
    if dn:
        if itype not in {"1.1", "1.2", "1.3"}:
            errors.append("Only sales invoices (1.x) can double as a delivery note.")
        if int(dn.get("move_purpose") or 0) not in MOVE_PURPOSES:
            errors.append("Choose why the goods are moving.")
        if not _addr_ok(dn.get("loading_address")) or not _addr_ok(dn.get("delivery_address")):
            errors.append("Delivery note part: loading and delivery addresses need street, postcode and city.")
        if not dn.get("dispatch_date"):
            errors.append("Delivery note part: set the dispatch date.")

    if itype in CREDIT_TYPES and not re.fullmatch(r"\d{6,20}", str(md.get("correlated_mark") or "")):
        errors.append("A credit note must reference the MARK of the invoice it corrects.")

    if itype and itype not in RETAIL_TYPES:
        country = (md.get("counterpart_country") or "GR").upper()
        cvat = md.get("counterpart_vat") or ""
        if itype in CREDIT_TYPES and country != "GR":
            if not cvat.strip():
                errors.append("Customer VAT number is required.")
            if not (md.get("counterpart_name") or "").strip() or not (md.get("counterpart_city") or "").strip():
                errors.append("Customer name and city are required for foreign customers.")
        elif itype in FOREIGN_TYPES:
            if country == "GR":
                errors.append("Intra-EU / third-country documents need a non-Greek customer country.")
            elif itype in {"1.2", "2.2"} and country not in EU_COUNTRIES:
                errors.append("Intra-EU document types need an EU customer country.")
            elif itype in {"1.3", "2.3"} and country in EU_COUNTRIES:
                errors.append("Third-country document types need a non-EU customer country.")
            if not cvat.strip():
                errors.append("Customer VAT number is required.")
            if not (md.get("counterpart_name") or "").strip():
                errors.append("Customer name is required for foreign customers.")
            if not (md.get("counterpart_city") or "").strip():
                errors.append("Customer city is required for foreign customers.")
        else:
            if country != "GR":
                errors.append(f"Type {itype} is for Greek customers — use the intra-EU/third-country type instead.")
            if not is_valid_afm(cvat):
                errors.append("Customer ΑΦΜ is missing or fails the checksum.")
            elif normalize_afm(cvat) == normalize_afm(issuer.get("vat_number", "")):
                errors.append("Customer ΑΦΜ cannot be the same as yours.")
    return errors


def _sub(parent, tag, text=None, ns=NS_INV):
    el = ET.SubElement(parent, f"{{{ns}}}{tag}")
    if text is not None:
        el.text = str(text)
    return el


def build_invoices_doc(invoice: dict, issuer: dict, md: dict, series: str, aa: str) -> str:
    """Build the InvoicesDoc XML payload for SendInvoices (one invoice)."""
    ET.register_namespace("", NS_INV)
    ET.register_namespace("icls", NS_ICLS)
    itype = md["invoice_type"]
    lines = compute_lines(invoice)
    rate = lines[0]["vat_rate"] if lines else 0
    vat_cat = VAT_CATEGORIES[rate]
    cls_cat, cls_type = DEFAULT_CLASSIFICATION[itype]
    cls_cat = md.get("classification_category") or cls_cat
    cls_type = md.get("classification_type") or cls_type

    root = ET.Element(f"{{{NS_INV}}}InvoicesDoc")
    inv = _sub(root, "invoice")

    iss = _sub(inv, "issuer")
    _sub(iss, "vatNumber", normalize_afm(issuer["vat_number"]))
    _sub(iss, "country", "GR")
    _sub(iss, "branch", int(issuer.get("branch") or 0))

    if itype not in RETAIL_TYPES:
        country = (md.get("counterpart_country") or "GR").upper()
        cp = _sub(inv, "counterpart")
        cvat = normalize_afm(md["counterpart_vat"]) if country == "GR" else re.sub(r"\s", "", md["counterpart_vat"]).upper()
        _sub(cp, "vatNumber", cvat)
        _sub(cp, "country", country)
        _sub(cp, "branch", int(md.get("counterpart_branch") or 0))
        if country != "GR":  # AADE forbids name for Greek counterparts; requires it abroad
            _sub(cp, "name", md.get("counterpart_name", "").strip())
            addr = _sub(cp, "address")
            if md.get("counterpart_street"):
                _sub(addr, "street", md["counterpart_street"].strip())
            _sub(addr, "postalCode", (md.get("counterpart_postal_code") or "00000").strip())
            _sub(addr, "city", md["counterpart_city"].strip())

    hdr = _sub(inv, "invoiceHeader")
    _sub(hdr, "series", series)
    _sub(hdr, "aa", aa)
    _sub(hdr, "issueDate", invoice.get("issue_date") or "")
    _sub(hdr, "invoiceType", itype)
    _sub(hdr, "currency", "EUR")
    if itype in CREDIT_TYPES:
        _sub(hdr, "correlatedInvoices", str(md["correlated_mark"]))
    dn = invoice.get("delivery")
    if dn:  # sales invoice that is also the delivery note (Τιμολόγιο - Δελτίο Αποστολής)
        _sub(hdr, "dispatchDate", dn["dispatch_date"])
        if dn.get("dispatch_time"):
            _sub(hdr, "dispatchTime", (dn["dispatch_time"] + ":00")[:8])
        if (dn.get("vehicle_number") or "").strip():
            _sub(hdr, "vehicleNumber", dn["vehicle_number"].strip().upper()[:50])
        _sub(hdr, "movePurpose", int(dn["move_purpose"]))
        other = _sub(hdr, "otherDeliveryNoteHeader")
        _address(other, "loadingAddress", dn["loading_address"])
        _address(other, "deliveryAddress", dn["delivery_address"])
        _sub(other, "startShippingBranch", int(dn.get("start_branch") or 0))
        _sub(other, "completeShippingBranch", int(dn.get("complete_branch") or 0))
        _sub(hdr, "isDeliveryNote", "true")

    total_net = sum((l["net"] for l in lines), Decimal(0))
    total_vat = sum((l["vat"] for l in lines), Decimal(0))
    total_wh = sum((l["withheld"] for l in lines), Decimal(0))
    total_stamp = sum((l["stamp"] for l in lines), Decimal(0))
    gross = total_net + total_vat - total_wh + total_stamp

    pms = _sub(inv, "paymentMethods")
    pmd = _sub(pms, "paymentMethodDetails")
    _sub(pmd, "type", int(md["payment_method"]))
    _sub(pmd, "amount", _s(gross))
    if md.get("transaction_id"):  # card terminal (e-POS) payment
        _sub(pmd, "transactionId", str(md["transaction_id"])[:100])
        if md.get("terminal_id"):
            _sub(pmd, "tid", str(md["terminal_id"])[:100])

    for l in lines:
        det = _sub(inv, "invoiceDetails")
        _sub(det, "lineNumber", l["line_number"])
        _sub(det, "netValue", _s(l["net"]))
        _sub(det, "vatCategory", vat_cat)
        _sub(det, "vatAmount", _s(l["vat"]))
        if vat_cat == 7:
            _sub(det, "vatExemptionCategory", int(md["vat_exemption_category"]))
        if l["withheld_cat"]:
            _sub(det, "withheldAmount", _s(l["withheld"]))
            _sub(det, "withheldPercentCategory", l["withheld_cat"])
        if l["stamp_cat"]:
            _sub(det, "stampDutyAmount", _s(l["stamp"]))
            _sub(det, "stampDutyPercentCategory", l["stamp_cat"])
        ic = _sub(det, "incomeClassification")
        _sub(ic, "classificationType", cls_type, NS_ICLS)
        _sub(ic, "classificationCategory", cls_cat, NS_ICLS)
        _sub(ic, "amount", _s(l["net"]), NS_ICLS)

    summ = _sub(inv, "invoiceSummary")
    _sub(summ, "totalNetValue", _s(total_net))
    _sub(summ, "totalVatAmount", _s(total_vat))
    _sub(summ, "totalWithheldAmount", _s(total_wh))
    _sub(summ, "totalFeesAmount", "0.00")
    _sub(summ, "totalStampDutyAmount", _s(total_stamp))
    _sub(summ, "totalOtherTaxesAmount", "0.00")
    _sub(summ, "totalDeductionsAmount", "0.00")
    _sub(summ, "totalGrossValue", _s(gross))
    ic = _sub(summ, "incomeClassification")
    _sub(ic, "classificationType", cls_type, NS_ICLS)
    _sub(ic, "classificationCategory", cls_cat, NS_ICLS)
    _sub(ic, "amount", _s(total_net), NS_ICLS)

    return '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_response(xml_text: str) -> dict:
    """Parse an AADE ResponseDoc (namespace-agnostic). Returns the first response."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return {"ok": False, "status": "ParseError", "errors": [{"code": "", "message": "AADE returned an unreadable response"}]}
    resp = next((e for e in root.iter() if _local(e.tag) == "response"), None)
    if resp is None:
        return {"ok": False, "status": "NoResponse", "errors": [{"code": "", "message": "AADE response contained no result"}]}
    out = {"errors": []}
    for child in resp:
        name = _local(child.tag)
        if name == "statusCode":
            out["status"] = (child.text or "").strip()
        elif name == "invoiceMark":
            out["mark"] = (child.text or "").strip()
        elif name == "invoiceUid":
            out["uid"] = (child.text or "").strip()
        elif name == "qrUrl":
            out["qr_url"] = (child.text or "").strip()
        elif name == "cancellationMark":
            out["cancellation_mark"] = (child.text or "").strip()
        elif name == "classificationMark":
            out["classification_mark"] = (child.text or "").strip()
        elif name == "errors":
            for err in child:
                e = {_local(x.tag): (x.text or "").strip() for x in err}
                out["errors"].append({"code": e.get("code", ""), "message": e.get("message", "")})
    out["ok"] = out.get("status") == "Success"
    return out


# ---------------------------------------------------------------- received documents & expense classification

NS_ECLS = "https://www.aade.gr/myDATA/expensesClassificaton/v1.0"  # (sic) AADE spelling

# myDATA expense classification categories (classificationCategory)
EXPENSE_CATEGORIES = {
    "category2_1": "Αγορές εμπορευμάτων (goods for resale)",
    "category2_2": "Αγορές πρώτων υλών / υλικών (raw materials)",
    "category2_3": "Λήψη υπηρεσιών (services received)",
    "category2_4": "Γενικά έξοδα με δικαίωμα έκπτωσης ΦΠΑ (general, VAT deductible)",
    "category2_5": "Γενικά έξοδα χωρίς δικαίωμα έκπτωσης ΦΠΑ (general, no VAT deduction)",
    "category2_6": "Αμοιβές και παροχές προσωπικού (staff costs)",
    "category2_7": "Αγορές παγίων (fixed assets)",
}


def _txt(el, name):
    for c in el.iter():
        if _local(c.tag) == name:
            return (c.text or "").strip()
    return ""


def _num_or_zero(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def parse_requested_docs(xml_text: str) -> dict:
    """Parse a RequestDocs response: the invoices other businesses issued to you, plus the paging token."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        raise ValueError("AADE returned an unreadable response")
    docs = []
    for inv in (e for e in root.iter() if _local(e.tag) == "invoice"):
        issuer = next((c for c in inv if _local(c.tag) == "issuer"), None)
        header = next((c for c in inv if _local(c.tag) == "invoiceHeader"), None)
        summary = next((c for c in inv if _local(c.tag) == "invoiceSummary"), None)
        lines = []
        for det in (c for c in inv if _local(c.tag) == "invoiceDetails"):
            lines.append({"line_number": int(_num_or_zero(_txt(det, "lineNumber")) or len(lines) + 1),
                          "net": _num_or_zero(_txt(det, "netValue")), "vat": _num_or_zero(_txt(det, "vatAmount")),
                          "vat_category": _txt(det, "vatCategory"), "description": _txt(det, "itemDescr")})
        mark = next(((c.text or "").strip() for c in inv if _local(c.tag) == "mark"), "")
        cancelled = next(((c.text or "").strip() for c in inv if _local(c.tag) == "cancelledByMark"), "")
        docs.append({
            "mark": mark, "uid": next(((c.text or "").strip() for c in inv if _local(c.tag) == "uid"), ""),
            "issuer_afm": _txt(issuer, "vatNumber") if issuer is not None else "", "issuer_name": _txt(issuer, "name") if issuer is not None else "",
            "series": _txt(header, "series") if header is not None else "", "aa": _txt(header, "aa") if header is not None else "",
            "issue_date": _txt(header, "issueDate") if header is not None else "", "invoice_type": _txt(header, "invoiceType") if header is not None else "",
            "currency": (_txt(header, "currency") if header is not None else "") or "EUR",
            "net": _num_or_zero(_txt(summary, "totalNetValue")) if summary is not None else sum(l["net"] for l in lines),
            "vat": _num_or_zero(_txt(summary, "totalVatAmount")) if summary is not None else sum(l["vat"] for l in lines),
            "gross": _num_or_zero(_txt(summary, "totalGrossValue")) if summary is not None else 0.0,
            "lines": lines, "cancelled_by_mark": cancelled,
        })
    token = next((e for e in root.iter() if _local(e.tag) == "continuationToken"), None)
    nxt = None
    if token is not None:
        pk, rk = _txt(token, "nextPartitionKey"), _txt(token, "nextRowKey")
        if pk and rk:
            nxt = {"nextPartitionKey": pk, "nextRowKey": rk}
    return {"docs": docs, "continuation": nxt}


def build_expenses_classification(items: list) -> str:
    """items: [{mark, lines: [{line_number, net}], category, e3_type}] -> ExpensesClassificationsDoc (per-line mode)."""
    ET.register_namespace("", NS_ECLS)
    root = ET.Element(f"{{{NS_ECLS}}}ExpensesClassificationsDoc")
    for it in items:
        ic = ET.SubElement(root, f"{{{NS_ECLS}}}expensesInvoiceClassification")
        ET.SubElement(ic, f"{{{NS_ECLS}}}invoiceMark").text = str(it["mark"])
        for line in it["lines"]:
            det = ET.SubElement(ic, f"{{{NS_ECLS}}}invoicesExpensesClassificationDetails")
            ET.SubElement(det, f"{{{NS_ECLS}}}lineNumber").text = str(line["line_number"])
            data = ET.SubElement(det, f"{{{NS_ECLS}}}expensesClassificationDetailData")
            ET.SubElement(data, f"{{{NS_ECLS}}}classificationType").text = it["e3_type"]
            ET.SubElement(data, f"{{{NS_ECLS}}}classificationCategory").text = it["category"]
            ET.SubElement(data, f"{{{NS_ECLS}}}amount").text = _s(_d(line["net"]))
    return '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")


def parse_responses(xml_text: str) -> list:
    """All <response> entries of a ResponseDoc (batch sends), each like parse_response()."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return [{"ok": False, "status": "ParseError", "errors": [{"code": "", "message": "AADE returned an unreadable response"}]}]
    out = []
    for resp in (e for e in root.iter() if _local(e.tag) == "response"):
        wrapper = ET.Element("ResponseDoc")
        wrapper.append(resp)
        out.append(parse_response(ET.tostring(wrapper, encoding="unicode")))
    return out


# ---------------------------------------------------------------- digital delivery notes (myDATA 9.3)

# movePurpose codes (AADE table 8.21 "Σκοπός Διακίνησης")
MOVE_PURPOSES = {
    1: "Sale (Πώληση)",
    2: "Sale on behalf of third parties (Πώληση για λογαριασμό τρίτων)",
    3: "Sampling (Δειγματισμός)",
    4: "Exhibition (Έκθεση)",
    5: "Return (Επιστροφή)",
    6: "Storage (Φύλαξη)",
    7: "Processing / assembly (Επεξεργασία / Συναρμολόγηση)",
    8: "Between own premises (Μεταξύ εγκαταστάσεων οντότητας)",
    9: "Purchase (Αγορά)",
    10: "Supply of ships and aircraft (Εφοδιασμός πλοίων και αεροσκαφών)",
    11: "Free disposal (Δωρεάν διάθεση)",
    12: "Warranty (Εγγύηση)",
    13: "Loan (Χρησιδανεισμός)",
    14: "Storage with third parties (Αποθήκευση σε τρίτους)",
    15: "Return from storage (Επιστροφή από φύλαξη)",
    16: "Recycling (Ανακύκλωση)",
    17: "Destruction of unusable material (Καταστροφή άχρηστου υλικού)",
    18: "Intra-community transfer of fixed assets (Διακίνηση παγίων - ενδοδιακίνηση)",
    19: "Other (Λοιπές διακινήσεις)",
}
# measurementUnit codes
UNITS = {1: "pcs", 2: "kg", 3: "lt", 4: "m", 5: "m²", 6: "m³", 7: "other"}
OWN_PREMISES = 8


def _addr_ok(a: dict) -> bool:
    return bool((a or {}).get("street", "").strip() and (a or {}).get("city", "").strip() and (a or {}).get("postal_code", "").strip())


def validate_delivery_note(note: dict, issuer: dict) -> list[str]:
    errors: list[str] = []
    if not is_valid_afm(issuer.get("vat_number", "")):
        errors.append("Your business ΑΦΜ (in e-Invoicing settings) is missing or fails the checksum.")
    purpose = int(note.get("move_purpose") or 0)
    if purpose not in MOVE_PURPOSES:
        errors.append("Choose why the goods are moving.")
    if purpose == 19 and not (note.get("other_purpose") or "").strip():
        errors.append("Describe the movement purpose.")
    if purpose != OWN_PREMISES:
        if not is_valid_afm(note.get("recipient_afm", "")):
            errors.append("Recipient ΑΦΜ is missing or fails the checksum.")
        elif normalize_afm(note["recipient_afm"]) == normalize_afm(issuer.get("vat_number", "")):
            errors.append("For moves between your own premises choose that purpose instead of entering your own ΑΦΜ.")
    if not _addr_ok(note.get("loading_address")):
        errors.append("Loading address needs street, postcode and city.")
    if not _addr_ok(note.get("delivery_address")):
        errors.append("Delivery address needs street, postcode and city.")
    if not note.get("dispatch_date"):
        errors.append("Set the dispatch date.")
    lines = note.get("items") or []
    if not lines:
        errors.append("Add at least one item being moved.")
    if any(float(l.get("qty") or 0) <= 0 for l in lines):
        errors.append("Every item needs a quantity above zero.")
    return errors


def _address(parent, tag, a: dict):
    el = _sub(parent, tag)
    _sub(el, "street", a.get("street", "").strip()[:150])
    if (a.get("number") or "").strip():
        _sub(el, "number", a["number"].strip()[:20])
    _sub(el, "postalCode", a.get("postal_code", "").strip()[:10])
    _sub(el, "city", a.get("city", "").strip()[:100])


def build_delivery_note_doc(note: dict, issuer: dict, series: str, aa: str) -> str:
    """InvoicesDoc for a stand-alone delivery note (type 9.3): quantities and addresses, no values."""
    ET.register_namespace("", NS_INV)
    root = ET.Element(f"{{{NS_INV}}}InvoicesDoc")
    inv = _sub(root, "invoice")
    iss = _sub(inv, "issuer")
    _sub(iss, "vatNumber", normalize_afm(issuer["vat_number"]))
    _sub(iss, "country", "GR")
    _sub(iss, "branch", int(issuer.get("branch") or 0))
    purpose = int(note["move_purpose"])
    if purpose != OWN_PREMISES:
        cp = _sub(inv, "counterpart")
        _sub(cp, "vatNumber", normalize_afm(note["recipient_afm"]))
        _sub(cp, "country", "GR")
        _sub(cp, "branch", int(note.get("recipient_branch") or 0))

    hdr = _sub(inv, "invoiceHeader")
    _sub(hdr, "series", series)
    _sub(hdr, "aa", aa)
    _sub(hdr, "issueDate", note.get("issue_date") or note["dispatch_date"])
    _sub(hdr, "invoiceType", "9.3")
    _sub(hdr, "dispatchDate", note["dispatch_date"])
    if note.get("dispatch_time"):
        _sub(hdr, "dispatchTime", (note["dispatch_time"] + ":00")[:8])
    if (note.get("vehicle_number") or "").strip():
        _sub(hdr, "vehicleNumber", note["vehicle_number"].strip().upper()[:50])
    _sub(hdr, "movePurpose", purpose)
    other = _sub(hdr, "otherDeliveryNoteHeader")
    _address(other, "loadingAddress", note["loading_address"])
    _address(other, "deliveryAddress", note["delivery_address"])
    _sub(other, "startShippingBranch", int(note.get("start_branch") or 0))
    _sub(other, "completeShippingBranch", int(note.get("complete_branch") or 0))
    _sub(hdr, "isDeliveryNote", "true")
    if purpose == 19:
        _sub(hdr, "otherMovePurposeTitle", note["other_purpose"].strip()[:150])

    for idx, item in enumerate(note["items"], start=1):
        det = _sub(inv, "invoiceDetails")
        _sub(det, "lineNumber", idx)
        _sub(det, "quantity", f"{float(item['qty']):.2f}")
        _sub(det, "measurementUnit", int(item.get("unit") or 1))
        if (item.get("code") or "").strip():
            _sub(det, "itemCode", item["code"].strip()[:50])
        _sub(det, "itemDescr", item["description"].strip()[:300])
        _sub(det, "netValue", "0.00")
        _sub(det, "vatCategory", 8)  # records without VAT
        _sub(det, "vatAmount", "0.00")

    summ = _sub(inv, "invoiceSummary")
    for tag in ("totalNetValue", "totalVatAmount", "totalWithheldAmount", "totalFeesAmount", "totalStampDutyAmount",
                "totalOtherTaxesAmount", "totalDeductionsAmount", "totalGrossValue"):
        _sub(summ, tag, "0.00")
    return '<?xml version="1.0" encoding="UTF-8"?>' + ET.tostring(root, encoding="unicode")
