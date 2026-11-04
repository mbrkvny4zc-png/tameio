import time

from conftest import run


def _client(mdb, email, account_type="business", name="Person"):
    from fastapi.testclient import TestClient
    from app.main import create_app
    c = TestClient(create_app(with_lifespan=False))
    r = c.post("/api/auth/signup", json={"name": name, "email": email, "password": "long-password", "business_name": f"{name} Co", "account_type": account_type})
    assert r.status_code == 200, r.text
    c.user = r.json()["user"]
    return c


def test_invite_accountant_and_switch_business(client, mdb):
    owner = client
    acct = _client(mdb, "acct@books.gr", "accountant", "Eleni")
    assert acct.user["account_type"] == "accountant"
    # accountants' own org is a practice
    assert acct.get("/api/orgs").json()[0]["kind"] == "practice"

    inv = owner.post("/api/team/invites", json={"email": "acct@books.gr", "role": "accountant"}).json()
    token = inv["url"].rsplit("/", 1)[1]
    assert not inv["emailed"]
    info = acct.get(f"/api/public/invites/{token}").json()
    assert info["business"] == "Papadopoulos Electrical" and info["role"] == "accountant"
    # Wrong account can't accept
    stranger = _client(mdb, "x@y.gr")
    assert stranger.post(f"/api/invites/{token}/accept").status_code == 403
    r = acct.post(f"/api/invites/{token}/accept").json()
    org = r["org_id"]
    assert acct.post(f"/api/invites/{token}/accept").status_code == 404  # single use

    # The accountant sees both orgs and can work inside the client's
    orgs = acct.get("/api/orgs").json()
    assert {o["kind"] for o in orgs} == {"practice", "business"}
    owner.post("/api/invoices", json={"client_name": "Acme", "items": [{"description": "x", "qty": 1, "unit_price": 10}]})
    h = {"X-Org-Id": org}
    assert len(acct.get("/api/invoices", headers=h).json()) == 1
    assert acct.get("/api/invoices").json() == []  # own practice org by default
    # but can't manage the team, and can't open a business they don't belong to
    assert acct.post("/api/team/invites", json={"email": "z@z.gr", "role": "staff"}, headers=h).status_code == 403
    assert stranger.get("/api/invoices", headers=h).status_code == 403
    members = owner.get("/api/team/members").json()
    assert {m["role"] for m in members["members"]} == {"owner", "accountant"}
    assert any("joined as accountant" in n["message"] for n in owner.get("/api/notifications").json()["items"])


def test_roles_and_member_management(client, mdb):
    owner = client
    staff = _client(mdb, "staff@biz.gr", name="Nikos")
    run(mdb.orgs.update_many({"kind": "business"}, {"$set": {"plan": "business"}}))
    assert owner.post("/api/team/invites", json={"email": "staff@biz.gr", "role": "staff"}).status_code == 200
    token = run(mdb.invites.find_one({"email": "staff@biz.gr"}))["token"]
    org = staff.post(f"/api/invites/{token}/accept").json()["org_id"]
    h = {"X-Org-Id": org}
    assert staff.post("/api/invoices", json={"client_name": "A", "items": []}, headers=h).status_code == 200
    assert staff.put("/api/business", json={"business_name": "Hijack"}, headers=h).status_code == 403
    assert staff.put("/api/mydata/settings", json={"environment": "simulation"}, headers=h).status_code == 403
    assert owner.post("/api/team/invites", json={"email": "staff@biz.gr", "role": "staff"}).status_code == 409
    assert owner.post("/api/team/invites", json={"email": "bad", "role": "staff"}).status_code == 400
    owner.put(f"/api/team/members/{staff.user['id']}", json={"role": "admin"})
    assert staff.put("/api/business", json={"business_name": "Renamed"}, headers=h).status_code == 200
    assert owner.delete(f"/api/team/members/{client.get('/api/auth/me').json()['user']['id']}").status_code == 400  # owner can't be removed
    assert owner.delete(f"/api/team/members/{staff.user['id']}").status_code == 200
    assert staff.get("/api/invoices", headers=h).status_code == 403


def test_free_plan_limits(client, monkeypatch):
    c = client
    p = c.get("/api/plan").json()
    assert p["plan"] == "free" and p["limits"]["invoices_month"] == 10
    for i in range(10):
        assert c.post("/api/invoices", json={"client_name": f"C{i}", "items": []}).status_code == 200
    r = c.post("/api/invoices", json={"client_name": "One too many", "items": []})
    assert r.status_code == 402 and r.json()["detail"]["upgrade"]
    assert c.get("/api/plan").json()["usage"]["invoices_month"] == 10
    for i in range(3):
        assert c.post("/api/suppliers", json={"name": f"S{i}"}).status_code == 200
    assert c.post("/api/suppliers", json={"name": "S4"}).status_code == 402
    # free plan: 1 member (the owner) — but an accountant is always allowed
    assert c.post("/api/team/invites", json={"email": "s@s.gr", "role": "staff"}).status_code == 402
    assert c.post("/api/team/invites", json={"email": "a@a.gr", "role": "accountant"}).status_code == 200


def test_platform_admin_changes_plan(client, mdb, monkeypatch):
    from app import config
    org = client.get("/api/orgs").json()[0]["id"]
    assert client.put(f"/api/admin/orgs/{org}/plan", json={"plan": "team"}).status_code == 403
    monkeypatch.setattr(config, "PLATFORM_ADMINS", ["maria@example.gr"])
    assert client.put(f"/api/admin/orgs/{org}/plan", json={"plan": "team"}).status_code == 200
    assert client.get("/api/plan").json()["limits"]["invoices_month"] == -1


def test_two_factor_login(client):
    from app import totp
    c = client
    setup = c.post("/api/auth/2fa/setup").json()
    assert setup["otpauth_uri"].startswith("otpauth://totp/")
    assert c.post("/api/auth/2fa/enable", json={"code": "000000"}).status_code == 400
    assert c.post("/api/auth/2fa/enable", json={"code": totp.now_code(setup["secret"])}).status_code == 200
    c.post("/api/auth/logout")
    r = c.post("/api/auth/login", json={"email": "maria@example.gr", "password": "correct horse"})
    assert r.status_code == 401 and r.json()["detail"]["two_factor_required"]
    assert c.post("/api/auth/login", json={"email": "maria@example.gr", "password": "correct horse", "code": "123456"}).status_code == 401
    ok = c.post("/api/auth/login", json={"email": "maria@example.gr", "password": "correct horse", "code": totp.now_code(setup["secret"])})
    assert ok.status_code == 200 and ok.json()["user"]["two_factor"]
    assert c.post("/api/auth/2fa/disable", json={"code": totp.now_code(setup["secret"]), "password": "wrong"}).status_code == 400
    assert c.post("/api/auth/2fa/disable", json={"code": totp.now_code(setup["secret"]), "password": "correct horse"}).status_code == 200
