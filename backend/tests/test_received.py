from xml.etree import ElementTree as ET

from app import greek_tax as gt
from conftest import VENDOR_AFM, make_afm, run

SAMPLE = f"""<?xml version="1.0" encoding="utf-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <continuationToken><nextPartitionKey>pk1</nextPartitionKey><nextRowKey>rk1</nextRowKey></continuationToken>
  <invoicesDoc>
    <invoice>
      <uid>ABC</uid><mark>400001234567890</mark>
      <issuer><vatNumber>{VENDOR_AFM}</vatNumber><country>GR</country><branch>0</branch></issuer>
      <invoiceHeader><series>A</series><aa>4512</aa><issueDate>2026-10-28</issueDate><invoiceType>11.1</invoiceType><currency>EUR</currency></invoiceHeader>
      <invoiceDetails><lineNumber>1</lineNumber><netValue>50.00</netValue><vatCategory>1</vatCategory><vatAmount>12.00</vatAmount></invoiceDetails>
      <invoiceSummary><totalNetValue>50.00</totalNetValue><totalVatAmount>12.00</totalVatAmount><totalGrossValue>62.00</totalGrossValue></invoiceSummary>
    </invoice>
    <invoice>
      <mark>400001234567999</mark>
      <issuer><vatNumber>{make_afm('55555555')}</vatNumber></issuer>
      <invoiceHeader><series>B</series><aa>77</aa><issueDate>2026-10-30</issueDate><invoiceType>2.1</invoiceType></invoiceHeader>
      <invoiceDetails><lineNumber>1</lineNumber><netValue>100</netValue><vatAmount>24</vatAmount></invoiceDetails>
      <invoiceDetails><lineNumber>2</lineNumber><netValue>20</netValue><vatAmount>4.8</vatAmount></invoiceDetails>
      <invoiceSummary><totalNetValue>120</totalNetValue><totalVatAmount>28.8</totalVatAmount><totalGrossValue>148.8</totalGrossValue></invoiceSummary>
    </invoice>
  </invoicesDoc>
</RequestedDoc>"""


def test_parse_requested_docs_and_build_classification():
    p = gt.parse_requested_docs(SAMPLE)
    assert p["continuation"] == {"nextPartitionKey": "pk1", "nextRowKey": "rk1"}
    a, b = p["docs"]
    assert (a["mark"], a["issuer_afm"], a["gross"], a["invoice_type"]) == ("400001234567890", VENDOR_AFM, 62.0, "11.1")
    assert len(b["lines"]) == 2 and b["lines"][1]["net"] == 20.0 and b["currency"] == "EUR"
    xml = gt.build_expenses_classification([{"mark": "1", "category": "category2_4", "e3_type": "E3_585_016", "lines": b["lines"]}])
    root = ET.fromstring(xml.split("?>", 1)[1])
    ns = {"e": gt.NS_ECLS}
    dets = root.findall("e:expensesInvoiceClassification/e:invoicesExpensesClassificationDetails", ns)
    assert [x.find("e:lineNumber", ns).text for x in dets] == ["1", "2"]
    assert dets[1].find("e:expensesClassificationDetailData/e:amount", ns).text == "20.00"
    multi = gt.parse_responses("<ResponseDoc><response><statusCode>Success</statusCode><classificationMark>9</classificationMark></response>"
                               "<response><statusCode>ValidationError</statusCode><errors><error><message>bad</message><code>1</code></error></errors></response></ResponseDoc>")
    assert multi[0]["ok"] and multi[0]["classification_mark"] == "9" and not multi[1]["ok"]


def test_simulated_sync_matches_and_classifies(client):
    c = client
    exp = c.post("/api/expenses", json={"vendor_name": "Shell", "vendor_afm": VENDOR_AFM, "category": "fuel", "net": 50, "vat": 12,
                                        "mark": "400001234567890", "date": "2026-10-28"}).json()
    r = c.post("/api/received/sync").json()
    assert r["environment"] == "simulation" and r["added"] == 5 and r["matched"] == 1
    assert c.post("/api/received/sync").json()["added"] == 0  # idempotent
    items = c.get("/api/received").json()["items"]
    shell = next(x for x in items if x["mark"] == "400001234567890")
    assert shell["match"]["id"] == exp["id"] and shell["suggestion"] == {"category": "fuel", "source": "expense", "confidence": "high"}
    other = next(x for x in items if x["mark"] != "400001234567890")
    assert other["suggestion"] is None and other["simulated"]
    # create an expense from an unmatched one, then classify both and send (simulation)
    created = c.post(f"/api/received/{other['id']}/create-expense").json()
    assert created["number"].startswith("EXP-")
    assert c.post(f"/api/received/{other['id']}/create-expense").status_code == 409
    for doc_id, cat in ((shell["id"], "fuel"), (other["id"], "telecom")):
        cl = c.put(f"/api/received/{doc_id}/classification", json={"category": cat}).json()["classification"]
        assert cl["state"] == "draft" and cl["mydata_category"].startswith("category2_")
    res = c.post("/api/received/send", json={"ids": [shell["id"], other["id"]]}).json()
    assert res == {"sent": 2, "failed": []}
    assert c.put(f"/api/received/{shell['id']}/classification", json={"category": "rent"}).status_code == 409
    # matched expense category followed the classification
    assert next(x for x in c.get("/api/expenses").json() if x["id"] == exp["id"])["category"] == "fuel"


def test_live_mode_requires_e3_codes_and_reports_aade_errors(client, monkeypatch):
    from app.routers import received
    c = client
    c.put("/api/mydata/settings", json={"vat_number": "", "environment": "sandbox", "aade_user_id": "u", "subscription_key": "k"})
    calls = []

    async def fake_get(settings, params):
        calls.append(params)
        return SAMPLE.replace("<continuationToken><nextPartitionKey>pk1</nextPartitionKey><nextRowKey>rk1</nextRowKey></continuationToken>", "")
    monkeypatch.setattr(received, "_request_docs", fake_get)
    assert c.post("/api/received/sync").json()["added"] == 2
    assert calls[0]["mark"] == "0"
    c.post("/api/received/sync")
    assert calls[1]["mark"] == "400001234567999"  # resumes after the last seen ΜΑΡΚ
    items = c.get("/api/received").json()["items"]
    ids = [x["id"] for x in items]
    for i in ids:
        c.put(f"/api/received/{i}/classification", json={"category": "materials"})
    r = c.post("/api/received/send", json={"ids": ids})
    assert r.status_code == 422 and "Goods & materials" in r.json()["detail"]["errors"]
    assert c.put("/api/received/classification-map", json={"items": {"materials": {"category": "category2_1", "e3_type": "nonsense"}}}).status_code == 400
    c.put("/api/received/classification-map", json={"items": {"materials": {"category": "category2_1", "e3_type": "E3_102_001"}}})
    for i in ids:
        c.put(f"/api/received/{i}/classification", json={"category": "materials"})

    class Resp:
        text = ("<ResponseDoc><response><statusCode>Success</statusCode><classificationMark>77</classificationMark></response>"
                "<response><statusCode>ValidationError</statusCode><errors><error><message>Invalid E3</message><code>301</code></error></errors></response></ResponseDoc>")
    sent_xml = []

    async def fake_post(settings, path, body="", params=None):
        sent_xml.append((path, body))
        return Resp()
    import app.routers.mydata as mydata
    monkeypatch.setattr(mydata, "_post_aade", fake_post)
    r = c.post("/api/received/send", json={"ids": ids}).json()
    assert r["sent"] == 1 and "301 Invalid E3" in r["failed"][0]
    assert sent_xml[0][0] == "SendExpensesClassification" and "E3_102_001" in sent_xml[0][1]
    states = sorted(x["classification"]["state"] for x in c.get("/api/received").json()["items"])
    assert states == ["error", "sent"]


def test_ai_suggestions(client, monkeypatch):
    from app import ai
    c = client
    c.post("/api/received/sync")

    async def fake(docs):
        return {d["id"]: ("telecom", "medium") for d in docs}
    monkeypatch.setattr(ai, "suggest_categories", fake)
    r = c.post("/api/received/suggest").json()
    assert r["suggested"] == 4 and r["remaining"] == 0
    assert all(x["suggestion"]["source"] == "ai" for x in c.get("/api/received").json()["items"])
