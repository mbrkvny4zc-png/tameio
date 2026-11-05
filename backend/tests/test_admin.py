"""Creator-only management area, feedback/bug reports, crash capture and automations."""
import pytest
from fastapi.testclient import TestClient

from conftest import run


@pytest.fixture()
def owner(mdb, monkeypatch):
    from app import config
    from app.main import create_app
    monkeypatch.setattr(config, "OWNER_EMAIL", "creator@example.com")
    monkeypatch.setattr(config, "PLATFORM_ADMINS", ["creator@example.com"])
    c = TestClient(create_app(with_lifespan=False))
    assert c.post("/api/auth/signup", json={"name": "Creator", "email": "creator@example.com", "password": "correct horse"}).status_code == 200
    return c


def test_owner_only_and_overview(owner, client):
    assert client.get("/api/admin/overview").status_code == 403
    assert client.get("/api/admin/users").status_code == 403
    assert owner.get("/api/auth/me").json()["user"]["platform_admin"] is True
    assert client.get("/api/auth/me").json()["user"]["platform_admin"] is False
    client.post("/api/invoices", json={"client_name": "A", "status": "sent", "items": [{"description": "x", "qty": 1, "unit_price": 100}]})
    ov = owner.get("/api/admin/overview?days=30").json()
    assert ov["users"]["total"] == 2 and ov["orgs"]["businesses"] == 2 and ov["usage"]["invoices"] == 1
    assert ov["usage"]["invoiced_value"] == 124.0 and len(ov["signups"]) == 31 and ov["plans"]["free"] == 2
    users = owner.get("/api/admin/users?q=maria").json()
    assert len(users) == 1 and users[0]["orgs"][0]["name"] == "Papadopoulos Electrical" and "password" not in users[0]


def test_feedback_flow_with_reply_notification(owner, client):
    assert client.post("/api/feedback", json={"message": "hi"}).status_code == 400
    r = client.post("/api/feedback", json={"kind": "bug", "message": "The print button opens a blank page", "page": "/app/invoices"}).json()
    assert r["number"] == 1 and r["status"] == "new"
    assert client.post("/api/feedback", json={"message": "x" * 10, "screenshot": "javascript:alert(1)"}).status_code == 400
    assert client.get("/api/admin/feedback").status_code == 403
    allfb = owner.get("/api/admin/feedback?status=new").json()
    assert allfb[0]["email"] == "maria@example.gr"
    upd = owner.put(f"/api/admin/feedback/{r['id']}", json={"status": "fixed", "reply": "Fixed — thanks!"}).json()
    assert upd["status"] == "fixed" and upd["replies"][0]["text"] == "Fixed — thanks!"
    mine = client.get("/api/feedback").json()
    assert mine[0]["status"] == "fixed"
    assert any("#1 is fixed" in n["message"] for n in client.get("/api/notifications").json()["items"])


def test_crash_capture_groups_repeats(owner, anon):
    for _ in range(3):
        assert anon.post("/api/errors", json={"message": "TypeError: x is undefined", "stack": "at Invoices.jsx:10\nat render", "page": "/app/invoices"}).json()["ok"]
    errs = owner.get("/api/admin/errors").json()
    assert len(errs) == 1 and errs[0]["count"] == 3 and errs[0]["source"] == "frontend"
    owner.put(f"/api/admin/errors/{errs[0]['key']}", json={"status": "resolved"})
    assert owner.get("/api/admin/errors").json() == []


def test_backend_crash_is_logged_and_friendly(owner, client, monkeypatch):
    from app.routers import reports

    async def boom(*a, **k):
        raise RuntimeError("database fell over")
    monkeypatch.setattr(reports, "compute_summary", boom)
    r = client.get("/api/reports/summary")
    assert r.status_code == 500 and "reported" in r.json()["detail"]
    errs = owner.get("/api/admin/errors").json()
    assert errs[0]["source"] == "backend" and "database fell over" in errs[0]["message"] and errs[0]["last_page"] == "GET /api/reports/summary"


def test_automations_run_toggle_and_log(owner, client):
    from app.routers import admin
    a = owner.get("/api/admin/automations").json()
    assert {x["name"] for x in a["automations"]} >= {"overdue", "recurring", "payment_reminders", "error_digest"}
    run_ = owner.post("/api/admin/automations/overdue/run").json()
    assert run_["ok"] and run_["trigger"] == "manual"
    owner.put("/api/admin/automations/recurring", json={"enabled": False})
    out = run(admin.run_all())
    assert "recurring" not in out and "overdue" in out
    listed = {x["name"]: x for x in owner.get("/api/admin/automations").json()["automations"]}
    assert listed["recurring"]["enabled"] is False and listed["overdue"]["last_run"]["ok"]
    assert client.post("/api/admin/automations/overdue/run").status_code == 403
