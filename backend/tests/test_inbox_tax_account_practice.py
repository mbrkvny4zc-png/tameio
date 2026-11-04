import base64
import io
import json
import zipfile
from datetime import date

import pytest

from conftest import CLIENT_AFM, make_afm, run
from test_expenses_scan_reports import JPEG, RECEIPT


@pytest.fixture()
def inbound(monkeypatch):
    from app import ai, config
    monkeypatch.setattr(config, "INBOUND_DOMAIN", "in.tameio.test")
    monkeypatch.setattr(config, "INBOUND_SECRET", "s3cret")

    async def fake(data, media_type, biz):
        return dict(RECEIPT)
    monkeypatch.setattr(ai, "extract_document", fake)


def test_email_inbox(client, inbound):
    c = client
    a = c.get("/api/inbox/address").json()
    assert a["configured"] and a["address"].startswith("receipts+") and a["address"].endswith("@in.tameio.test")
    payload = {"To": f"Receipts <{a['address']}>", "From": "Maria <maria@example.gr>", "Subject": "Fuel",
               "Attachments": [{"Name": "r.jpg", "ContentType": "image/jpeg", "Content": base64.b64encode(JPEG).decode()},
                               {"Name": "invite.ics", "ContentType": "text/calendar", "Content": base64.b64encode(b"BEGIN:VCALENDAR").decode()}]}
    assert c.post("/api/inbound/email", json=payload).status_code == 401
    assert c.post("/api/inbound/email", json=payload, headers={"X-Inbound-Secret": "wrong"}).status_code == 401
    r = c.post("/api/inbound/email", json=payload, headers={"X-Inbound-Secret": "s3cret"}).json()
    assert r["accepted"] == 1 and len(r["skipped"]) == 1
    pending = c.get("/api/scans/pending").json()
    assert len(pending) == 1 and pending[0]["source"] == "email" and pending[0]["suggestion"]["target"] == "expense"
    # Strangers can't drop files into your books; allow-listed senders can
    stranger = {**payload, "From": "spam@bad.example"}
    assert c.post("/api/inbound/email?secret=s3cret", json=stranger).json()["reason"] == "sender not allowed"
    c.put("/api/inbox/senders", json={"allowed": ["@shell.gr", "not-an-email"]})
    assert c.post("/api/inbound/email?secret=s3cret", json={**payload, "From": "e-receipts@shell.gr"}).json()["accepted"] == 1
    # Generic shape + unknown inbox
    assert c.post("/api/inbound/email?secret=s3cret", json={"to": "receipts+doesnotexist123@in.tameio.test", "from": "x@y.z"}).json()["accepted"] == 0
    c.post(f"/api/scans/{pending[0]['id']}/dismiss")
    assert len(c.get("/api/scans/pending").json()) == 1
    assert any("arrived by email" in n["message"] for n in c.get("/api/notifications").json()["items"])


def test_tax_calendar(client):
    from app.routers import taxes
    c = client
    assert taxes.last_working_day(2026, 1).isoformat() == "2026-01-30"  # 31 Jan 2026 is a Saturday
    cal = c.get("/api/tax/calendar?months=12").json()["items"]
    kinds = {i["kind"] for i in cal}
    assert {"efka", "income_tax"} <= kinds
    vat = [i for i in cal if i["kind"] == "vat"]
    assert all(v["title_en"].startswith("VAT return — Q") for v in vat) and all("estimate" in v for v in vat)
    c.put("/api/tax/settings", json={"vat_period": "monthly", "efka_monthly": False, "income_tax_month_day": "07-15",
                                     "custom": [{"title": "ENFIA installment", "date": date.today().isoformat()}]})
    cal = c.get("/api/tax/calendar").json()["items"]
    assert not any(i["kind"] == "efka" for i in cal) and any(i["kind"] == "custom" for i in cal)
    assert c.put("/api/tax/settings", json={"vat_period": "weekly"}).status_code == 400
    custom = next(i for i in cal if i["kind"] == "custom")
    assert run(taxes.tax_reminders()) >= 1
    assert run(taxes.tax_reminders()) == 0
    c.post("/api/tax/done", json={"key": custom["key"]})
    assert next(i for i in c.get("/api/tax/calendar").json()["items"] if i["key"] == custom["key"])["done"]


def test_export_and_delete(client, mdb):
    c = client
    c.put("/api/mydata/settings", json={"vat_number": "", "environment": "sandbox", "aade_user_id": "u", "subscription_key": "super-secret-key"})
    c.post("/api/invoices", json={"client_name": "Acme", "items": [{"description": "x", "qty": 1, "unit_price": 10}]})
    z = zipfile.ZipFile(io.BytesIO(c.get("/api/account/export.zip").content))
    names = z.namelist()
    assert "data/invoices.json" in names and json.loads(z.read("data/invoices.json"))[0]["client_name"] == "Acme"
    assert b"super-secret" not in z.read("data/mydata_settings.json") and b"subscription_key_enc" not in z.read("data/mydata_settings.json")
    assert c.post("/api/account/delete-business", json={"confirm": "wrong", "password": "correct horse"}).status_code == 400
    assert c.post("/api/account/delete-business", json={"confirm": "Papadopoulos Electrical", "password": "nope"}).status_code == 400
    assert c.post("/api/account/delete-business", json={"confirm": "Papadopoulos Electrical", "password": "correct horse"}).status_code == 200
    assert run(mdb.invoices.count_documents({})) == 0
    assert c.post("/api/account/delete", json={"password": "correct horse"}).status_code == 200
    assert c.get("/api/auth/me").status_code == 401


def test_accountant_portal(client, mdb):
    from test_team_plans import _client
    owner = client
    acct = _client(mdb, "eleni@books.gr", "accountant", "Eleni")
    token = owner.post("/api/team/invites", json={"email": "eleni@books.gr", "role": "accountant"}).json()["url"].rsplit("/", 1)[1]
    org = acct.post(f"/api/invites/{token}/accept").json()["org_id"]
    period = date.today().strftime("%Y-%m")
    owner.post("/api/invoices", json={"client_name": "A", "client_afm": CLIENT_AFM, "status": "sent", "items": [{"description": "x", "qty": 1, "unit_price": 100}]})
    owner.post("/api/expenses", json={"vendor_name": "Shell", "net": 10, "vat": 2.4})
    # Accountant adds a second client themselves and invites its owner
    assert owner.post("/api/practice/clients", json={"business_name": "Nope"}).status_code == 403
    new = acct.post("/api/practice/clients", json={"business_name": "Kafe Plaka", "afm": make_afm("33333333"), "owner_email": "kafe@plaka.gr"}).json()
    assert new["invite_url"]
    board = acct.get(f"/api/practice/clients?period={period}").json()
    assert {c["name"] for c in board["clients"]} == {"Papadopoulos Electrical", "Kafe Plaka"}
    pe = next(c for c in board["clients"] if c["org_id"] == org)
    checklist = {i["key"]: i["count"] for i in pe["checklist"]}
    assert checklist["unreported"] == 1 and checklist["no_receipt"] == 1 and pe["status"] == "attention" and pe["figures"]["income"] == 100
    kafe = next(c for c in board["clients"] if c["name"] == "Kafe Plaka")
    assert not kafe["has_owner"] and kafe["role"] == "accountant"

    # Request the missing receipt; the owner uploads it
    h = {"X-Org-Id": org}
    missing = acct.get(f"/api/receipts/missing?period={period}", headers=h).json()
    req = acct.post("/api/receipt-requests", json={"items": missing, "message": "For the VAT return"}, headers=h).json()
    assert req["status"] == "open" and len(req["items"]) == 1
    open_req = owner.get("/api/receipt-requests").json()[0]
    done = owner.post(f"/api/receipt-requests/{open_req['id']}/items/{open_req['items'][0]['id']}/upload",
                      files={"file": ("r.jpg", io.BytesIO(JPEG), "image/jpeg")}).json()
    assert done["status"] == "done"
    assert all(x.get("file") for x in owner.get("/api/expenses").json())

    # Export pack + close the month
    z = zipfile.ZipFile(io.BytesIO(acct.get(f"/api/export/pack.zip?period={period}", headers=h).content))
    assert {"sales_invoices.csv", "expenses.csv", "purchase_invoices_mydata.csv", "bank.csv", "summary.csv", "README.txt"} <= set(z.namelist())
    assert any(n.startswith("receipts/EXP-") for n in z.namelist())
    assert z.read("sales_invoices.csv").startswith("﻿".encode())
    acct.post("/api/practice/close", json={"period": period}, headers=h)
    pe = next(c for c in acct.get(f"/api/practice/clients?period={period}").json()["clients"] if c["org_id"] == org)
    assert pe["status"] == "closed"

    # The client accepts the owner invitation for the business the accountant created
    kafe_owner = _client(mdb, "kafe@plaka.gr", name="Kostas")
    kafe_owner.post(f"/api/invites/{new['invite_url'].rsplit('/', 1)[1]}/accept")
    roles = {o["name"]: o["role"] for o in kafe_owner.get("/api/orgs").json()}
    assert roles["Kafe Plaka"] == "owner"
