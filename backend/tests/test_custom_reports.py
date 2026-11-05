"""Custom reports: build, run, save, share, schedule and send."""
from datetime import date

from conftest import CLIENT_AFM, run


def _setup(c):
    a = c.post("/api/clients", json={"name": "Acme", "afm": CLIENT_AFM}).json()
    b = c.post("/api/clients", json={"name": "Beta"}).json()
    i1 = c.post("/api/invoices", json={"client_id": a["id"], "status": "sent", "items": [{"description": "Work", "qty": 2, "unit_price": 100}]}).json()  # 248
    c.post("/api/invoices", json={"client_id": a["id"], "status": "paid", "items": [{"description": "Work", "qty": 1, "unit_price": 50}]})          # 62
    c.post("/api/invoices", json={"client_id": b["id"], "status": "sent", "items": [{"description": "Panel", "qty": 3, "unit_price": 30}]})       # 111.6
    c.post("/api/invoices", json={"client_name": "Draft Co", "status": "draft", "items": [{"description": "x", "qty": 1, "unit_price": 999}]})
    c.post(f"/api/invoices/{i1['id']}/payments", json={"amount": 48, "method": "cash"})
    c.post("/api/expenses", json={"vendor_name": "Shell", "category": "fuel", "net": 40, "vat": 9.6})
    c.post("/api/expenses", json={"vendor_name": "COSMOTE", "category": "telecom", "net": 30, "vat": 7.2, "payment_status": "unpaid"})
    c.post("/api/receipts", json={"items": [{"description": "Coffee", "qty": 2, "unit_price": 2}], "tax_rate": 13, "payment": "cash"})
    return a, b


def test_run_groupings_and_sources(client):
    c = client
    _setup(c)
    r = c.post("/api/custom-reports/run", json={"source": "invoices", "period": "this_month", "group_by": "client", "metrics": ["count", "net", "total", "balance"]}).json()
    rows = {x["key"]: x for x in r["rows"]}
    assert set(rows) == {"Acme", "Beta"}  # drafts excluded
    assert rows["Acme"]["count"] == 2 and rows["Acme"]["net"] == 250 and rows["Acme"]["balance"] == 200
    assert r["totals"]["total"] == 421.6 and r["rows"][0]["key"] == "Acme"  # sorted by value
    unpaid = c.post("/api/custom-reports/run", json={"source": "unpaid", "period": "all_time", "group_by": "client", "metrics": ["balance"]}).json()
    assert {x["key"]: x["balance"] for x in unpaid["rows"]} == {"Acme": 200, "Beta": 111.6}
    exp = c.post("/api/custom-reports/run", json={"source": "expenses", "group_by": "category", "metrics": ["total"], "status": "unpaid"}).json()
    assert [x["key"] for x in exp["rows"]] == ["Phone & internet"]
    pay = c.post("/api/custom-reports/run", json={"source": "payments", "group_by": "payment_method", "metrics": ["count", "amount"]}).json()
    assert {x["key"]: x["amount"] for x in pay["rows"]} == {"cash": 48, "bank_transfer": 62}
    prod = c.post("/api/custom-reports/run", json={"source": "sales_by_product", "period": "this_year", "group_by": "product", "metrics": ["qty", "net"]}).json()
    assert {x["key"]: x["qty"] for x in prod["rows"]}["Panel"] == 3
    rec = c.post("/api/custom-reports/run", json={"source": "receipts", "group_by": "day", "metrics": ["count", "total"]}).json()
    assert rec["totals"] == {"count": 1, "total": 4.52}
    lst = c.post("/api/custom-reports/run", json={"source": "invoices", "group_by": "none", "metrics": ["total"]}).json()
    assert len(lst["rows"]) == 3 and lst["rows"][0]["key"].startswith("INV-")
    # bad inputs are corrected, not crashing
    fix = c.post("/api/custom-reports/run", json={"source": "expenses", "group_by": "client", "metrics": ["paid", "nope"]}).json()
    assert fix["group_by"] == "month" and fix["metrics"] == ["count", "net"]
    assert c.post("/api/custom-reports/run", json={"source": "nope"}).status_code == 400
    assert c.post("/api/custom-reports/run", json={"period": "custom", "start": "2026-02-01", "end": "2026-01-01"}).status_code == 400


def test_period_ranges():
    from app.routers.custom_reports import period_range
    ref = date(2026, 11, 5)
    assert period_range("last_month", ref=ref) == ("2026-10-01", "2026-10-31")
    assert period_range("this_quarter", ref=ref) == ("2026-10-01", "2026-11-05")
    assert period_range("last_quarter", ref=ref) == ("2026-07-01", "2026-09-30")
    assert period_range("last_quarter", ref=date(2026, 2, 10)) == ("2025-10-01", "2025-12-31")
    assert period_range("last_year", ref=ref) == ("2025-01-01", "2025-12-31")


def test_save_share_schedule_send(client, other_client, mdb):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.routers import custom_reports
    c = client
    _setup(c)
    run(mdb.orgs.update_many({}, {"$set": {"plan": "business"}}))
    me = c.get("/api/auth/me").json()["user"]
    assert c.post("/api/custom-reports", json={"source": "invoices", "name": " "}).status_code == 400
    assert c.post("/api/custom-reports", json={"name": "Weekly", "schedule": "weekly"}).status_code == 400  # needs recipients
    rep = c.post("/api/custom-reports", json={"name": "Sales by client", "source": "invoices", "group_by": "client", "metrics": ["total"],
                                             "shared": True, "schedule": "weekly", "recipients": [me["id"], "not-a-member"]}).json()
    assert rep["recipients"] == [me["id"]]
    assert c.get(f"/api/custom-reports/{rep['id']}/run").json()["totals"]["total"] == 421.6
    csv_text = c.get(f"/api/custom-reports/{rep['id']}/csv").text
    assert "Acme" in csv_text and "Total" in csv_text
    assert other_client.get(f"/api/custom-reports/{rep['id']}/run").status_code == 404  # other business can't see it
    # a staff member sees the shared report but can't share their own
    inv = c.post("/api/team/invites", json={"email": "nikos@example.gr", "role": "staff"}).json()
    s = TestClient(create_app(with_lifespan=False))
    s.post("/api/auth/signup", json={"name": "Nikos", "email": "nikos@example.gr", "password": "correct horse"})
    s.headers["X-Org-Id"] = s.post(f"/api/invites/{inv['url'].rsplit('/', 1)[1]}/accept").json()["org_id"]
    assert [x["name"] for x in s.get("/api/custom-reports").json()] == ["Sales by client"]
    assert s.post("/api/custom-reports", json={"name": "Mine", "shared": True}).status_code == 403
    private = s.post("/api/custom-reports", json={"name": "Mine"}).json()
    assert private["id"] not in [x["id"] for x in c.get("/api/custom-reports").json()]
    assert s.delete(f"/api/custom-reports/{rep['id']}").status_code == 403
    # send now + the Monday automation
    assert c.post(f"/api/custom-reports/{rep['id']}/send").json()["recipients"] == 1
    assert any("Report ready: Sales by client" in n["message"] for n in c.get("/api/notifications").json()["items"])
    run(mdb.custom_reports.update_one({"id": rep["id"]}, {"$set": {"last_sent": None}}))
    assert run(custom_reports.send_scheduled(date(2026, 11, 9))) == 1   # a Monday
    assert run(custom_reports.send_scheduled(date(2026, 11, 9))) == 0   # not twice the same day
    assert run(custom_reports.send_scheduled(date(2026, 11, 10))) == 0  # Tuesday: weekly not due
