"""MongoDB access. `db` is a module attribute so tests can swap in an in-memory database."""
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorClient

from app import config

client = AsyncIOMotorClient(config.MONGO_URL)
db = client[config.DB_NAME]


def get_db():
    """Always resolve through the module so a swapped `db` is picked up everywhere."""
    import app.db as m
    return m.db


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


async def ensure_indexes():
    d = get_db()
    await d.users.create_index("email", unique=True)
    await d.sessions.create_index("token", unique=True)
    for coll in ("clients", "documents", "invoices", "expenses", "suppliers", "scans", "products", "delivery_notes"):
        await d[coll].create_index([("org_id", 1), ("created_at", -1)])
    await d.invoices.create_index("public_token", sparse=True)
    await d.documents.create_index("public_token", sparse=True)
    await d.suppliers.create_index("token", unique=True)
    await d.afm_cache.create_index("afm", unique=True)
    await d.shop_connections.create_index("token", unique=True)
    await d.shop_orders.create_index([("org_id", 1), ("platform", 1), ("order_id", 1)], unique=True)
    await d.partners.create_index("code", unique=True)
    await d.partners.create_index("org_id", unique=True)
    await d.plan_changes.create_index([("org_id", 1), ("at", 1)])
    await d.partner_payouts.create_index([("partner_org_id", 1), ("month", 1)], unique=True)
    await d.stock_moves.create_index([("org_id", 1), ("product_id", 1), ("created_at", -1)])
