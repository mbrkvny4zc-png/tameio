"""Withholding & stamp duty, part payments & statements, series/branches, combined delivery note, design,
stock, AI drafts, shop webhooks, card-terminal receipts."""
import base64
import hashlib
import hmac
import json

from conftest import CLIENT_AFM, OUR_AFM, run

MD = {"invoice_type": "2.1", "payment_method": 1, "counterpart_vat": CLIENT_AFM, "counterpart_country": "GR"}


def _inv(c, **kw):
    body = {"client_name": "Acme", "client_afm": CLIENT_AFM, "tax_rate": 24, "status": "sent",
            "items": [{"description": "Consulting", "qty": 1, "unit_price": 1000}], **kw}
    r = c.post("/api/invoices", json=body)
    assert r.status_code == 200, r.text
    return r.json()


# ---------------------------------------------------------------- withholding & stamp duty

def test_withholding_and_stamp_totals_and_xml(client):
    from app import greek_tax as gt
    c = client
    inv = _inv(c, withholding_category=3, stamp_category=1)
    # net 1000, VAT 240, withholding 20% = 200, stamp 1.2% = 12 -> client pays 1052
    assert (inv["subtotal"], inv["tax"], inv["withheld"], inv["stamp_duty"], inv["gross"], inv["total"]) == (1000, 240, 200, 12, 1240, 1052)
    xml = c.post(f"/api/invoices/{inv['id']}/mydata/preview", json=MD).json()["xml"]
    for frag in ("<withheldAmount>200.00</withheldAmount>", "<withheldPercentCategory>3</withheldPercentCategory>",
                 "<stampDutyAmount>12.00</stampDutyAmount>", "<stampDutyPercentCategory>1</stampDutyPercentCategory>",
                 "<totalWithheldAmount>200.00</totalWithheldAmount>", "<totalStampDutyAmount>12.00</totalStampDutyAmount>",
                 "<totalGrossValue>1052.00</totalGrossValue>", "<amount>1052.00</amount>"):
        assert frag in xml, frag
    # line field order: vat → withheld → stamp → incomeClassification
    assert xml.index("<vatAmount>") < xml.index("<withheldAmount>") < xml.index("<stampDutyAmount>") < xml.index("incomeClassification")
    assert c.post("/api/invoices", json={"client_name": "x", "withholding_category": 99, "items": [{"description": "a", "qty": 1, "unit_price": 10}]}).json()["withholding_category"] == 0
    assert gt.validate_for_mydata({**inv, "items": inv["items"]}, {"vat_number": OUR_AFM}, {**MD, "invoice_type": "11.2"})
    # credit note carries the same withholding proportionally
    c.post(f"/api/invoices/{inv['id']}/mydata/submit", json=MD)
    cn = c.post(f"/api/invoices/{inv['id']}/credit-note", json={"reason": "half", "items": [{"description": "Consulting", "qty": 1, "unit_price": 500}]}).json()
    assert (cn["withheld"], cn["stamp_duty"], cn["total"]) == (100, 6, 526)


# ---------------------------------------------------------------- part payments & statement

def test_part_payments_and_statement(client):
    c = client
    cl = c.post("/api/clients", json={"name": "Acme", "afm": CLIENT_AFM}).json()
    draft = c.post("/api/invoices", json={"client_id": cl["id"], "status": "draft", "items": [{"description": "x", "qty": 1, "unit_price": 100}]}).json()
    assert c.post(f"/api/invoices/{draft['id']}/payments", json={"amount": 10}).status_code == 400
    inv = c.post("/api/invoices", json={"client_id": cl["id"], "status": "sent", "issue_date": "2026-10-01",
                                        "items": [{"description": "Work", "qty": 1, "unit_price": 500}]}).json()  # total 620
    a = c.post(f"/api/invoices/{inv['id']}/payments", json={"amount": 200, "date": "2026-10-10", "method": "bank_transfer"}).json()
    assert a["paid_amount"] == 200 and a["balance"] == 420 and a["status"] == "sent"
    assert c.post(f"/api/invoices/{inv['id']}/payments", json={"amount": 500}).status_code == 400  # more than owed
    b = c.post(f"/api/invoices/{inv['id']}/payments", json={"amount": 420, "date": "2026-10-20", "method": "cash"}).json()
    assert b["status"] == "paid" and b["balance"] == 0
    back = c.delete(f"/api/invoices/{inv['id']}/payments/{b['payments'][1]['id']}").json()
    assert back["status"] in ("sent", "overdue") and back["balance"] == 420
    st = c.get(f"/api/clients/{cl['id']}/statement").json()
    assert [r["kind"] for r in st["rows"]] == ["invoice", "payment"]
    assert st["invoiced"] == 620 and st["received"] == 200 and st["closing"] == 420
    st2 = c.get(f"/api/clients/{cl['id']}/statement?start=2026-10-05").json()
    assert st2["opening"] == 620 and st2["rows"][0]["balance"] == 420


# ---------------------------------------------------------------- series & branches

def test_series_with_branches(client):
    c = client
    r = c.put("/api/mydata/settings", json={"series": "A", "environment": "simulation",
                                             "series_list": [{"code": "A", "label": "Wholesale"}, {"code": "b", "label": "Shop 2", "branch": 2}]})
    assert r.status_code == 200 and [s["code"] for s in r.json()["series_list"]] == ["A", "B"]
    assert c.put("/api/mydata/settings", json={"series": "A", "series_list": [{"code": "Α Β"}]}).status_code == 400
    c.put("/api/mydata/settings", json={"series": "A", "environment": "simulation",
                                        "series_list": [{"code": "A", "label": "Wholesale"}, {"code": "B", "label": "Shop 2", "branch": 2}]})
    i1, i2, i3 = _inv(c), _inv(c), _inv(c)
    m1 = c.post(f"/api/invoices/{i1['id']}/mydata/submit", json=MD).json()["mydata"]
    m2 = c.post(f"/api/invoices/{i2['id']}/mydata/submit", json={**MD, "series": "B"}).json()["mydata"]
    m3 = c.post(f"/api/invoices/{i3['id']}/mydata/submit", json={**MD, "series": "B"}).json()["mydata"]
    assert (m1["series"], m1["aa"], m1["branch"]) == ("A", "1", 0)
    assert (m2["series"], m2["aa"], m2["branch"], m3["aa"]) == ("B", "1", 2, "2")
    xml = run(c.db.mydata_transmissions.find_one({"invoice_id": i2["id"]}))["xml"]
    assert "<branch>2</branch>" in xml and "<series>B</series>" in xml


# ---------------------------------------------------------------- invoice + delivery note in one

def test_invoice_that_is_also_delivery_note(client):
    c = client
    dn = {"enabled": True, "move_purpose": 1, "dispatch_date": "2026-11-05", "dispatch_time": "08:15", "vehicle_number": "ikx1234",
          "loading_address": {"street": "Σταδίου", "number": "10", "postal_code": "10564", "city": "Αθήνα"},
          "delivery_address": {"street": "Εγνατίας", "postal_code": "54625", "city": "Θεσσαλονίκη"}}
    inv = _inv(c, delivery=dn, items=[{"description": "Cable", "qty": 50, "unit_price": 2}])
    assert inv["delivery"]["vehicle_number"] == "IKX1234"
    pv = c.post(f"/api/invoices/{inv['id']}/mydata/preview", json={**MD, "invoice_type": "1.1"}).json()
    assert pv["errors"] == []
    x = pv["xml"]
    assert "<isDeliveryNote>true</isDeliveryNote>" in x and "<movePurpose>1</movePurpose>" in x and "<invoiceType>1.1</invoiceType>" in x
    assert x.index("<currency>") < x.index("<dispatchDate>") < x.index("<otherDeliveryNoteHeader>")
    errs = c.post(f"/api/invoices/{inv['id']}/mydata/preview", json=MD).json()["errors"]  # 2.1 service invoice can't move goods
    assert any("delivery note" in e for e in errs)
    plain = _inv(c, delivery={"enabled": False})
    assert plain["delivery"] is None


# ---------------------------------------------------------------- design settings & client language

def test_invoice_design_and_bank_accounts(client):
    c = client
    from conftest import IBAN
    r = c.put("/api/business", json={"business_name": "P", "afm": OUR_AFM, "invoice_template": "modern", "brand_color": "#B5532C",
                                      "invoice_footer": "Thank you!", "bank_accounts": [{"label": "Piraeus", "iban": IBAN}]})
    b = r.json()
    assert b["invoice_template"] == "modern" and b["brand_color"] == "#B5532C" and b["bank_accounts"][0]["label"] == "Piraeus"
    assert c.put("/api/business", json={"business_name": "P", "brand_color": "red"}).status_code == 400
    assert c.put("/api/business", json={"business_name": "P", "bank_accounts": [{"iban": "GR0000"}]}).status_code == 400
    assert c.put("/api/business", json={"business_name": "P", "invoice_template": "weird"}).json()["invoice_template"] == "classic"
    cl = c.post("/api/clients", json={"name": "Berlin GmbH", "country": "DE", "language": "en"}).json()
    inv = c.post("/api/invoices", json={"client_id": cl["id"], "iban": IBAN, "items": [{"description": "x", "qty": 1, "unit_price": 1}]}).json()
    assert inv["iban"] == IBAN


# ---------------------------------------------------------------- stock

def test_stock_moves_with_sales(client):
    c = client
    p = c.post("/api/products", json={"name": "LED panel", "unit_price": 30, "kind": "goods", "track_stock": True, "low_stock": 5}).json()
    svc = c.post("/api/products", json={"name": "Labour", "unit_price": 40, "kind": "service", "track_stock": True}).json()
    assert svc["track_stock"] is False  # services never track stock
    assert c.post(f"/api/products/{p['id']}/stock", json={"qty": 20, "note": "delivery"}).json()["stock"] == 20
    line = [{"description": "LED panel", "qty": 4, "unit_price": 30, "product_id": p["id"]}]
    draft = c.post("/api/invoices", json={"client_name": "A", "status": "draft", "items": line}).json()
    stock = lambda: next(x for x in c.get("/api/products").json() if x["id"] == p["id"])["stock"]  # noqa: E731
    assert stock() == 20  # drafts don't move stock
    c.put(f"/api/invoices/{draft['id']}/status", json={"status": "sent"})
    assert stock() == 16
    c.put(f"/api/invoices/{draft['id']}", json={"client_name": "A", "status": "sent", "items": [{**line[0], "qty": 10}]})
    assert stock() == 10
    r = c.post("/api/receipts", json={"items": [{"description": "LED panel", "qty": 6, "unit_price": 30, "product_id": p["id"]}], "payment": "cash"})
    assert r.status_code == 200 and stock() == 4
    assert any("Low stock" in n["message"] for n in c.get("/api/notifications").json()["items"])
    c.delete(f"/api/invoices/{draft['id']}")
    assert stock() == 14
    moves = c.get(f"/api/products/{p['id']}/moves").json()
    assert [m["reason"] for m in moves][-1] == "adjustment" and len(moves) >= 5


# ---------------------------------------------------------------- AI draft

def test_ai_draft_resolves_ids_and_prices(client, monkeypatch):
    from app import ai
    c = client
    cl = c.post("/api/clients", json={"name": "Kafeneio Plaka", "afm": CLIENT_AFM}).json()
    p = c.post("/api/products", json={"name": "Electrical work — hourly", "unit_price": 40, "tax_rate": 24}).json()

    async def fake(text, clients, products):
        assert any(x["id"] == cl["id"] for x in clients) and products[0]["price"] == 40
        return {"doc_kind": "invoice", "client_id": cl["id"], "client_name": "Plaka", "client_afm": None,
                "items": [{"product_id": p["id"], "description": "Electrical work", "qty": 3, "unit_price": None},
                          {"product_id": "made-up", "description": "Sockets", "qty": 2, "unit_price": 12.4},
                          {"product_id": None, "description": "Mystery part", "qty": 1, "unit_price": None}],
                "prices_include_vat": True, "tax_rate": None, "due_in_days": 15, "notes": "", "questions": []}
    monkeypatch.setattr(ai, "draft_invoice", fake)
    r = c.post("/api/ai/draft-invoice", json={"text": "Plaka, 3 hours work, 2 sockets at 12.40 incl VAT, due in 15 days"}).json()
    assert r["client_id"] == cl["id"] and r["matched_client"] and r["tax_rate"] == 24 and r["due_in_days"] == 15
    assert r["items"][0]["unit_price"] == 40 and r["items"][0]["product_id"] == p["id"]
    assert r["items"][1]["unit_price"] == 10.0 and "product_id" not in r["items"][1]  # 12.40 incl. 24% VAT, fake id dropped
    assert r["items"][2]["unit_price"] == "" and any("Mystery part" in q for q in r["questions"])
    assert c.post("/api/ai/draft-invoice", json={"text": " "}).status_code == 400


# ---------------------------------------------------------------- shop webhooks

def _sign(secret, body):
    return base64.b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).decode()


def test_shopify_and_woocommerce_orders(client):
    c = client
    p = c.post("/api/products", json={"name": "Olive oil 1L", "code": "OIL-1", "unit_price": 10, "kind": "goods", "track_stock": True}).json()
    c.post(f"/api/products/{p['id']}/stock", json={"qty": 10})
    shop = c.post("/api/shops", json={"platform": "shopify", "name": "My Shopify", "mode": "invoice_if_vat"}).json()
    token = shop["webhook_url"].rsplit("/", 1)[1]
    order = {"id": 555, "name": "#1001", "financial_status": "paid", "taxes_included": True, "email": "maria@example.gr", "total_price": "29.76",
             "billing_address": {"first_name": "Maria", "last_name": "K", "city": "Athens", "zip": "10563", "country_code": "GR"},
             "line_items": [{"title": "Olive oil 1L", "sku": "OIL-1", "quantity": 2, "price": "12.40", "total_discount": "0", "tax_lines": [{"rate": 0.24}]}],
             "shipping_lines": [{"title": "Courier", "price": "4.96", "tax_lines": [{"rate": 0.24}]}]}
    body = json.dumps(order).encode()
    assert c.post(f"/api/hooks/shop/{token}", content=body, headers={"X-Shopify-Hmac-Sha256": "bad"}).status_code == 401
    r = c.post(f"/api/hooks/shop/{token}", content=body, headers={"X-Shopify-Hmac-Sha256": _sign(shop["secret"], body)}).json()
    assert r["number"].startswith("REC-")
    again = c.post(f"/api/hooks/shop/{token}", content=body, headers={"X-Shopify-Hmac-Sha256": _sign(shop["secret"], body)}).json()
    assert again.get("duplicate")
    rec = next(i for i in c.get("/api/invoices").json() if i["number"] == r["number"])
    assert rec["total"] == 29.76 and rec["tax_rate"] == 24 and rec["status"] == "paid" and rec["mydata"]["state"] == "transmitted"
    assert next(x for x in c.get("/api/products").json() if x["id"] == p["id"])["stock"] == 8

    woo = c.post("/api/shops", json={"platform": "woocommerce", "mode": "invoice_if_vat"}).json()
    wt = woo["webhook_url"].rsplit("/", 1)[1]
    o = {"id": 77, "number": "77", "status": "processing", "total": "62.00",
         "billing": {"first_name": "Nikos", "company": "Acme ΙΚΕ", "email": "n@acme.gr", "city": "Patra", "postcode": "26221", "country": "GR"},
         "meta_data": [{"key": "_billing_vat", "value": CLIENT_AFM}],
         "line_items": [{"name": "Service pack", "quantity": 1, "total": "50.00", "total_tax": "12.00", "sku": ""}]}
    b2 = json.dumps(o).encode()
    r2 = c.post(f"/api/hooks/shop/{wt}", content=b2, headers={"X-WC-Webhook-Signature": _sign(woo["secret"], b2)}).json()
    inv = next(i for i in c.get("/api/invoices").json() if i["number"] == r2["number"])
    assert inv["kind"] == "invoice" and inv["client_afm"] == CLIENT_AFM and inv["mydata"]["invoice_type"] == "1.1" and inv["total"] == 62
    pending = {**o, "id": 78, "status": "pending"}
    b3 = json.dumps(pending).encode()
    assert c.post(f"/api/hooks/shop/{wt}", content=b3, headers={"X-WC-Webhook-Signature": _sign(woo["secret"], b3)}).json()["skipped"]
    assert "secret" not in c.get("/api/shops").json()[0]


# ---------------------------------------------------------------- card terminal

def test_terminal_receipt_flow_simulated(client):
    c = client
    assert c.put("/api/pos/settings", json={"terminal_id": "16000123", "simulate": True}).json()["simulate"]
    r = c.post("/api/receipts", json={"items": [{"description": "Coffee", "qty": 1, "unit_price": 3}], "tax_rate": 13, "payment": "terminal"}).json()
    rec = r["receipt"]
    assert r["awaiting_terminal"] and rec["status"] == "draft" and not r["mydata"]
    assert c.post(f"/api/receipts/{rec['id']}/terminal").json()["status"] == "pending"
    done = c.get(f"/api/receipts/{rec['id']}/terminal").json()
    assert done["status"] == "approved" and done["mydata"]
    xml = run(c.db.mydata_transmissions.find_one({"invoice_id": rec["id"]}))["xml"]
    assert "<transactionId>SIM-" in xml and "<tid>16000123</tid>" in xml and "<type>7</type>" in xml
    assert c.post(f"/api/receipts/{rec['id']}/terminal").status_code == 409
