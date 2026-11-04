"""Tiny in-process rate limiter for public endpoints (per IP). Use a shared store when running several workers."""
import time
from collections import defaultdict

from fastapi import HTTPException, Request

_hits: dict = defaultdict(list)


def rate_limit(request: Request, key: str, limit: int, window: int = 3600):
    ip = (request.headers.get("x-forwarded-for") or (request.client.host if request.client else "?")).split(",")[0].strip()
    t = time.time()
    bucket = _hits[f"{key}:{ip}"]
    bucket[:] = [x for x in bucket if t - x < window]
    if len(bucket) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests. Please try again later.")
    bucket.append(t)


def reset():
    _hits.clear()
