"""Transactional email via Resend. When no API key is configured, emails are skipped (and the caller is told)."""
import asyncio
import logging

from app import config
from app.common import esc

log = logging.getLogger("mailer")


def layout(title: str, body_html: str, cta_text: str = "", cta_url: str = "", footer: str = "") -> str:
    cta = (f'<div style="text-align:center;margin:28px 0 8px;"><a href="{esc(cta_url)}" style="display:inline-block;background:#1E4FD8;'
           f'color:#fff;font-weight:600;font-size:15px;padding:12px 28px;border-radius:12px;text-decoration:none;">{esc(cta_text)}</a></div>') if cta_url else ""
    return f"""<!doctype html><html><body style="margin:0;background:#F4F6FA;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0B1220;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border:1px solid #E4E8F0;border-radius:18px;padding:28px;">
    <h1 style="margin:0 0 14px;font-size:20px;">{esc(title)}</h1>
    {body_html}{cta}
  </div>
  <p style="text-align:center;font-size:11px;color:#8A93A6;margin-top:16px;">{esc(footer or ('Sent with ' + config.APP_NAME))}</p>
</div></body></html>"""


async def send(to: str, subject: str, html_body: str, reply_to: str = "") -> bool:
    if not config.RESEND_API_KEY or not to:
        log.info("Email skipped (not configured): %s", subject)
        return False
    import resend
    resend.api_key = config.RESEND_API_KEY
    params = {"from": config.SENDER_EMAIL, "to": [to], "subject": subject, "html": html_body}
    if reply_to:
        params["reply_to"] = [reply_to]
    try:
        await asyncio.to_thread(resend.Emails.send, params)
        return True
    except Exception as e:  # noqa: BLE001 — never fail a business action because email failed
        log.error("Email to %s failed: %s", to, e)
        return False
