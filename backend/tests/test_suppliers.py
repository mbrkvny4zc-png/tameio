import io
from datetime import date, timedelta

from conftest import IBAN, make_afm, make_gr_iban, run

PDF = b"%PDF-1.4 test"
SUP_AFM = make_afm("34567812")


def test_supplier_onboarding(client):
    c = client
    assert c.post("/api/suppliers", json={"name": "Bad", "afm": "123456789"}).status_code == 400
    s = c.post("/api/suppliers", json={"name": "Hellas Parts", "email": "a@b.gr", "afm": SUP_AFM}).json()
    assert s["compliance"]["verdict"] == "blocked" and "token" not in s
    assert c.post("/api/suppliers", json={"name": "Dup", "afm": SUP_AFM}).status_code == 409
    url = c.get(f"/api/suppliers/{s['id']}/link").json()["portal_url"]
    assert "/s/" in url
    token = url.rsplit("/", 1)[1]
    assert c.get("/api/public/suppliers/wrong-token-xxxxxxxxxxxx").status_code == 404
    assert c.put(f"/api/public/suppliers/{token}/profile", json={"iban": "GR00"}).status_code == 400
    assert c.put(f"/api/public/suppliers/{token}/profile", json={"iban": IBAN, "afm": SUP_AFM}).status_code == 200
    fut, soon = (date.today() + timedelta(days=60)).isoformat(), (date.today() + timedelta(days=5)).isoformat()
    up = lambda key, exp=None, content=PDF, name="d.pdf": c.post(  # noqa: E731
        f"/api/public/suppliers/{token}/documents", data={"requirement_key": key, **({"expiry_date": exp} if exp else {})},
        files={"file": (name, io.BytesIO(content), "application/pdf")})
    assert up("tax_clearance").status_code == 400                     # expiry required
    assert up("gemi_certificate", content=b"<html>").status_code == 400  # magic bytes
    assert up("gemi_certificate", name="x.html").status_code == 400     # extension
    for k, e in [("tax_clearance", soon), ("social_security_clearance", fut), ("gemi_certificate", None), ("contract", fut)]:
        assert up(k, e).status_code == 200
    assert c.post(f"/api/public/suppliers/{token}/submit").json()["supplier"]["status"] == "submitted"
    sup = next(x for x in c.get("/api/suppliers").json() if x["id"] == s["id"])
    assert c.put(f"/api/suppliers/{s['id']}/status", json={"status": "approved"}).status_code == 409
    for d in sup["documents"]:
        c.put(f"/api/suppliers/{s['id']}/documents/{d['id']}/review", json={"status": "approved"})
    sup = c.put(f"/api/suppliers/{s['id']}/status", json={"status": "approved"}).json()
    assert sup["compliance"]["verdict"] == "attention"
    assert c.get(f"/api/suppliers/{s['id']}/payment-check").json()["can_pay"]
    dl = c.get(f"/api/suppliers/{s['id']}/documents/{sup['documents'][0]['id']}/file")
    assert dl.content == PDF and "attachment" in dl.headers["content-disposition"]
    assert c.get("/api/suppliers/renewals?days=30").json()[0]["days_left"] == 5
    new_iban = make_gr_iban("01720000000512345678999")
    c.put(f"/api/public/suppliers/{token}/profile", json={"iban": new_iban, "afm": SUP_AFM})
    pc = c.get(f"/api/suppliers/{s['id']}/payment-check").json()
    assert not pc["can_pay"] and "not approved" in pc["reasons"][0]
    assert any("bank account" in n["message"] for n in c.get("/api/notifications").json()["items"])


def test_expiry_reminders_idempotent(client):
    from app.routers import suppliers
    c = client
    s = c.post("/api/suppliers", json={"name": "Expiring Co", "afm": make_afm("45678123"), "iban": IBAN}).json()
    c.post(f"/api/suppliers/{s['id']}/documents", data={"requirement_key": "tax_clearance", "expiry_date": (date.today() + timedelta(days=6)).isoformat()},
           files={"file": ("t.pdf", io.BytesIO(PDF), "application/pdf")})
    c.put(f"/api/suppliers/{s['id']}/status", json={"status": "approved", "force": True})
    assert run(suppliers.check_supplier_expiries()) == 1
    assert run(suppliers.check_supplier_expiries()) == 0
    assert run(suppliers.check_supplier_expiries(today=date.today() + timedelta(days=6))) == 1
