"""Sign-up records acceptance of the legal documents; the legal pages get the operator's details."""
from app import config


def test_signup_requires_accepting_the_terms(anon):
    r = anon.post("/api/auth/signup", json={"name": "Nikos", "email": "nikos@example.gr", "password": "correct horse", "business_name": "N"})
    assert r.status_code == 400 and "Terms" in r.json()["detail"]
    r = anon.post("/api/auth/signup", json={"accept_terms": True, "name": "Nikos", "email": "nikos@example.gr", "password": "correct horse", "business_name": "N"})
    assert r.status_code == 200, r.text
    u = anon.db.users  # mongomock collection
    import asyncio
    doc = asyncio.run(u.find_one({"email": "nikos@example.gr"}))
    assert doc["terms_accepted"]["version"] == config.LEGAL_VERSION and doc["terms_accepted"]["at"]


def test_company_details_for_legal_pages(anon, monkeypatch):
    monkeypatch.setitem(config.LEGAL, "company", "Example Λογιστική ΙΚΕ")
    r = anon.get("/api/auth/legal/company").json()
    assert r["company"] == "Example Λογιστική ΙΚΕ" and r["version"] == config.LEGAL_VERSION and "afm" in r


def test_old_logs_are_purged(mdb):
    from datetime import datetime, timedelta, timezone
    from conftest import run
    from app.routers import admin
    old = (datetime.now(timezone.utc) - timedelta(days=120)).isoformat()
    new = datetime.now(timezone.utc).isoformat()
    run(mdb.error_log.insert_many([{"key": "a", "last_seen": old}, {"key": "b", "last_seen": new}]))
    run(mdb.automation_runs.insert_many([{"name": "x", "started_at": old}, {"name": "y", "started_at": new}]))
    assert run(admin.purge_logs()) == 2
    assert run(mdb.error_log.count_documents({})) == 1 and run(mdb.automation_runs.count_documents({})) == 1
