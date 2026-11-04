from xml.etree import ElementTree as ET

from app import greek_tax as gt
from conftest import CLIENT_AFM, IBAN, OUR_AFM

INVOICE = {"issue_date": "2026-11-04", "currency": "EUR", "tax_rate": 24,
           "items": [{"description": "Plumbing", "qty": 3, "unit_price": 33.333}, {"description": "Parts", "qty": 1, "unit_price": 10}]}
MD = {"invoice_type": "2.1", "payment_method": 1, "counterpart_vat": CLIENT_AFM, "counterpart_country": "GR"}
ISSUER = {"vat_number": OUR_AFM, "branch": 0}
NS = {"m": gt.NS_INV, "i": gt.NS_ICLS}


def test_afm_and_iban():
    assert gt.is_valid_afm(OUR_AFM) and gt.is_valid_afm("EL" + CLIENT_AFM)
    assert not gt.is_valid_afm(CLIENT_AFM[:-1] + str((int(CLIENT_AFM[-1]) + 1) % 10))
    assert not gt.is_valid_afm("000000000")
    assert gt.is_valid_iban(IBAN) and gt.is_valid_iban("GR16 0110 1250 0000 0001 2300 695")
    assert not gt.is_valid_iban(IBAN[:-1] + "6")


def test_validation():
    assert gt.validate_for_mydata(INVOICE, ISSUER, MD) == []
    errs = " ".join(gt.validate_for_mydata({**INVOICE, "currency": "USD", "tax_rate": 20}, ISSUER, {**MD, "counterpart_vat": "1"}))
    assert "EUR" in errs and "20" in errs and "Customer ΑΦΜ" in errs
    assert any("exemption" in e for e in gt.validate_for_mydata({**INVOICE, "tax_rate": 0}, ISSUER, MD))
    assert gt.validate_for_mydata(INVOICE, ISSUER, {"invoice_type": "11.2", "payment_method": 3}) == []


def test_xml_amounts():
    root = ET.fromstring(gt.build_invoices_doc(INVOICE, ISSUER, MD, "A", "7").split("?>", 1)[1])
    inv = root.find("m:invoice", NS)
    assert inv.find("m:counterpart/m:name", NS) is None
    lines = inv.findall("m:invoiceDetails", NS)
    assert [l.find("m:netValue", NS).text for l in lines] == ["100.00", "10.00"]
    assert [l.find("m:vatAmount", NS).text for l in lines] == ["24.00", "2.40"]
    assert inv.find("m:invoiceSummary/m:totalGrossValue", NS).text == "136.40"


def test_credit_note_xml():
    md = {**MD, "invoice_type": "5.1", "correlated_mark": "400000000000123"}
    assert gt.validate_for_mydata(INVOICE, ISSUER, md) == []
    hdr = ET.fromstring(gt.build_invoices_doc(INVOICE, ISSUER, md, "A", "9").split("?>", 1)[1]).find("m:invoice/m:invoiceHeader", NS)
    tags = [t.tag.split("}")[1] for t in hdr]
    assert hdr.find("m:correlatedInvoices", NS).text == "400000000000123" and tags.index("currency") < tags.index("correlatedInvoices")


def test_parse_response():
    r = gt.parse_response("<ResponseDoc><response><invoiceMark>400001</invoiceMark><statusCode>Success</statusCode></response></ResponseDoc>")
    assert r["ok"] and r["mark"] == "400001"
    r = gt.parse_response('<ResponseDoc xmlns="x"><response><statusCode>ValidationError</statusCode><errors><error><message>bad</message><code>102</code></error></errors></response></ResponseDoc>')
    assert not r["ok"] and r["errors"] == [{"code": "102", "message": "bad"}]
    assert not gt.parse_response("not xml")["ok"]
