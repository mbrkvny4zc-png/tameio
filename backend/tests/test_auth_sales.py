from conftest import CLIENT_AFM, make_afm


def test_auth_flow(anon):
    c = anon
    assert c.get("/api/invoices").status_code == 401
    assert c.post("/api/auth/signup", json={"name": "A", "email": "bad", "password": "longenough"}).status_code == 400
    assert c.post("/api/auth/signup", json={"name": "A", "email": "a@b.gr", "password": "short"}).status_code == 400
    r = c.post("/api/auth/signup", json={"name": "A", "email": "A@b.gr", "password": "longenough"})
    assert r.status_code == 200 and "session" in r.cookies
    assert c.post("/api/auth/signup", json={"name": "A", "email": "a@b.gr", "password": "longenough"}).status_code == 409
    assert c.get("/api/auth/me").json()["user"]["email"] == "a@b.gr"
    c.post("/api/auth/logout")
    assert c.get("/api/auth/me").status_code == 401
    assert c.post("/api/auth/login", json={"email": "a@b.gr", "password": "wrong-pass"}).status_code == 401
    r = c.post("/api/auth/login", json={"email": "a@b.gr", "password": "longenough"})
    assert r.status_code == 200
    # Bearer token works too (mobile / API use)
    c.cookies.clear()
    assert c.get("/api/auth/me", headers={"Authorization": f"Bearer {r.json()['token']}"}).status_code == 200


def test_tenant_isolation(client, other_client):
    inv = client.post("/api/invoices", json={"client_name": "Acme", "items": [{"description": "x", "qty": 1, "unit_price": 10}]}).json()
    exp = client.post("/api/expenses", json={"vendor_name": "Shell", "net": 10, "vat": 2.4}).json()
    assert other_client.get("/api/invoices").json() == []
    assert other_client.get("/api/expenses").json() == []
    assert other_client.get(f"/api/invoices/{inv['id']}").status_code == 404
    assert other_client.delete(f"/api/expenses/{exp['id']}").status_code == 404
    assert other_client.put(f"/api/invoices/{inv['id']}/status", json={"status": "paid"}).status_code == 404


def test_business_validation(client):
    assert client.put("/api/business", json={"afm": "123456789"}).status_code == 400
    assert client.put("/api/business", json={"iban": "GR00123"}).status_code == 400
    assert client.put("/api/business", json={"logo": "javascript:alert(1)"}).status_code == 400


def test_clients_and_quote_lifecycle(client, anon):
    c = client
    assert c.post("/api/clients", json={"name": "Bad", "afm": "123456789"}).status_code == 400
    cl = c.post("/api/clients", json={"name": "Kafeneio Plaka", "afm": CLIENT_AFM, "email": "k@p.gr"}).json()
    q = c.post("/api/documents", json={"doc_type": "quote", "client_id": cl["id"], "tax_rate": 24,
                                        "items": [{"description": "Rewire kitchen", "qty": 1, "unit_price": 500}]}).json()
    assert q["number"] == "QT-0001" and q["total"] == 620.0 and q["client_afm"] == CLIENT_AFM
    sent = c.post(f"/api/documents/{q['id']}/send").json()  # email not configured -> link still created
    assert not sent["emailed"] and "/q/" in sent["url"] and sent["document"]["status"] == "sent"
    token = sent["url"].rsplit("/", 1)[1]
    pub = c.get(f"/api/public/quotes/{token}").json()
    assert pub["quote"]["total"] == 620.0 and "org_id" not in pub["quote"]
    assert c.post(f"/api/public/quotes/{token}/respond", json={"action": "accept", "name": "Nikos"}).json()["status"] == "accepted"
    assert c.post(f"/api/public/quotes/{token}/respond", json={"action": "decline"}).status_code == 409
    assert c.put(f"/api/documents/{q['id']}", json={"doc_type": "quote", "client_id": cl["id"], "items": []}).status_code == 409
    assert any("accepted" in n["message"] for n in c.get("/api/notifications").json()["items"])

    so = c.post(f"/api/documents/{q['id']}/convert", json={"to": "sales_order"}).json()
    assert so["number"] == "SO-0001"
    assert c.post(f"/api/documents/{q['id']}/convert", json={"to": "sales_order"}).status_code == 409
    inv = c.post(f"/api/documents/{so['id']}/convert", json={"to": "invoice"}).json()
    full = c.get(f"/api/invoices/{inv['id']}").json()
    assert full["number"] == "INV-0001" and full["total"] == 620.0 and full["client_name"] == "Kafeneio Plaka" and full["status"] == "draft"
    assert c.post(f"/api/documents/{q['id']}/convert", json={"to": "expense"}).status_code == 400


def test_purchase_order_to_expense(client):
    c = client
    s = c.post("/api/suppliers", json={"name": "Hellas Cables", "afm": make_afm("23456781")}).json()
    po = c.post("/api/documents", json={"doc_type": "purchase_order", "supplier_id": s["id"], "tax_rate": 24,
                                         "items": [{"description": "Cable 3x2.5", "qty": 100, "unit_price": 1.2}]}).json()
    assert po["number"] == "PO-0001" and po["supplier_name"] == "Hellas Cables"
    exp = c.post(f"/api/documents/{po['id']}/convert", json={"to": "expense"}).json()
    e = next(x for x in c.get("/api/expenses").json() if x["id"] == exp["id"])
    assert e["total"] == 148.8 and e["supplier_id"] == s["id"] and e["payment_status"] == "unpaid"
    assert c.get("/api/documents?type=purchase_order").json()[0]["status"] == "received"


def test_numbers_never_reused(client):
    c = client
    a = c.post("/api/invoices", json={"client_name": "A", "items": []}).json()
    c.delete(f"/api/invoices/{a['id']}")
    b = c.post("/api/invoices", json={"client_name": "B", "items": []}).json()
    assert (a["number"], b["number"]) == ("INV-0001", "INV-0002")
