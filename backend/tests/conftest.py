import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SCHEDULER_ENABLED", "false")


def make_afm(prefix8: str) -> str:
    t = sum(int(prefix8[i]) * 2 ** (8 - i) for i in range(8))
    return prefix8 + str((t % 11) % 10)


def make_gr_iban(bban: str) -> str:
    digits = "".join(str(int(ch, 36)) for ch in bban + "GR00")
    return f"GR{98 - int(digits) % 97:02d}{bban}"


OUR_AFM = make_afm("09401924")
CLIENT_AFM = make_afm("12345678")
VENDOR_AFM = make_afm("80012345")
IBAN = "GR1601101250000000012300695"


@pytest.fixture()
def mdb(monkeypatch, tmp_path):
    from mongomock_motor import AsyncMongoMockClient
    import app.db
    from app import config
    from app.routers import expenses, mydata, suppliers
    from app import ratelimit
    db = AsyncMongoMockClient()["test"]
    monkeypatch.setattr(app.db, "db", db)
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(suppliers, "SUPPLIER_DIR", tmp_path / "suppliers")
    monkeypatch.setattr(expenses, "SCAN_DIR", tmp_path / "scans")
    mydata._fernet = None
    ratelimit.reset()
    return db


@pytest.fixture()
def anon(mdb):
    from fastapi.testclient import TestClient
    from app.main import create_app
    c = TestClient(create_app(with_lifespan=False))
    c.db = mdb
    return c


def _signup(c, email):
    r = c.post("/api/auth/signup", json={"name": "Maria", "email": email, "password": "correct horse", "business_name": "Papadopoulos Electrical"})
    assert r.status_code == 200, r.text
    return r


@pytest.fixture()
def client(anon):
    _signup(anon, "maria@example.gr")
    r = anon.put("/api/business", json={"business_name": "Papadopoulos Electrical", "afm": OUR_AFM, "city": "Athens", "iban": IBAN})
    assert r.status_code == 200, r.text
    return anon


@pytest.fixture()
def other_client(mdb):
    """A second, unrelated account — used to prove tenant isolation."""
    from fastapi.testclient import TestClient
    from app.main import create_app
    c = TestClient(create_app(with_lifespan=False))
    _signup(c, "other@example.gr")
    return c


def run(coro):
    import asyncio
    return asyncio.run(coro)
