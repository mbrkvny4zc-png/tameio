"""ΑΦΜ lookup, products, import, duplicate, receipts, delivery notes, ask-your-numbers, onboarding."""
import io

from conftest import CLIENT_AFM, OUR_AFM, run


# ---------------------------------------------------------------- ΑΦΜ lookup

AADE_XML = """<?xml version="1.0"?><env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope"><env:Body>
<srvc:rgWsPublic2AfmMethodResponse xmlns:srvc="http://rgwspublic2/RgWsPublic2Service" xmlns="http://rgwspublic2/RgWsPublic2">
<srvc:result><rg_ws_public2_result_rtType>
<call_seq_id>1</call_seq_id><error_rec><error_code xsi:nil="true" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/></error_rec>
<basic_rec><afm>{afm}</afm><doy>1104</doy><doy_descr>Δ' ΑΘΗΝΩΝ</doy_descr><deactivation_flag>1</deactivation_flag>
<deactivation_flag_descr>ΕΝΕΡΓΟΣ ΑΦΜ</deactivation_flag_descr><onomasia>ΑΚΜΕ ΜΟΝΟΠΡΟΣΩΠΗ ΙΚΕ</onomasia><commer_title>ACME</commer_title>
<legal_status_descr>ΙΚΕ</legal_status_descr><postal_address>ΣΤΑΔΙΟΥ</postal_address><postal_address_no>10</postal_address_no>
<postal_zip_code>10564</postal_zip_code><postal_area_description>ΑΘΗΝΑ</postal_area_description></basic_rec>
<firm_act_tab><item><firm_act_code>62010000</firm_act_code><firm_act_descr>ΠΡΟΓΡΑΜΜΑΤΙΣΜΟΣ</firm_act_descr><firm_act_kind>1</firm_act_kind></item></firm_act_tab>
</rg_ws_public2_result_rtType></srvc:result></srvc:rgWsPublic2AfmMethodResponse></env:Body></env:Envelope>"""


def test_parse_aade_registry_and_vies_address():
    from app.routers.lookup import parse_aade, parse_vies_address
    r = parse_aade(AADE_XML.format(afm=CLIENT_AFM))
    assert r["name"] == "ΑΚΜΕ ΜΟΝΟΠΡΟΣΩΠΗ ΙΚΕ" and r["doy"] == "Δ' ΑΘΗΝΩΝ" and r["address"] == "ΣΤΑΔΙΟΥ 10"
    assert r["postal_code"] == "10564" and r["active"] and r["activities"][0]["main"]
    a = parse_vies_address("ΛΕΩΦ ΚΗΦΙΣΙΑΣ 12 15125 - ΜΑΡΟΥΣΙ")
    assert a == {"address": "ΛΕΩΦ ΚΗΦΙΣΙΑΣ 12", "postal_code": "15125", "city": "ΜΑΡΟΥΣΙ"}


def test_afm_lookup_uses_vies_and_caches(client, monkeypatch):
    from app.routers import lookup
    calls = []

    async def fake_vies(afm):
        calls.append(afm)
        return {"afm": afm, "name": "ACME IKE", "address": "ΣΤΑΔΙΟΥ 10", "postal_code": "10564", "city": "ΑΘΗΝΑ", "doy": "",
                "trade_name": "", "legal_form": "", "active": True, "status_text": "", "activities": [], "source": "vies"}
    monkeypatch.setattr(lookup, "_from_vies", fake_vies)
    assert client.get("/api/lookup/afm/123456789").status_code == 400  # checksum
    r = client.get(f"/api/lookup/afm/{CLIENT_AFM}")
    assert r.status_code == 200 and r.json()["name"] == "ACME IKE"
    client.get(f"/api/lookup/afm/{CLIENT_AFM}")
    assert calls == [CLIENT_AFM]  # second call served from cache


# ---------------------------------------------------------------- products, duplicate

def test_products_and_duplicate(client, other_client):
    c = client
    p = c.post("/api/products", json={"name": "Hourly work", "unit_price": 40, "tax_rate": 24, "unit": "hour"}).json()
    assert c.post("/api/products", json={"name": " "}).status_code == 400
    assert other_client.put(f"/api/products/{p['id']}", json={"name": "x"}).status_code == 404
    c.post(f"/api/products/{p['id']}/used")
    assert c.get("/api/products").json()[0]["uses"] == 1
    inv = c.post("/api/invoices", json={"client_name": "Acme", "status": "sent", "items": [{"description": "Work", "qty": 2, "unit_price": 50}]}).json()
    dup = c.post(f"/api/invoices/{inv['id']}/duplicate").json()
    assert dup["number"] != inv["number"] and dup["status"] == "draft" and dup["total"] == 124.0 and dup["duplicated_from"] == inv["id"]


# ---------------------------------------------------------------- import

def test_import_clients_csv_greek_headers_and_duplicates(client):
    c = client
    csv_text = f"Επωνυμία;ΑΦΜ;Email;Πόλη\nΑλφα ΟΕ;{CLIENT_AFM};a@x.gr;Αθήνα\nΒήτα;123456789;b@x.gr;Πάτρα\nΓάμμα;;g@x.gr;Βόλος\n"
    files = {"file": ("clients.csv", io.BytesIO(csv_text.encode("cp1253")), "text/csv")}
    pre = c.post("/api/import/clients", files=files).json()
    assert pre["mapping"]["name"] == 0 and pre["mapping"]["afm"] == 1 and pre["ready"] == 2 and pre["problems"][0]["row"] == 3
    assert pre["created"] == 0 and c.get("/api/clients").json() == []
    files = {"file": ("clients.csv", io.BytesIO(csv_text.encode("cp1253")), "text/csv")}
    done = c.post("/api/import/clients", files=files, data={"commit": "true"}).json()
    assert done["created"] == 2 and {x["name"] for x in c.get("/api/clients").json()} == {"Αλφα ΟΕ", "Γάμμα"}
    files = {"file": ("clients.csv", io.BytesIO(csv_text.encode("cp1253")), "text/csv")}
    again = c.post("/api/import/clients", files=files, data={"commit": "true"}).json()
    assert again["created"] == 0 and again["duplicates"] == 2


def test_import_products_and_invoices_xlsx(client):
    from openpyxl import Workbook
    c = client
    wb = Workbook()
    ws = wb.active
    ws.append(["Περιγραφή", "Τιμή", "ΦΠΑ"])
    ws.append(["Consulting", "1.234,50", 0.24])
    ws.append(["Books", 10, 6])
    buf = io.BytesIO()
    wb.save(buf)
    r = c.post("/api/import/products", files={"file": ("p.xlsx", buf.getvalue(), "application/octet-stream")}, data={"commit": "true"}).json()
    assert r["created"] == 2
    prods = {p["name"]: p for p in c.get("/api/products").json()}
    assert prods["Consulting"]["unit_price"] == 1234.5 and prods["Consulting"]["tax_rate"] == 24 and prods["Books"]["tax_rate"] == 6

    csv_text = "Number,Date,Customer,Total,Status\nA-17,15/03/2026,Acme,124,paid\nA-18,2026-04-01,Beta,62,\n"
    r = c.post("/api/import/invoices", files={"file": ("i.csv", csv_text.encode(), "text/csv")}, data={"commit": "true"}).json()
    assert r["created"] == 2
    invs = {i["number"]: i for i in c.get("/api/invoices").json()}
    assert invs["A-17"]["subtotal"] == 100.0 and invs["A-17"]["status"] == "paid" and invs["A-17"]["issue_date"] == "2026-03-15"
    assert invs["A-18"]["status"] == "sent" and invs["A-18"]["imported"]


# ---------------------------------------------------------------- retail receipts

def test_quick_receipt_reports_to_mydata_simulation(client):
    c = client
    assert c.post("/api/receipts", json={"items": []}).status_code == 400
    r = c.post("/api/receipts", json={"items": [{"description": "Coffee", "qty": 2, "unit_price": 2.5}], "tax_rate": 13, "payment": "cash"}).json()
    rec = r["receipt"]
    assert rec["kind"] == "receipt" and rec["number"].startswith("REC-") and rec["status"] == "paid" and rec["total"] == 5.65
    assert r["mydata"] and rec["mydata"]["invoice_type"] == "11.1" and rec["mydata"]["payment_method"] == 3 and rec["mydata"]["simulated"]
    xml = run(c.db.mydata_transmissions.find_one({"invoice_id": rec["id"]}))["xml"]
    assert "<counterpart>" not in xml and "<invoiceType>11.1</invoiceType>" in xml
    assert c.post(f"/api/invoices/{rec['id']}/credit-note", json={"reason": "x"}).status_code == 400  # retail: not via credit note


# ---------------------------------------------------------------- delivery notes

def _note(c, **kw):
    body = {"move_purpose": 1, "recipient_name": "Acme", "recipient_afm": CLIENT_AFM,
            "loading_address": {"street": "Σταδίου", "number": "10", "postal_code": "10564", "city": "Αθήνα"},
            "delivery_address": {"street": "Εγνατίας", "number": "5", "postal_code": "54625", "city": "Θεσσαλονίκη"},
            "dispatch_date": "2026-11-05", "dispatch_time": "09:30", "vehicle_number": "ikx1234",
            "items": [{"description": "Ηλεκτρικός πίνακας", "qty": 3, "unit": 1}], **kw}
    r = c.post("/api/delivery-notes", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_delivery_note_xml_and_lifecycle(client, other_client):
    from app import greek_tax as gt
    c = client
    n = _note(c)
    assert n["number"].startswith("DN-") and n["vehicle_number"] == "IKX1234"
    assert other_client.get(f"/api/delivery-notes/{n['id']}").status_code == 404
    pv = c.post(f"/api/delivery-notes/{n['id']}/preview").json()
    assert pv["errors"] == []
    xml = pv["xml"]
    for frag in ("<invoiceType>9.3</invoiceType>", "<movePurpose>1</movePurpose>", "<isDeliveryNote>true</isDeliveryNote>",
                 "<dispatchTime>09:30:00</dispatchTime>", "<vatCategory>8</vatCategory>", "<measurementUnit>1</measurementUnit>",
                 f"<vatNumber>{CLIENT_AFM}</vatNumber>", "<postalCode>54625</postalCode>"):
        assert frag in xml, frag
    # header element order matters for the XSD
    assert xml.index("<dispatchDate>") < xml.index("<movePurpose>") < xml.index("<otherDeliveryNoteHeader>") < xml.index("<isDeliveryNote>")

    bad = _note(c, recipient_afm="", delivery_address={"street": "", "postal_code": "", "city": ""})
    errs = c.post(f"/api/delivery-notes/{bad['id']}/preview").json()["errors"]
    assert any("Recipient" in e for e in errs) and any("Delivery address" in e for e in errs)
    own = _note(c, move_purpose=8, recipient_afm="")
    assert c.post(f"/api/delivery-notes/{own['id']}/preview").json()["errors"] == []
    assert "<counterpart>" not in gt.build_delivery_note_doc({**own}, {"vat_number": OUR_AFM}, "DA", "1")

    issued = c.post(f"/api/delivery-notes/{n['id']}/issue").json()
    assert issued["status"] == "issued" and issued["mydata"]["mark"] and issued["mydata"]["aa"] == "1"
    assert c.put(f"/api/delivery-notes/{n['id']}", json={"items": []}).status_code == 409
    assert c.delete(f"/api/delivery-notes/{n['id']}").status_code == 409
    url = c.post(f"/api/delivery-notes/{n['id']}/share").json()["url"]
    pub = c.get(f"/api/public/delivery-notes/{url.rsplit('/', 1)[1]}").json()
    assert pub["note"]["number"] == n["number"] and pub["mydata"]["mark"] and "org_id" not in pub["note"]
    assert c.post(f"/api/delivery-notes/{n['id']}/delivered").json()["status"] == "delivered"


def test_delivery_note_from_invoice(client):
    c = client
    inv = c.post("/api/invoices", json={"client_name": "Acme", "client_afm": CLIENT_AFM, "items": [{"description": "Cable 3x2.5", "qty": 50, "unit_price": 1}]}).json()
    n = c.post(f"/api/delivery-notes/from-invoice/{inv['id']}").json()
    assert n["recipient_afm"] == CLIENT_AFM and n["items"][0]["qty"] == 50 and n["invoice_id"] == inv["id"]
    assert n["loading_address"]["city"] == "Athens"


# ---------------------------------------------------------------- ask your numbers

def test_ask_uses_snapshot_only(client, monkeypatch):
    from app import ai
    c = client
    c.post("/api/invoices", json={"client_name": "Acme", "status": "paid", "items": [{"description": "Work", "qty": 1, "unit_price": 100}]})
    c.post("/api/invoices", json={"client_name": "Beta", "status": "overdue", "items": [{"description": "Work", "qty": 1, "unit_price": 50}]})
    c.post("/api/expenses", json={"vendor_name": "Shell", "category": "fuel", "net": 40, "vat": 9.6})
    seen = {}

    async def fake(q, data, history):
        seen.update(data)
        return {"answer": "Beta owes €62.00.", "highlights": [{"label": "Unpaid", "value": "€62.00"}], "follow_ups": []}
    monkeypatch.setattr(ai, "ask_numbers", fake)
    r = c.post("/api/ask", json={"question": "Who owes me money?"})
    assert r.status_code == 200 and r.json()["answer"].startswith("Beta")
    month = next(iter(seen["months"].values()))
    assert month["income_net"] == 150.0 and month["expenses_net"] == 40.0
    assert [u["client"] for u in seen["unpaid_invoices"]] == ["Beta"] and seen["top_suppliers"][0]["supplier"] == "Shell"
    assert c.post("/api/ask", json={"question": " "}).status_code == 400


# ---------------------------------------------------------------- onboarding

def test_onboarding_sample_data_roundtrip(client):
    c = client
    o = c.get("/api/onboarding").json()
    assert o["steps"][0]["done"] and not o["has_sample"]
    c.post("/api/onboarding/sample-data")
    c.post("/api/onboarding/sample-data")  # idempotent
    assert len(c.get("/api/clients").json()) == 3 and len(c.get("/api/invoices").json()) == 6
    o = c.get("/api/onboarding").json()
    assert o["has_sample"] and not next(s for s in o["steps"] if s["key"] == "invoice")["done"]  # samples don't count
    sample_inv = c.get("/api/invoices").json()[0]
    assert c.post(f"/api/invoices/{sample_inv['id']}/mydata/submit", json={"invoice_type": "2.1"}).status_code == 400
    assert c.get("/api/reports/attention").json()["mydata_unreported"] == 0
    real = c.post("/api/clients", json={"name": "Real client"}).json()
    assert c.delete("/api/onboarding/sample-data").json()["removed"] > 0
    assert [x["id"] for x in c.get("/api/clients").json()] == [real["id"]] and c.get("/api/invoices").json() == []
