"""Partner programme: referral codes, first-touch attribution, revenue share and payouts."""
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from conftest import run


@pytest.fixture()
def firm(mdb):
    from app.main import create_app
    c = TestClient(create_app(with_lifespan=False))
    r = c.post("/api/auth/signup", json={"name": "Eleni", "email": "eleni@logistiko.gr", "password": "correct horse",
                                          "business_name": "Λογιστικό Γραφείο Παπαδόπουλος", "account_type": "accountant"})
    assert r.status_code == 200, r.text
    c.db = mdb
    return c


@pytest.fixture()
def admin(mdb, monkeypatch):
    from app import config
    from app.main import create_app
    monkeypatch.setattr(config, "PLATFORM_ADMINS", ["boss@tameio.gr"])
    c = TestClient(create_app(with_lifespan=False))
    c.post("/api/auth/signup", json={"name": "Boss", "email": "boss@tameio.gr", "password": "correct horse"})
    return c


def _business(mdb, email, ref=""):
    from app.main import create_app
    c = TestClient(create_app(with_lifespan=False))
    r = c.post("/api/auth/signup", json={"name": "Owner", "email": email, "password": "correct horse", "business_name": email.split("@")[0], "ref": ref})
    assert r.status_code == 200, r.text
    return c, r.json()["user"]["org_id"]


def test_code_link_and_custom_code(firm, client):
    p = firm.get("/api/partner").json()
    assert p["code"].startswith("LOGISTIKOGR-") or "-" in p["code"]
    assert p["link"].endswith("/r/" + p["code"]) and p["share_pct"] == 20
    assert firm.get(f"/api/public/ref/{p['code'].lower()}").json()["firm"] == "Λογιστικό Γραφείο Παπαδόπουλος"
    assert firm.put("/api/partner/code", json={"code": "Π!"}).status_code == 400
    assert firm.put("/api/partner/code", json={"code": "papadopoulos"}).json()["code"] == "PAPADOPOULOS"
    assert client.get("/api/partner").status_code == 403  # business accounts aren't partners


def test_attribution_paths_and_first_touch(firm, mdb):
    firm.put("/api/partner/code", json={"code": "PAPADOPOULOS"})
    # 1. sign-up through the link
    b1, org1 = _business(mdb, "bakery@example.gr", "papadopoulos")
    # 2. the firm sets the business up itself
    r = firm.post("/api/practice/clients", json={"business_name": "Ξυλουργείο Νίκος"})
    org2 = r.json()["org_id"]
    # 3. owner enters the code later; 4. no referral at all
    b3, org3 = _business(mdb, "florist@example.gr")
    assert b3.get("/api/referral").json()["can_add"]
    assert b3.post("/api/referral", json={"code": "NOPE"}).status_code == 404
    assert b3.post("/api/referral", json={"code": "PAPADOPOULOS"}).json()["firm"] == "Λογιστικό Γραφείο Παπαδόπουλος"
    assert b3.post("/api/referral", json={"code": "PAPADOPOULOS"}).status_code == 400  # only once
    _business(mdb, "other@example.gr")
    rep = firm.get("/api/partner").json()
    assert {c["org_id"]: c["source"] for c in rep["clients"]} == {org1: "link", org2: "added_by_firm", org3: "code"}
    # first touch: another firm can't take an attributed business
    from app.routers.partners import attribute
    assert run(attribute(org1, "someone-else", "link")) is False
    # code entry closes after 60 days
    old = (datetime.now(timezone.utc) - timedelta(days=61)).isoformat()
    b5, org5 = _business(mdb, "late@example.gr")
    run(mdb.orgs.update_one({"id": org5}, {"$set": {"created_at": old}}))
    assert b5.get("/api/referral").json()["can_add"] is False


def test_revenue_share_by_month_and_payouts(firm, admin, mdb):
    firm.put("/api/partner/code", json={"code": "PAPADOPOULOS"})
    _, org1 = _business(mdb, "a@example.gr", "PAPADOPOULOS")
    _, org2 = _business(mdb, "b@example.gr", "PAPADOPOULOS")
    _, org3 = _business(mdb, "c@example.gr", "PAPADOPOULOS")
    this = date.today().replace(day=1)
    last = (this - timedelta(days=1)).replace(day=1)
    two_ago = (last - timedelta(days=1)).replace(day=1)
    iso = lambda d: datetime(d.year, d.month, 10, tzinfo=timezone.utc).isoformat()  # noqa: E731
    start_this = datetime(this.year, this.month, 1, 0, 5, tzinfo=timezone.utc).isoformat()  # already past, whatever today is
    # org1 & org2 referred two months ago; org3 this month
    for o in (org1, org2):
        run(mdb.orgs.update_one({"id": o}, {"$set": {"referred_by.at": iso(two_ago), "created_at": iso(two_ago)}}))
    # org1: free -> business (19) last month; org2: free -> solo (9) two months ago -> free this month; org3: team (39)
    run(mdb.plan_changes.insert_many([
        {"org_id": org1, "from": "free", "plan": "business", "at": iso(last)},
        {"org_id": org2, "from": "free", "plan": "solo", "at": iso(two_ago)},
        {"org_id": org2, "from": "solo", "plan": "free", "at": start_this},
        {"org_id": org3, "from": "free", "plan": "team", "at": start_this},
    ]))
    run(mdb.orgs.update_one({"id": org1}, {"$set": {"plan": "business"}}))
    run(mdb.orgs.update_one({"id": org3}, {"$set": {"plan": "team"}}))
    rep = firm.get("/api/partner?months=3").json()
    m = {r["month"]: r for r in rep["months"]}
    k = lambda d: d.strftime("%Y-%m")  # noqa: E731
    assert (m[k(two_ago)]["revenue"], m[k(two_ago)]["paying_clients"]) == (9, 1)       # org2 solo
    assert (m[k(last)]["revenue"], m[k(last)]["share"]) == (28, 5.6)                    # org1 19 + org2 9
    assert (m[k(this)]["revenue"], m[k(this)]["share"]) == (58, 11.6)                   # org1 19 + org3 39 (org2 back to free)
    assert rep["totals"]["unpaid"] == 7.4 and rep["totals"]["paying"] == 2

    # platform admin: overview, share change, payouts
    assert firm.get("/api/admin/partners").status_code == 403
    allp = admin.get("/api/admin/partners").json()
    pid = allp[0]["org_id"]
    assert allp[0]["code"] == "PAPADOPOULOS"
    assert admin.post(f"/api/admin/partners/{pid}/payouts", json={"month": k(this)}).status_code == 400  # month not finished
    assert admin.post(f"/api/admin/partners/{pid}/payouts", json={"month": k(last)}).json()["amount"] == 5.6
    assert firm.get("/api/partner?months=3").json()["totals"]["unpaid"] == 1.8
    admin.put(f"/api/admin/partners/{pid}", json={"share_pct": 30})
    assert firm.get("/api/partner?months=3").json()["months"][-1]["share"] == 17.4
    csv_text = firm.get("/api/partner/report.csv").text
    assert "PAPADOPOULOS" not in csv_text.splitlines()[0] and "Share 30%" in csv_text

    # admin plan changes are logged for the maths
    admin.put(f"/api/admin/orgs/{org2}/plan", json={"plan": "solo"})
    assert run(mdb.plan_changes.count_documents({"org_id": org2})) == 3
