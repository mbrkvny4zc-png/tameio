import io

import pytest

from conftest import CLIENT_AFM, OUR_AFM, VENDOR_AFM

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 200
PDF = b"%PDF-1.4 receipt"

RECEIPT = {
    "document_kind": "receipt", "issuer_name": "ΑΦΟΙ ΠΑΠΑΔΑΚΗ ΟΕ – Πρατήριο", "issuer_afm": VENDOR_AFM, "issuer_address": "Λ. Κηφισίας 10",
    "recipient_name": None, "recipient_afm": None, "document_number": "ΑΛΠ 4512", "issue_date": "2026-10-28", "currency": "EUR",
    "net_amount": 50.0, "vat_amount": 12.0, "total_amount": 62.0, "vat_breakdown": [{"rate": 24, "net": 50.0, "vat": 12.0}],
    "line_items": [{"description": "Diesel", "quantity": 36.5, "unit_price": 1.699, "amount": 62.0}],
    "payment_method": "card", "mydata_mark": "400001234567890", "suggested_category": "fuel",
    "summary": "Diesel fuel, 36.5 litres", "notes_for_user": "", "confidence": "high",
}


@pytest.fixture()
def fake_ai(monkeypatch):
    from app import ai
    calls = {"result": dict(RECEIPT), "n": 0}

    async def fake(data, media_type, biz):
        calls["n"] += 1
        calls["media_type"], calls["biz_afm"] = media_type, biz.get("afm")
        if isinstance(calls["result"], Exception):
            raise calls["result"]
        return calls["result"]
    monkeypatch.setattr(ai, "extract_document", fake)
    return calls


def _scan(c, content=JPEG, name="r.jpg", ctype="image/jpeg"):
    return c.post("/api/scans", files={"file": (name, io.BytesIO(content), ctype)})


def test_manual_expense_validation(client):
    c = client
    assert c.post("/api/expenses", json={"vendor_name": "", "net": 1}).status_code == 400
    assert c.post("/api/expenses", json={"vendor_name": "X", "net": 10, "vat": 2.4, "total": 20}).status_code == 400
    assert c.post("/api/expenses", json={"vendor_name": "X", "net": -1}).status_code == 400
    e = c.post("/api/expenses", json={"vendor_name": "Cosmote", "category": "telecom", "net": 30, "vat": 7.2}).json()
    assert e["number"] == "EXP-0001" and e["total"] == 37.2 and e["vat_rate"] == 24 and e["source"] == "manual"


def test_scan_receipt_to_expense(client, fake_ai):
    c = client
    r = _scan(c)
    assert r.status_code == 200, r.text
    scan = r.json()
    assert fake_ai["media_type"] == "image/jpeg" and fake_ai["biz_afm"] == OUR_AFM
    sug = scan["suggestion"]
    assert sug["target"] == "expense" and sug["warnings"] == []
    d = sug["expense_draft"]
    assert (d["net"], d["vat"], d["total"], d["category"], d["vat_rate"]) == (50.0, 12.0, 62.0, "fuel", 24)
    assert d["date"] == "2026-10-28" and d["payment_status"] == "paid" and d["mark"] == "400001234567890"
    exp = c.post("/api/expenses", json={**d, "scan_id": scan["id"]}).json()
    assert exp["source"] == "scan" and exp["file"]["content_type"] == "image/jpeg"
    f = c.get(f"/api/expenses/{exp['id']}/file")
    assert f.status_code == 200 and f.content == JPEG and f.headers["x-content-type-options"] == "nosniff"
    # Second upload of the same receipt is flagged as a duplicate
    again = _scan(c).json()["suggestion"]
    assert again["duplicate"]["number"] == exp["number"] and "duplicate" in again["warnings"][0]


def test_scan_matches_known_supplier_and_checks_math(client, fake_ai):
    c = client
    s = c.post("/api/suppliers", json={"name": "Papadakis Fuel", "afm": VENDOR_AFM}).json()
    fake_ai["result"] = {**RECEIPT, "total_amount": 70.0, "issue_date": "2099-01-01", "confidence": "low",
                         "vat_breakdown": [{"rate": 24, "net": 40, "vat": 9.6}, {"rate": 13, "net": 10, "vat": 1.3}]}
    sug = _scan(c, PDF, "r.pdf", "application/pdf").json()["suggestion"]
    assert fake_ai["media_type"] == "application/pdf"
    w = " | ".join(sug["warnings"])
    assert "don't add up" in w and "future" in w and "hard to read" in w and "Several VAT rates" in w
    assert sug["expense_draft"]["supplier_id"] == s["id"] and sug["expense_draft"]["vendor_name"] == "Papadakis Fuel"


def test_scan_fills_missing_amounts(client, fake_ai):
    fake_ai["result"] = {**RECEIPT, "net_amount": None, "vat_amount": 12.0, "issue_date": None, "mydata_mark": None, "document_number": None}
    sug = _scan(client).json()["suggestion"]
    assert sug["expense_draft"]["net"] == 50.0 and any("date couldn't be read" in w for w in sug["warnings"])


def test_scan_own_sales_invoice_becomes_invoice_draft(client, fake_ai):
    c = client
    cl = c.post("/api/clients", json={"name": "Kafeneio Plaka", "afm": CLIENT_AFM}).json()
    fake_ai["result"] = {**RECEIPT, "document_kind": "purchase_invoice", "issuer_afm": OUR_AFM, "recipient_afm": CLIENT_AFM,
                         "recipient_name": "Kafeneio", "line_items": [{"description": "Panel upgrade", "quantity": 1, "unit_price": 50, "amount": 50}]}
    sug = _scan(c).json()
    d = sug["suggestion"]["invoice_draft"]
    assert sug["suggestion"]["target"] == "invoice" and d["client_id"] == cl["id"] and d["tax_rate"] == 24 and d["items"][0]["unit_price"] == 50
    inv = c.post("/api/invoices", json={**d, "client_id": cl["id"]}).json()
    assert c.post(f"/api/scans/{sug['id']}/link-invoice/{inv['id']}").status_code == 200


def test_scan_rejects_bad_files_and_reports_ai_errors(client, fake_ai):
    from app import ai
    c = client
    assert _scan(c, b"hello", "x.txt", "text/plain").status_code == 400
    assert "HEIC" in _scan(c, b"\x00\x00\x00\x18ftypheic", "IMG_1.HEIC", "image/heic").json()["detail"]
    assert _scan(c, b"", "e.jpg").status_code == 400
    assert _scan(c, b"\xff\xd8\xff" + b"0" * (5 * 1024 * 1024 + 1)).status_code == 413
    assert fake_ai["n"] == 0  # nothing sent to the AI for rejected files
    fake_ai["result"] = ai.ScanError("AI scanning isn't configured on the server (missing Anthropic API key).")
    r = _scan(c)
    assert r.status_code == 422 and "isn't configured" in r.json()["detail"]["message"]
    assert c.get("/api/scans").json()[0]["status"] == "failed"


def test_reports(client):
    c = client
    from conftest import run
    md = {"invoice_type": "2.1", "payment_method": 1, "counterpart_vat": CLIENT_AFM, "counterpart_country": "GR"}
    a = c.post("/api/invoices", json={"client_name": "Acme", "status": "paid", "issue_date": "2026-10-05", "tax_rate": 24,
                                       "items": [{"description": "Job", "qty": 1, "unit_price": 1000}]}).json()
    c.post("/api/invoices", json={"client_name": "Beta", "status": "sent", "issue_date": "2026-10-20", "tax_rate": 24,
                                  "items": [{"description": "Job", "qty": 1, "unit_price": 500}]})
    c.post("/api/invoices", json={"client_name": "Draft Co", "status": "draft", "issue_date": "2026-10-20", "items": [{"description": "x", "qty": 1, "unit_price": 999}]})
    c.post(f"/api/invoices/{a['id']}/mydata/submit", json=md)
    c.post(f"/api/invoices/{a['id']}/credit-note", json={"reason": "Discount", "items": [{"description": "Discount", "qty": 1, "unit_price": 100}]})
    run(c.db.invoices.update_many({"kind": "credit_note"}, {"$set": {"issue_date": "2026-10-25"}}))
    c.post("/api/expenses", json={"vendor_name": "=HYPERLINK(\"x\")", "date": "2026-10-10", "category": "fuel", "net": 100, "vat": 24})
    c.post("/api/expenses", json={"vendor_name": "Rent", "date": "2026-10-01", "category": "rent", "net": 300, "vat": 0, "payment_status": "unpaid"})
    c.post("/api/expenses", json={"vendor_name": "Old", "date": "2026-09-01", "net": 999, "vat": 0})
    r = c.get("/api/reports/summary?start=2026-10-01&end=2026-10-31").json()
    assert r["income"]["net"] == 1400.0 and r["income"]["vat"] == 336.0        # 1000 + 500 − 100 credit
    assert r["expenses"]["net"] == 400.0 and r["expenses"]["vat"] == 24.0 and r["expenses"]["unpaid"] == 300.0
    assert r["profit"] == 1000.0 and r["vat"]["payable"] == 312.0
    assert [x["key"] for x in r["categories"]] == ["rent", "fuel"]
    assert r["receivables"]["total"] == 620.0
    oct_ = next(m for m in r["monthly"] if m["month"] == "2026-10")
    assert (oct_["income"], oct_["expenses"]) == (1400.0, 400.0)
    att = c.get("/api/reports/attention").json()
    assert att["draft_invoices"] == 1 and att["unpaid_bills"] == 1 and att["mydata_unreported"] >= 2
    csv_ = c.get("/api/reports/export.csv?kind=expenses&start=2026-10-01&end=2026-10-31")
    text = csv_.content.decode("utf-8")
    assert text.startswith("﻿") and "'=HYPERLINK" in text and "Old" not in text
    inv_csv = c.get("/api/reports/export.csv?kind=invoices&start=2026-10-01&end=2026-10-31").content.decode()
    assert "Credit note" in inv_csv and "-100.0" in inv_csv
