"""Customisable menu & dashboard (owner/admin) and personal pins."""


def test_layout_defaults_and_admin_only(client, other_client, mdb):
    c = client
    lay = c.get("/api/layout").json()
    assert lay["can_edit"] and lay["pins"] == [] and [w["id"] for w in lay["dashboard"]["widgets"]][0] == "pins"
    r = c.put("/api/layout", json={"nav": {"hidden": ["/app/quotes", "/app", "/app/settings", "javascript:alert(1)"], "main": ["/app/products"],
                                           "order": {"sales": ["/app/clients", "/app/invoices"]}}})
    assert r.status_code == 400  # unsafe path rejected
    r = c.put("/api/layout", json={"nav": {"hidden": ["/app/quotes", "/app", "/app/settings"], "main": ["/app/products"],
                                           "order": {"sales": ["/app/clients", "/app/invoices"]}},
                                   "dashboard": {"widgets": [{"id": "chart", "visible": False}, {"id": "stats"}, {"id": "bogus"}]}}).json()
    assert r["nav"]["hidden"] == ["/app/quotes"]  # Dashboard and Settings can't be hidden
    assert [w["id"] for w in r["dashboard"]["widgets"]][:2] == ["chart", "stats"] and r["dashboard"]["widgets"][0]["visible"] is False
    assert len(r["dashboard"]["widgets"]) == 7 and r["updated_by"] == "Maria"
    # the layout is per business: another business is untouched
    assert other_client.get("/api/layout").json()["nav"]["hidden"] == []
    assert c.delete("/api/layout?part=nav").json()["nav"]["hidden"] == []


def test_staff_cannot_edit_layout_but_can_pin(client, mdb):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from conftest import run
    c = client
    run(mdb.orgs.update_many({}, {"$set": {"plan": "business"}}))  # free plan allows one member
    inv = c.post("/api/team/invites", json={"email": "nikos@example.gr", "role": "staff"}).json()
    s = TestClient(create_app(with_lifespan=False))
    s.post("/api/auth/signup", json={"name": "Nikos", "email": "nikos@example.gr", "password": "correct horse"})
    token = inv["url"].rstrip("/").split("/")[-1]
    org_id = s.post(f"/api/invites/{token}/accept").json()["org_id"]
    s.headers["X-Org-Id"] = org_id
    assert s.get("/api/layout").json()["can_edit"] is False
    assert s.put("/api/layout", json={"nav": {"hidden": ["/app/quotes"]}}).status_code == 403
    assert s.post("/api/layout/pins", json={"label": "Unpaid", "to": "/app/invoices?filter=unpaid", "type": "search"}).json()["added"]
    assert c.get("/api/layout").json()["pins"] == []  # pins are personal


def test_pins_add_dedupe_reorder_remove_and_limits(client):
    c = client
    a = c.post("/api/layout/pins", json={"label": "Kafeneio Plaka", "to": "/app/clients?open=abc", "type": "client", "icon": "Users"}).json()
    assert a["added"] and a["pins"][0]["icon"] == "Users"
    assert c.post("/api/layout/pins", json={"label": "dup", "to": "/app/clients?open=abc"}).json()["added"] is False
    assert c.post("/api/layout/pins", json={"label": "Evil", "to": "https://evil.example/app"}).status_code == 400
    assert c.post("/api/layout/pins", json={"label": " ", "to": "/app/bank"}).status_code == 400
    b = c.post("/api/layout/pins", json={"label": "Overdue", "to": "/app/invoices?filter=overdue&q=INV", "type": "search"}).json()["pins"]
    re = c.put("/api/layout/pins", json={"items": [b[1], {**b[0], "label": "Plaka"}]}).json()["pins"]
    assert [p["label"] for p in re] == ["Overdue", "Plaka"]
    assert c.delete(f"/api/layout/pins/{re[0]['id']}").json()["pins"][0]["label"] == "Plaka"
    for i in range(15):
        c.post("/api/layout/pins", json={"label": f"p{i}", "to": f"/app/bank?x={i}"})
    assert c.post("/api/layout/pins", json={"label": "one too many", "to": "/app/reports"}).status_code == 400
