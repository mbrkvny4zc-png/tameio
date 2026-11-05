"""Runtime configuration, read once from the environment."""
import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

APP_NAME = os.environ.get("APP_NAME", "Tameio")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "tameio")
PUBLIC_URL = os.environ.get("PUBLIC_URL", "http://localhost:5173").rstrip("/")
CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", PUBLIC_URL).split(",") if o.strip()]
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(ROOT / "uploads")))

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "no-reply@example.com")

# AI document scanning (Anthropic). Leave unset to disable scanning.
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-5-5")
AI_SCAN_ENABLED = os.environ.get("AI_SCAN_ENABLED", "true").lower() == "true"

MYDATA_ENCRYPTION_KEY = os.environ.get("MYDATA_ENCRYPTION_KEY", "")

SCHEDULER_ENABLED = os.environ.get("SCHEDULER_ENABLED", "true").lower() == "true"

# Plans: new businesses start here. Accountants (practice accounts) are always free.
DEFAULT_PLAN = os.environ.get("DEFAULT_PLAN", "free")
PLATFORM_ADMINS = [e.strip().lower() for e in os.environ.get("PLATFORM_ADMINS", "").split(",") if e.strip()]

# Receipts by email: receipts+<token>@INBOUND_DOMAIN, delivered to /api/inbound/email with this secret.
INBOUND_DOMAIN = os.environ.get("INBOUND_DOMAIN", "")
INBOUND_SECRET = os.environ.get("INBOUND_SECRET", "")

# Viva Wallet (card payments on invoices). "demo" or "live".
VIVA_ENV = os.environ.get("VIVA_ENV", "demo")

# ΑΦΜ auto-fill. Without these, lookups use the free EU VIES registry (name + address only).
# With AADE's "registry search" credentials you also get ΔΟΥ and business activities.
AADE_REGISTRY_USER = os.environ.get("AADE_REGISTRY_USER", "")
AADE_REGISTRY_PASS = os.environ.get("AADE_REGISTRY_PASS", "")

# Partner programme: default revenue share (%) for accounting firms that refer paying businesses.
PARTNER_SHARE_PCT = float(os.environ.get("PARTNER_SHARE_PCT", "20"))
