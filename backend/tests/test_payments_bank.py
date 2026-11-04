import io
from datetime import date, timedelta

from app.routers.bank import parse_amount, parse_date, parse_statement
from conftest import run


def _inv(c, **kw):
    r = c.post("/api/invoices", json={"client_name": "Acme", "client_email": "acme@x.gr", "status": "sent", "tax_rate": 24,
                                       "items": [{"description": "Work", "qty": 1, "unit_price": 100}], **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_viva_card_payment(client, monkeypatch):
    from app.routers import payments
    c = client
    assert c.put("/api/payments/viva", json={"enabled": True, "client_id": "id"}).status_code == 400
    s = c.put("/api/payments/viva", json={"enabled": True, "environment": "demo", "client_id": "cid", "client_secret": "zz-top-secret-99", "source_code": "1234"}).json()
    assert s["enabled"] and s["has_secret"] and "zz-top-secret-99" not in str(run(c.db.viva_settings.find_one({})))
    inv = _inv(c)
    token = c.post(f"/api/invoices/{inv['id']}/share").json()["url"].rsplit("/", 1)[1]
    assert c.get(f"/api/public/invoices/{token}/payment-options").json()["card"]

    orders = []

    async def fake_order(v, cents, desc, ref, email, name):
        orders.append((cents, ref))
        return "7012345678901234"

    async def fake_tx(v, tx_id):
        return {"statusId": "F", "orderCode": 7012345678901234, "amount": 124.0} if tx_id == "good" else {"statusId": "E", "orderCode": 7012345678901234, "amount": 124.0}
    monkeypatch.setattr(payments, "viva_create_order", fake_order)
    monkeypatch.setattr(payments, "viva_get_transaction", fake_tx)
    r = c.post(f"/api/public/invoices/{token}/pay").json()
    assert r["redirect_url"] == "https://demo.vivapayments.com/web/checkout?ref=7012345678901234" and orders == [(12400, inv["id"])]
    assert c.post("/api/public/payments/viva/confirm", json={"t": "bad", "s": "7012345678901234"}).json()["status"] == "not_paid"
    assert c.post("/api/public/payments/viva/confirm", json={"t": "x", "s": "unknown"}).status_code == 404
    assert c.post("/api/public/payments/viva/confirm", json={"t": "good", "s": "7012345678901234"}).json()["status"] == "paid"
    assert c.get(f"/api/invoices/{inv['id']}").json()["status"] == "paid"
    assert c.post(f"/api/public/invoices/{token}/pay").status_code == 409
    assert any("paid INV-0001 by card" in n["message"] for n in c.get("/api/notifications").json()["items"])


def test_underpaid_transaction_is_rejected(client, monkeypatch):
    from app.routers import payments
    c = client
    c.put("/api/payments/viva", json={"enabled": True, "client_id": "cid", "client_secret": "sec", "source_code": "1"})
    inv = _inv(c)
    token = c.post(f"/api/invoices/{inv['id']}/share").json()["url"].rsplit("/", 1)[1]

    async def fake_order(*a):
        return "1"

    async def fake_tx(v, tx_id):
        return {"statusId": "F", "orderCode": "1", "amount": 1.0}
    monkeypatch.setattr(payments, "viva_create_order", fake_order)
    monkeypatch.setattr(payments, "viva_get_transaction", fake_tx)
    c.post(f"/api/public/invoices/{token}/pay")
    assert c.post("/api/public/payments/viva/confirm", json={"t": "t", "s": "1"}).json()["status"] == "not_paid"
    assert c.get(f"/api/invoices/{inv['id']}").json()["status"] == "sent"


def test_payment_reminders(client):
    from app.routers import payments
    c = client
    due = (date.today() - timedelta(days=11)).isoformat()
    inv = _inv(c, issue_date=(date.today() - timedelta(days=40)).isoformat(), due_date=due)
    _inv(c, client_email="", issue_date=(date.today() - timedelta(days=40)).isoformat(), due_date=due)  # no email -> skipped
    assert run(payments.send_due_reminders()) == 0  # off by default
    assert c.put("/api/payments/reminders", json={"enabled": True, "days": []}).status_code == 400
    c.put("/api/payments/reminders", json={"enabled": True, "days": [3, 10, 21], "message": "Thanks!"})
    assert run(payments.send_due_reminders()) == 1
    assert run(payments.send_due_reminders()) == 0  # days 3 and 10 both recorded: one catch-up email
    later = (date.today() + timedelta(days=10)).isoformat()
    assert run(payments.send_due_reminders(later)) == 1  # day 21
    days = sorted(r["day"] for r in c.get(f"/api/invoices/{inv['id']}").json()["reminders"])
    assert days == [3, 10, 21]
    assert c.post(f"/api/invoices/{inv['id']}/remind").status_code == 200


def test_amount_and_date_parsing():
    assert parse_amount("1.234,56") == 1234.56 and parse_amount("-1,234.56") == -1234.56
    assert parse_amount("(45,00)") == -45.0 and parse_amount("12,5") == 12.5 and parse_amount("1,000") == 1000.0
    assert parse_amount("€ 62,00-") == -62.0 and parse_amount("") is None
    assert parse_date("03/11/2026") == "2026-11-03" and parse_date("2026-11-03") == "2026-11-03" and parse_date("x") is None


GREEK_CSV = ("ΚΙΝΗΣΕΙΣ ΛΟΓΑΡΙΑΣΜΟΥ GR16...;;;\n"
             "Ημερομηνία;Αιτιολογία;Χρέωση;Πίστωση\n"
             "{d1};ΜΕΤΑΦΟΡΑ ΑΠΟ ACME INV-0001;;124,00\n"
             "{d2};SHELL KIFISIAS;62,00;\n"
             "{d2};COSMOTE ΛΟΓ/ΣΜΟΣ;49,60;\n"
             "{d3};ΚΑΤΑΘΕΣΗ ΜΕΤΡΗΤΩΝ;;1.500,00\n")


def test_bank_import_and_matching(client):
    c = client
    t = date.today()
    d1, d2, d3 = (t - timedelta(days=3)).strftime("%d/%m/%Y"), (t - timedelta(days=2)).strftime("%d/%m/%Y"), t.strftime("%d/%m/%Y")
    inv = _inv(c)
    exp = c.post("/api/expenses", json={"vendor_name": "Shell", "net": 50, "vat": 12, "payment_status": "unpaid", "date": (t - timedelta(days=2)).isoformat()}).json()
    data = GREEK_CSV.format(d1=d1, d2=d2, d3=d3).encode("cp1253")
    rows = parse_statement(data)
    assert len(rows) == 4 and rows[0]["amount"] == 124.0 and rows[1]["amount"] == -62.0 and rows[3]["amount"] == 1500.0
    r = c.post("/api/bank/import", files={"file": ("statement.csv", io.BytesIO(data), "text/csv")}).json()
    assert r == {"added": 4, "duplicates": 0, "matched": 2}
    assert c.post("/api/bank/import", files={"file": ("statement.csv", io.BytesIO(data), "text/csv")}).json()["duplicates"] == 4
    assert c.get(f"/api/invoices/{inv['id']}").json()["status"] == "paid"
    assert next(x for x in c.get("/api/expenses").json() if x["id"] == exp["id"])["payment_status"] == "paid"
    txns = c.get("/api/bank/transactions").json()["items"]
    cosmote = next(x for x in txns if "COSMOTE" in x["description"])
    cash = next(x for x in txns if x["amount"] == 1500)
    # Missing receipts: unmatched outgoing payments
    period = t.strftime("%Y-%m")
    missing = c.get(f"/api/receipts/missing?period={period}").json()
    assert [m["description"] for m in missing if m["kind"] == "bank"] == ["COSMOTE ΛΟΓ/ΣΜΟΣ"]
    created = c.post(f"/api/bank/transactions/{cosmote['id']}/create-expense", json={"category": "telecom", "vendor_name": "Cosmote"}).json()
    assert created["number"].startswith("EXP-")
    assert c.post(f"/api/bank/transactions/{cash['id']}/create-expense", json={}).status_code == 400
    c.put(f"/api/bank/transactions/{cash['id']}/ignore", json={"ignored": True})
    assert all(x["match"] or x["ignored"] for x in c.get("/api/bank/transactions").json()["items"])
    bad = c.post("/api/bank/import", files={"file": ("x.csv", io.BytesIO(b"foo,bar\n1,2\n"), "text/csv")})
    assert bad.status_code == 400 and "date column" in bad.json()["detail"]
