"""Business calendar: duties from every module, ticking off, the private .ics feed and daily reminders."""
from datetime import date, timedelta

from fastapi.testclient import TestClient

from conftest import CLIENT_AFM, run


def _soon(days):
    return (date.today() + timedelta(days=days)).isoformat()


def _setup(c):
    inv = c.post("/api/invoices", json={"client_name": "Acme", "client_afm": CLIENT_AFM, "status": "sent", "issue_date": date.today().isoformat(),
                                         "due_date": _soon(2), "items": [{"description": "Cable", "qty": 1, "unit_price": 100}]}).json()
    c.post("/api/expenses", json={"vendor_name": "ΔΕΗ", "category": "utilities", "net": 50, "vat": 3, "date": _soon(5), "payment_status": "unpaid"})
    q = c.post("/api/documents", json={"doc_type": "quote", "party_name": "Beta", "valid_until": _soon(10),
                                        "items": [{"description": "Job", "qty": 1, "unit_price": 300}]}).json()
    return inv, q


def test_agenda_collects_duties_from_every_module(client):
    c = client
    inv, q = _setup(c)
    r = c.get("/api/agenda")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    kinds = {i["kind"] for i in items}
    assert {"get_paid", "pay", "quote", "mydata"} <= kinds, kinds
    due = next(i for i in items if i["key"] == f"inv:{inv['id']}")
    assert due["date"] == _soon(2) and due["amount"] == 124.0 and "Acme" in due["title"] and due["link"] == "/app/invoices"
    assert any(i["key"] == f"quote:{q['id']}" and i["date"] == _soon(10) for i in items)
    assert any(i["kind"] == "tax" for i in items)  # VAT / e-EFKA deadlines are included too

    # Paying the invoice removes it on its own; ticking off works for anything.
    c.put(f"/api/invoices/{inv['id']}/status", json={"status": "paid"})
    items = c.get("/api/agenda").json()["items"]
    assert not any(i["key"] == f"inv:{inv['id']}" for i in items)
    assert c.post("/api/agenda/done", json={"key": f"quote:{q['id']}"}).status_code == 200
    assert next(i for i in c.get("/api/agenda").json()["items"] if i["key"] == f"quote:{q['id']}")["done"] is True
    assert c.get("/api/agenda?start=2026-01-01&end=2028-06-01").status_code == 400  # over a year


def test_overdue_items_stay_visible(client):
    c = client
    past = (date.today() - timedelta(days=40)).isoformat()
    c.post("/api/expenses", json={"vendor_name": "Old bill", "category": "other", "net": 10, "vat": 0, "date": past, "payment_status": "unpaid"})
    items = c.get(f"/api/agenda?start={date.today().isoformat()}").json()["items"]
    old = next(i for i in items if "Old bill" in i["title"])
    assert old["overdue"] is True and old["date"] == past


def test_calendar_feed_is_private_and_valid_ics(client, mdb):
    c = client
    _setup(c)
    assert c.get("/api/agenda/settings").json()["feed_url"] is None
    url = c.post("/api/agenda/feed", json={"lang": "en"}).json()["feed_url"]
    path = url.split("://", 1)[1].split("/", 1)[1]
    anon = TestClient(c.app)  # calendar apps have no login
    r = anon.get("/" + path)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert "SUMMARY:Payment due: INV-" in body and "DTSTART;VALUE=DATE:" in body and "TRIGGER:-P3D" in body
    assert all(len(line.encode()) <= 75 for line in body.split("\r\n"))
    assert anon.get("/api/calendar/not-a-real-token-at-all-xxxxx.ics").status_code == 404

    # A new link replaces the old one; turning it off kills it.
    url2 = c.post("/api/agenda/feed", json={"lang": "el"}).json()["feed_url"]
    assert url2 != url and anon.get("/" + path).status_code == 404
    path2 = url2.split("://", 1)[1].split("/", 1)[1]
    assert "SUMMARY:Είσπραξη" in anon.get("/" + path2).text
    c.delete("/api/agenda/feed")
    assert anon.get("/" + path2).status_code == 404


def test_feed_respects_chosen_kinds(client):
    c = client
    _setup(c)
    assert c.put("/api/agenda/settings", json={"remind_days": 0, "email": False, "kinds": ["get_paid"], "lang": "en"}).status_code == 200
    url = c.post("/api/agenda/feed", json={"lang": "en"}).json()["feed_url"]
    body = TestClient(c.app).get("/" + url.split("://", 1)[1].split("/", 1)[1]).text
    assert "Payment due" in body and "Quote expires" not in body and "VALARM" not in body
    assert c.put("/api/agenda/settings", json={"remind_days": 2}).status_code == 400


def test_daily_reminders_once_per_day(client, mdb, monkeypatch):
    from app.routers import agenda
    sent = []

    async def fake_send(to, subject, html, reply_to=""):
        sent.append((to, subject))
        return True
    monkeypatch.setattr(agenda, "send", fake_send)
    _setup(client)
    assert run(agenda.agenda_reminders()) == 1
    assert run(agenda.agenda_reminders()) == 0  # not twice on the same day
    notes = client.get("/api/notifications").json()["items"]
    assert any(n["type"] == "agenda" and "due soon" in n["message"] for n in notes)
    assert sent and sent[0][0] == "maria@example.gr"


def test_ics_text_escaping_and_folding():
    from app.routers.agenda import _fold, _ics_text
    assert _ics_text("a, b; c\nd") == "a\\, b\\; c\\nd"
    long = "SUMMARY:" + "Είσπραξη " * 20
    folded = _fold(long)
    assert all(len(x.encode()) <= 75 for x in folded.split("\r\n")) and folded.replace("\r\n ", "") == long


def test_menu_count_overdue_and_today(client):
    c = client
    past = (date.today() - timedelta(days=3)).isoformat()
    c.post("/api/expenses", json={"vendor_name": "Late", "category": "other", "net": 10, "vat": 0, "date": past, "payment_status": "unpaid"})
    r = c.get("/api/agenda/count").json()
    assert r["overdue"] >= 1 and r["due"] >= r["overdue"]
    c.put("/api/agenda/settings", json={"remind_days": 3, "email": True, "kinds": ["get_paid"]})
    assert c.get("/api/agenda/count").json()["overdue"] == 0  # bills not followed any more
