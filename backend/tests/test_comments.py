"""Comments with @mentions, personal notifications and the mentions inbox."""
from fastapi.testclient import TestClient

from conftest import run


def _staff(c, mdb, email="nikos@example.gr", name="Nikos Pappas", role="staff"):
    from app.main import create_app
    run(mdb.orgs.update_many({}, {"$set": {"plan": "business"}}))
    inv = c.post("/api/team/invites", json={"email": email, "role": role}).json()
    s = TestClient(create_app(with_lifespan=False))
    s.post("/api/auth/signup", json={"name": name, "email": email, "password": "correct horse"})
    s.headers["X-Org-Id"] = s.post(f"/api/invites/{inv['url'].rsplit('/', 1)[1]}/accept").json()["org_id"]
    return s, s.get("/api/auth/me").json()["user"]["id"]


def test_thread_mentions_notifications_inbox(client, other_client, mdb):
    c = client
    s, nikos = _staff(c, mdb)
    inv = c.post("/api/invoices", json={"client_name": "Acme", "status": "sent", "items": [{"description": "x", "qty": 1, "unit_price": 10}]}).json()
    assert [p["name"] for p in c.get("/api/comments/people").json()] == ["Nikos Pappas"]
    assert c.post("/api/comments", json={"target_type": "invoice", "target_id": inv["id"], "text": " "}).status_code == 400
    assert c.post("/api/comments", json={"target_type": "invoice", "target_id": "nope", "text": "hi"}).status_code == 404
    assert c.post("/api/comments", json={"target_type": "secret", "target_id": inv["id"], "text": "hi"}).status_code == 400
    cm = c.post("/api/comments", json={"target_type": "invoice", "target_id": inv["id"], "text": "@Nikos did Acme pay this?", "mentions": [nikos, "stranger"]}).json()
    assert cm["mentions"] == [nikos] and cm["target_label"].startswith("INV-")
    # typed @Name without picking from the list is also caught
    cm2 = c.post("/api/comments", json={"target_type": "invoice", "target_id": inv["id"], "text": "cc @nikos pappas please"}).json()
    assert cm2["mentions"] == [nikos]
    # personal notification: Nikos sees it, the owner doesn't
    assert any("mentioned you" in n["message"] for n in s.get("/api/notifications").json()["items"])
    assert not any("mentioned you" in n["message"] for n in c.get("/api/notifications").json()["items"])
    assert s.get("/api/mentions/count").json()["open"] == 2
    box = s.get("/api/mentions").json()
    assert box[0]["target_page"] == "/app/invoices" and not box[0]["done"]
    s.post(f"/api/mentions/{cm['id']}/done", json={"done": True})
    assert s.get("/api/mentions/count").json()["open"] == 1 and len(s.get("/api/mentions?status=done").json()) == 1
    # reply, thread order, counts
    s.post("/api/comments", json={"target_type": "invoice", "target_id": inv["id"], "text": "Yes, paid by bank yesterday @Maria"})
    th = c.get(f"/api/comments?target_type=invoice&target_id={inv['id']}").json()
    assert [x["author_name"] for x in th["comments"]] == ["Maria", "Maria", "Nikos Pappas"] and th["comments"][2]["mentions_me"]
    assert c.get("/api/comments/counts?target_type=invoice").json() == {inv["id"]: 3}
    # other businesses can't read or post
    assert other_client.get(f"/api/comments?target_type=invoice&target_id={inv['id']}").status_code == 404
    # edit/delete permissions
    assert s.put(f"/api/comments/{cm['id']}", json={"text": "hacked"}).status_code == 403
    assert c.put(f"/api/comments/{cm['id']}", json={"text": "@Nikos did Acme pay? (edited)"}).json()["edited_at"]
    staff_comment = th["comments"][2]["id"]
    assert s.delete(f"/api/comments/{cm['id']}").status_code == 403
    assert c.delete(f"/api/comments/{staff_comment}").json()["ok"]  # owner can moderate


def test_comments_on_other_records(client, mdb):
    c = client
    cl = c.post("/api/clients", json={"name": "Kafeneio"}).json()
    ex = c.post("/api/expenses", json={"vendor_name": "Shell", "category": "fuel", "net": 10, "vat": 2.4}).json()
    for ttype, tid in (("client", cl["id"]), ("expense", ex["id"])):
        r = c.post("/api/comments", json={"target_type": ttype, "target_id": tid, "text": "note"})
        assert r.status_code == 200, (ttype, r.text)
    assert c.get(f"/api/comments?target_type=client&target_id={cl['id']}").json()["target"]["label"] == "Kafeneio"
