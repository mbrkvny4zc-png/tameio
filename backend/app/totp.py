"""RFC 6238 time-based one-time passwords (compatible with Google Authenticator, Authy, 1Password)."""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from urllib.parse import quote


def new_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def _code(secret: str, counter: int) -> str:
    key = base64.b32decode(secret + "=" * (-len(secret) % 8), casefold=True)
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1_000_000:06d}"


def now_code(secret: str, at: float = None) -> str:
    return _code(secret, int((at or time.time()) // 30))


def verify(secret: str, code: str, at: float = None, window: int = 1) -> bool:
    code = (code or "").replace(" ", "")
    if not (code.isdigit() and len(code) == 6):
        return False
    step = int((at or time.time()) // 30)
    return any(hmac.compare_digest(_code(secret, step + d), code) for d in range(-window, window + 1))


def otpauth_uri(secret: str, email: str, issuer: str) -> str:
    return f"otpauth://totp/{quote(issuer)}:{quote(email)}?secret={secret}&issuer={quote(issuer)}&digits=6&period=30"
