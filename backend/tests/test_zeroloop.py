"""Zeroloop connector: connect, sync open items, book set-offs from signed events or by pulling."""
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from conftest import CLIENT_AFM, VENDOR_AFM, run

WEBHOOK_SECRET = "whsec_test"


class FakeZeroloop:
    """Stands in for Zeroloop's Connector API."""

    def __init__(self):
        self.snapshots = []
        self.setoffs = []
        self.revoked = False
        self.clearing = []

    async def __call__(self, method, path, token=None, json=None, form=None):
        if path == "/api/connect/token":
            if form["code"] != "good-code" or form["client_secret"] != "zlsec":
                raise HTTPException(status_code=400, detail="Zeroloop: Invalid code.")
            return {"access_token": "zlc_secret_token", "connection_id": "con_1", "member": {"id": "mem_1", "name": "Papadopoulos Electrical", "vat_number": "EL094019245"}}
        assert token == "zlc_secret_token"
        if path == "/api/connect/v1/open-items":
            self.snapshots.append(json)
            return {"received": len(json["items"]), "invoices_created": 1, "outside": 1, "closed": 0, "mismatches": []}
        if path.startswith("/api/connect/v1/setoffs"):
            since = int(path.split("since=")[1])
            return {"setoffs": [s for s in self.setoffs if s["setoff_id"] > since]}
        if path == "/api/connect/v1/clearing":
            return {"items": self.clearing}
        if path == "/api/connect/v1/summary":
            return {"summary": {"cleared": 0, "pending_approvals": 2, "awaiting_payments": 0}}
        if path == "/api/connect/v1/login-link":
            return {"url": "https://zeroloop.example/console#login=zlln_x", "expires_in": 300}
        if path == "/api/connect/v1/connection":
            self.revoked = True
            return {"revoked": True}
        raise AssertionError(path)


@pytest.fixture()
def zl(client, monkeypatch):
    from app import config
    from app.routers import zeroloop
    monkeypatch.setattr(config, "ZEROLOOP_URL", "https://zeroloop.example")
    monkeypatch.setattr(config, "ZEROLOOP_CLIENT_ID", "zlapp_1")
    monkeypatch.setattr(config, "ZEROLOOP_CLIENT_SECRET", "zlsec")
    monkeypatch.setattr(config, "ZEROLOOP_WEBHOOK_SECRET", WEBHOOK_SECRET)
    fake = FakeZeroloop()
    monkeypatch.setattr(zeroloop, "_http", fake)
    return fake


def _inv(c, afm=CLIENT_AFM, price=100, **kw):
    r = c.post("/api/invoices", json={"client_name": "Acme", "client_company": "Acme AE", "client_afm": afm, "status": "sent", "tax_rate": 24,
                                       "items": [{"description": "Work", "qty": 1, "unit_price": price}], **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _connect(c, zl):
    url = c.post("/api/zeroloop/connect").json()["url"]
    q = parse_qs(urlparse(url).query)
    assert q["client_id"] == ["zlapp_1"] and q["vat_number"] == ["094019245"] and q["redirect_uri"][0].endswith("/api/zeroloop/callback")
    r = c.get(f"/api/zeroloop/callback?state={q['state'][0]}&code=good-code", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("zeroloop=connected"), r.headers["location"]
    return q["state"][0]


def _signed(body: dict, secret=WEBHOOK_SECRET, t=None):
    raw = json.dumps(body).encode()
    t = t or int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.".encode() + raw, hashlib.sha256).hexdigest()
    return raw, {"Zeroloop-Signature": f"t={t},v1={sig}", "Content-Type": "application/json"}


def test_hidden_until_configured(client):
    assert client.get("/api/zeroloop").json() == {"enabled": False, "connected": False, "member": None, "connected_at": None, "last_sync_at": None, "last_sync": None, "last_error": None}
    assert client.post("/api/zeroloop/connect").status_code == 400


def test_connect_stores_encrypted_token_and_sends_only_open_b2b_items(client, zl):
    c = client
    open_inv = _inv(c)                                    # €124 to a business → sent
    part = _inv(c, price=200)                             # €248, €48 paid → €200 open
    c.post(f"/api/invoices/{part['id']}/payments", json={"amount": 48})
    paid = _inv(c, price=50)
    c.post(f"/api/invoices/{paid['id']}/payments", json={"amount": 62})
    _inv(c, afm="")                                       # no ΑΦΜ: a consumer, never sent
    c.post("/api/invoices", json={"client_name": "Draft", "client_afm": CLIENT_AFM, "status": "draft", "items": [{"description": "x", "qty": 1, "unit_price": 10}]})
    c.post("/api/expenses", json={"vendor_name": "Timber AE", "vendor_afm": VENDOR_AFM, "net": 100, "vat": 24, "payment_status": "unpaid", "document_number": "T-77", "mark": "400000000000123"})
    c.post("/api/expenses", json={"vendor_name": "Paid supplier", "vendor_afm": VENDOR_AFM, "net": 10, "vat": 2.4, "payment_status": "paid"})

    _connect(c, zl)
    doc = run(c.db.zeroloop.find_one({}))
    assert doc["token_enc"] and "zlc_secret_token" not in json.dumps(doc, default=str)
    items = {i["external_id"]: i for i in zl.snapshots[-1]["items"]}
    assert zl.snapshots[-1]["complete"] is True
    assert set(items) == {f"inv:{open_inv['id']}", f"inv:{part['id']}", next(k for k in items if k.startswith("exp:"))}
    assert items[f"inv:{part['id']}"]["open"] == 200 and items[f"inv:{part['id']}"]["amount"] == 248
    assert items[f"inv:{open_inv['id']}"]["counterparty_vat"] == CLIENT_AFM and items[f"inv:{open_inv['id']}"]["direction"] == "receivable"
    exp = next(i for i in items.values() if i["direction"] == "payable")
    assert exp["counterparty_vat"] == VENDOR_AFM and exp["mark"] == "400000000000123" and exp["open"] == 124
    # Nothing beyond what clearing needs.
    assert not any(k in json.dumps(zl.snapshots[-1]) for k in ("Work", "unit_price", "items\": [{\"description"))

    st = c.get("/api/zeroloop").json()
    assert st["connected"] and st["member"]["name"] == "Papadopoulos Electrical" and st["summary"]["pending_approvals"] == 2
    assert c.post("/api/zeroloop/open").json()["url"].startswith("https://zeroloop.example/console#login=")


def test_state_must_match(client, zl):
    r = client.get("/api/zeroloop/callback?state=forged&code=good-code", follow_redirects=False)
    assert r.headers["location"].endswith("zeroloop=expired")
    state = parse_qs(urlparse(client.post("/api/zeroloop/connect").json()["url"]).query)["state"][0]
    assert client.get(f"/api/zeroloop/callback?state={state}&error=access_denied", follow_redirects=False).headers["location"].endswith("zeroloop=cancelled")
    # The state is single use.
    assert client.get(f"/api/zeroloop/callback?state={state}&code=good-code", follow_redirects=False).headers["location"].endswith("zeroloop=expired")


def test_signed_setoff_events_become_payments_and_are_idempotent(client, zl):
    c = client
    inv = _inv(c)                                          # €124
    c.post("/api/expenses", json={"vendor_name": "Timber AE", "vendor_afm": VENDOR_AFM, "net": 50, "vat": 12, "payment_status": "unpaid"})
    exp = c.get("/api/expenses").json()[0]
    _connect(c, zl)
    evt = {"id": "evt_1", "type": "setoffs.created", "connection_id": "con_1", "proposal": {"id": "prp_1", "kind": "loop", "amount": 62, "currency": "EUR"},
           "items": [{"external_id": f"inv:{inv['id']}", "amount": 100, "setoff_id": 7}, {"external_id": f"exp:{exp['id']}", "amount": 62, "setoff_id": 8}]}
    raw, headers = _signed(evt)
    assert c.post("/api/public/zeroloop/webhook", content=raw, headers={**headers, "Zeroloop-Signature": headers["Zeroloop-Signature"][:-1] + "0"}).status_code == 401
    r = c.post("/api/public/zeroloop/webhook", content=raw, headers=headers)
    assert r.status_code == 200 and r.json()["booked"] == 2, r.text
    assert c.post("/api/public/zeroloop/webhook", content=raw, headers=headers).json()["booked"] == 0, "same set-off twice"
    got = c.get(f"/api/invoices/{inv['id']}").json()
    assert got["balance"] == 24 and got["payments"][0]["method"] == "set_off" and "prp_1" in got["payments"][0]["note"]
    assert next(x for x in c.get("/api/expenses").json() if x["id"] == exp["id"])["payment_status"] == "paid"
    # A Zeroloop set-off can't be deleted from the invoice by accident.
    assert c.delete(f"/api/invoices/{inv['id']}/payments/{got['payments'][0]['id']}").status_code == 400
    # Next sync reports what's been booked, so Zeroloop doesn't count it twice; the paid expense drops out.
    c.post("/api/zeroloop/sync")
    items = {i["external_id"]: i for i in zl.snapshots[-1]["items"]}
    assert items[f"inv:{inv['id']}"]["open"] == 24 and items[f"inv:{inv['id']}"]["zeroloop_settled"] == 100
    assert f"exp:{exp['id']}" not in items
    # Old or replayed signatures are refused.
    raw2, h2 = _signed(evt, t=int(time.time()) - 3600)
    assert c.post("/api/public/zeroloop/webhook", content=raw2, headers=h2).status_code == 401


def test_pull_fallback_books_missed_events(client, zl):
    from app.routers import zeroloop
    c = client
    inv = _inv(c)
    _connect(c, zl)
    zl.setoffs = [{"setoff_id": 3, "proposal_id": "prp_9", "kind": "chain", "external_id": f"inv:{inv['id']}", "amount": 24, "created_at": "2026-11-18"}]
    org = run(c.db.zeroloop.find_one({}))["org_id"]
    assert run(zeroloop.pull_setoffs(org)) == 1
    assert run(zeroloop.pull_setoffs(org)) == 0
    got = c.get(f"/api/invoices/{inv['id']}").json()
    assert got["balance"] == 100 and "missing link" in got["payments"][0]["note"]
    assert run(c.db.zeroloop.find_one({}))["last_setoff_id"] == 3
    assert run(zeroloop.sync_all()) == 1


def test_disconnect(client, zl):
    _connect(client, zl)
    assert client.post("/api/zeroloop/disconnect").json()["ok"]
    assert zl.revoked and not client.get("/api/zeroloop").json()["connected"]
    assert client.post("/api/zeroloop/sync").status_code == 400


def test_bank_import_reports_zeroloop_payments_and_sync_shares_iban(client, zl):
    c = client
    received = []

    async def fake(method, path, token=None, json=None, form=None):
        if path == "/api/connect/v1/payments/received":
            received.append(json)
            return {"results": [{"reference": p["reference"], "status": "confirmed" if p["reference"] == "ZL-7KQ2MX" else "not_found"} for p in json["payments"]]}
        return await FakeZeroloop.__call__(zl, method, path, token, json, form)
    from app.routers import zeroloop
    import pytest as _pt
    _connect(c, zl)
    # The business's IBAN goes with the sync (set by the client fixture).
    assert zl.snapshots[-1]["profile"]["iban"].startswith("GR")
    mp = _pt.MonkeyPatch()
    mp.setattr(zeroloop, "_http", fake)
    try:
        csv = ("Ημερομηνία;Αιτιολογία;Ποσό\n"
               "20/11/2026;ΕΙΣΕΡΧΟΜΕΝΟ HYDRA INTERIORS zl 7kq2mx;2.000,00\n"
               "20/11/2026;ΠΛΗΡΩΜΗ ΠΡΟΣ ZL-ABCDEF;-50,00\n"
               "21/11/2026;ΚΑΤΑΘΕΣΗ ΧΩΡΙΣ ΚΩΔΙΚΟ;100,00\n").encode("cp1253")
        r = c.post("/api/bank/import", files={"file": ("statement.csv", csv, "text/csv")})
        assert r.status_code == 200, r.text
        assert r.json()["zeroloop_confirmed"] == 1
        # Only the incoming payment with a reference was reported, normalised.
        assert received == [{"payments": [{"reference": "ZL-7KQ2MX", "amount": 2000.0, "date": "2026-11-20"}]}]
        # Importing the same file again sends nothing (duplicates are skipped).
        assert c.post("/api/bank/import", files={"file": ("statement.csv", csv, "text/csv")}).json()["zeroloop_confirmed"] == 0
        assert len(received) == 1
    finally:
        mp.undo()


def test_bank_import_works_when_zeroloop_is_down(client, zl):
    from app.routers import zeroloop
    _connect(client, zl)

    async def down(*a, **k):
        raise RuntimeError("connection refused")
    import pytest as _pt
    mp = _pt.MonkeyPatch()
    mp.setattr(zeroloop, "_http", down)
    try:
        r = client.post("/api/bank/import", files={"file": ("s.csv", "Date;Description;Amount\n20/11/2026;ZL-7KQ2MX;10,00\n".encode(), "text/csv")})
        assert r.status_code == 200 and r.json()["added"] == 1 and r.json()["zeroloop_confirmed"] == 0
    finally:
        mp.undo()


def test_missing_link_payment_sides_are_booked_as_bank_transfers(client, zl):
    from app.routers import zeroloop
    c = client
    inv = _inv(c)                                          # €124 receivable: this business is the payee
    _connect(c, zl)
    zl.setoffs = [{"setoff_id": 11, "proposal_id": "prp_c", "kind": "chain", "reference": "ZL-7KQ2MX", "external_id": f"inv:{inv['id']}",
                   "amount": 124, "settled_by": "payment", "created_at": "2026-11-21"}]
    org = run(c.db.zeroloop.find_one({}))["org_id"]
    assert run(zeroloop.pull_setoffs(org)) == 1
    got = c.get(f"/api/invoices/{inv['id']}").json()
    assert got["status"] == "paid" and got["payments"][0]["method"] == "bank_transfer"
    assert "ZL-7KQ2MX" in got["payments"][0]["note"] and "bank transfer" in got["payments"][0]["note"]


def test_clear_before_you_chase_pauses_reminders_for_invoices_in_a_clearing(client, zl):
    from datetime import date, timedelta
    from app.routers import payments
    c = client
    past = dict(client_email="pay@acme.example", issue_date=(date.today() - timedelta(days=40)).isoformat(), due_date=(date.today() - timedelta(days=11)).isoformat())
    held, free = _inv(c, **past), _inv(c, **past)
    c.put("/api/payments/reminders", json={"enabled": True, "days": [3, 10]})
    _connect(c, zl)
    zl.clearing = [{"external_id": f"inv:{held['id']}", "side": "creditor", "proposal_id": "prp_1", "kind": "loop", "status": "pending",
                    "expires_at": "2026-12-01T00:00:00Z", "currency": "EUR", "amount": 80.0},
                   {"external_id": "exp:other", "side": "debtor", "proposal_id": "prp_1", "kind": "loop", "status": "pending", "expires_at": None, "currency": "EUR", "amount": 80.0}]
    assert c.get("/api/zeroloop/holds").json()["holds"] == {held["id"]: {"amount": 80.0, "status": "pending", "kind": "loop", "expires_at": "2026-12-01T00:00:00Z"}}

    assert run(payments.send_due_reminders()) == 1  # only the free invoice is chased
    assert not c.get(f"/api/invoices/{held['id']}").json().get("reminders")
    assert c.get(f"/api/invoices/{free['id']}").json()["reminders"]
    r = c.post(f"/api/invoices/{held['id']}/remind")
    assert r.status_code == 409 and "Zeroloop is clearing" in r.json()["detail"]
    assert c.post(f"/api/invoices/{held['id']}/remind?force=true").status_code == 200  # the owner can still insist

    zl.clearing = []  # the clearing ended without settling: chasing resumes
    assert run(payments.send_due_reminders()) == 1


def test_reminders_go_out_when_zeroloop_is_unreachable(client, zl, monkeypatch):
    from datetime import date, timedelta
    from app.routers import payments, zeroloop
    c = client
    inv = _inv(c, client_email="pay@acme.example", issue_date=(date.today() - timedelta(days=40)).isoformat(), due_date=(date.today() - timedelta(days=11)).isoformat())
    c.put("/api/payments/reminders", json={"enabled": True, "days": [3]})
    _connect(c, zl)

    async def down(*a, **k):
        raise HTTPException(status_code=502, detail="Zeroloop: 503")
    monkeypatch.setattr(zeroloop, "_http", down)
    assert run(payments.send_due_reminders()) == 1
    assert c.post(f"/api/invoices/{inv['id']}/remind").status_code == 200
