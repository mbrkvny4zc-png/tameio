from conftest import CLIENT_AFM, run

MD = {"invoice_type": "2.1", "payment_method": 1, "counterpart_vat": CLIENT_AFM, "counterpart_country": "GR"}


def _inv(c, **kw):
    body = {"client_name": "Acme", "client_afm": CLIENT_AFM, "tax_rate": 24, "status": "sent",
            "items": [{"description": "Work", "qty": 2, "unit_price": 50}], **kw}
    r = c.post("/api/invoices", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def test_invoice_validation(client):
    c = client
    assert c.post("/api/invoices", json={"items": []}).status_code == 400  # no client
    assert c.post("/api/invoices", json={"client_name": "x", "items": [{"description": "a", "qty": -1, "unit_price": 1}]}).status_code == 400
    assert c.post("/api/invoices", json={"client_name": "x", "issue_date": "2026-11-10", "due_date": "2026-11-01"}).status_code == 400
    inv = _inv(c, items=[{"description": "Panel", "qty": 3, "unit_price": 33.333}])
    assert (inv["subtotal"], inv["tax"], inv["total"]) == (100.0, 24.0, 124.0)


def test_public_invoice_hides_drafts_and_internal_fields(client):
    c = client
    d = _inv(c, status="draft")
    url = c.post(f"/api/invoices/{d['id']}/share").json()["url"]
    assert c.get(f"/api/public/invoices/{url.rsplit('/', 1)[1]}").status_code == 404
    c.put(f"/api/invoices/{d['id']}/status", json={"status": "sent"})
    pub = c.get(f"/api/public/invoices/{url.rsplit('/', 1)[1]}").json()
    assert pub["invoice"]["total"] == 124.0 and "org_id" not in pub["invoice"] and pub["business"]["iban"]


def test_mydata_simulation_lock_and_numbering(client):
    c = client
    s = c.get("/api/mydata/settings").json()
    assert s["vat_number_valid"] and s["environment"] == "simulation"  # defaults to business ΑΦΜ
    inv = _inv(c)
    pv = c.post(f"/api/invoices/{inv['id']}/mydata/preview", json=MD).json()
    assert pv["errors"] == [] and pv["totals"]["gross"] == 124.0
    assert c.post(f"/api/invoices/{inv['id']}/mydata/submit", json={**MD, "counterpart_vat": "1"}).status_code == 422
    md = c.post(f"/api/invoices/{inv['id']}/mydata/submit", json=MD).json()["mydata"]
    assert md["state"] == "transmitted" and md["simulated"] and md["aa"] == "1"
    assert c.post(f"/api/invoices/{inv['id']}/mydata/submit", json=MD).status_code == 409
    assert c.put(f"/api/invoices/{inv['id']}", json={"client_name": "B", "items": []}).status_code == 200  # simulated = editable
    assert c.get("/api/mydata/stats").json()["transmitted"] == 1


def test_mydata_sandbox_rejection_then_success_locks(client, monkeypatch):
    from app.routers import mydata
    c = client
    r = c.put("/api/mydata/settings", json={"vat_number": "", "environment": "sandbox", "aade_user_id": "u", "subscription_key": "secret-key-1234"})
    assert r.status_code == 200 and r.json()["subscription_key_hint"] == "••••1234"
    assert "secret-key-1234" not in str(run(c.db.mydata_settings.find_one({})))

    class Resp:
        def __init__(self, text, status=200):
            self.text, self.status_code = text, status
    replies = [Resp("<ResponseDoc><response><statusCode>ValidationError</statusCode><errors><error><message>bad</message><code>101</code></error></errors></response></ResponseDoc>"),
               Resp("<ResponseDoc><response><invoiceMark>400000000000123</invoiceMark><statusCode>Success</statusCode></response></ResponseDoc>")]
    bodies = []

    async def fake(settings, path, body="", params=None):
        bodies.append(body)
        return replies.pop(0)
    monkeypatch.setattr(mydata, "_post_aade", fake)
    inv = _inv(c)
    first = c.post(f"/api/invoices/{inv['id']}/mydata/submit", json=MD)
    assert first.status_code == 502 and "101 bad" in first.text
    ok = c.post(f"/api/invoices/{inv['id']}/mydata/submit", json=MD).json()["mydata"]
    assert ok["mark"] == "400000000000123" and not ok["simulated"]
    assert "<aa>1</aa>" in bodies[0] and "<aa>1</aa>" in bodies[1]
    assert c.put(f"/api/invoices/{inv['id']}", json={"client_name": "X", "items": []}).status_code == 409
    assert c.delete(f"/api/invoices/{inv['id']}").status_code == 409


def test_credit_notes(client):
    c = client
    inv = _inv(c)
    assert c.post(f"/api/invoices/{inv['id']}/credit-note", json={"reason": "x"}).status_code == 400  # not reported
    orig = c.post(f"/api/invoices/{inv['id']}/mydata/submit", json=MD).json()
    assert c.post(f"/api/invoices/{inv['id']}/credit-note", json={"reason": ""}).status_code == 400
    assert c.post(f"/api/invoices/{inv['id']}/credit-note", json={"reason": "r", "items": [{"description": "W", "qty": 3, "unit_price": 50}]}).status_code == 400
    cn = c.post(f"/api/invoices/{inv['id']}/credit-note", json={"reason": "One hour not worked", "items": [{"description": "Work", "qty": 1, "unit_price": 50}]}).json()
    assert cn["number"] == "CN-0001" and cn["status"] == "credited" and cn["total"] == 62.0
    sent = c.post(f"/api/invoices/{cn['id']}/mydata/submit", json={**MD, "invoice_type": "2.1", "correlated_mark": "999"}).json()["mydata"]
    assert sent["invoice_type"] == "5.1" and sent["correlated_mark"] == orig["mydata"]["mark"]
    assert c.post(f"/api/invoices/{inv['id']}/mydata/cancel").status_code == 409
    assert c.put(f"/api/invoices/{cn['id']}/status", json={"status": "paid"}).status_code == 400
    assert c.put(f"/api/invoices/{cn['id']}", json={"client_name": "x", "items": []}).status_code == 400
    assert _inv(c)["number"] == "INV-0002"


def test_scheduler_overdue_and_recurring(client):
    from app.routers import invoices
    c = client
    late = _inv(c, issue_date="2026-01-01", due_date="2026-01-15")
    rec = _inv(c, recurring="monthly")
    run(c.db.invoices.update_one({"id": rec["id"]}, {"$set": {"next_recurring_at": "2020-01-01T00:00:00+00:00"}}))
    assert run(invoices.flag_overdue()) == 1
    assert run(invoices.run_recurring()) == 1
    assert run(invoices.run_recurring()) == 0  # claimed; not duplicated
    all_inv = c.get("/api/invoices").json()
    assert next(i for i in all_inv if i["id"] == late["id"])["status"] == "overdue"
    assert sum(1 for i in all_inv if i.get("recurring_from") == rec["id"]) == 1
