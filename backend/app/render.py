"""HTML rendering of business documents for email."""
from app.common import esc, money

TITLES = {"invoice": "Invoice", "credit_note": "Credit note", "quote": "Quote", "sales_order": "Sales order", "purchase_order": "Purchase order"}


def document_email(doc: dict, biz: dict, kind: str, intro: str = "", party_label: str = "Billed to") -> str:
    cur = doc.get("currency", "EUR")
    rows = "".join(
        f'<tr><td style="padding:9px 10px;border-bottom:1px solid #EDF0F5;">{esc(i.get("description"))}</td>'
        f'<td style="padding:9px 10px;border-bottom:1px solid #EDF0F5;text-align:right;">{i.get("qty", 1):g}</td>'
        f'<td style="padding:9px 10px;border-bottom:1px solid #EDF0F5;text-align:right;">{money(i.get("unit_price"), cur)}</td>'
        f'<td style="padding:9px 10px;border-bottom:1px solid #EDF0F5;text-align:right;">{money((i.get("qty") or 0) * (i.get("unit_price") or 0), cur)}</td></tr>'
        for i in doc.get("items") or [])
    logo = f'<img src="{esc(biz.get("logo"))}" alt="" style="max-height:44px;max-width:160px;display:block;margin-bottom:8px;" />' if (biz.get("logo") or "").startswith("data:image/") else ""
    md = doc.get("mydata") or {}
    mark = (f'<p style="font-size:11px;color:#5B6478;margin-top:14px;">ΜΑΡΚ {esc(md.get("mark"))}{" (simulation)" if md.get("simulated") else ""}</p>'
            if md.get("state") == "transmitted" else "")
    return f"""
<p style="margin:0 0 16px;color:#3A4358;font-size:14px;">{intro}</p>
<table style="width:100%;font-size:13px;margin-bottom:14px;"><tr>
  <td style="vertical-align:top;">{logo}<strong>{esc(biz.get("business_name"))}</strong><br/><span style="color:#5B6478;">{esc(biz.get("address"))} {esc(biz.get("city"))}<br/>{('ΑΦΜ ' + esc(biz.get("afm"))) if biz.get("afm") else ""}</span></td>
  <td style="vertical-align:top;text-align:right;"><strong style="font-size:16px;">{TITLES.get(kind, "Document")} {esc(doc.get("number"))}</strong><br/>
    <span style="color:#5B6478;">Date {esc(doc.get("issue_date"))}{('<br/>Due ' + esc(doc.get("due_date"))) if doc.get("due_date") else ""}</span></td>
</tr></table>
<p style="font-size:12px;color:#5B6478;margin:0 0 4px;text-transform:uppercase;letter-spacing:.06em;">{party_label}</p>
<p style="margin:0 0 16px;font-size:14px;"><strong>{esc(doc.get("client_name") or doc.get("supplier_name"))}</strong>{(' · ' + esc(doc.get("client_company"))) if doc.get("client_company") else ""}</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
  <thead><tr style="background:#F6F8FB;"><th style="padding:9px 10px;text-align:left;">Description</th><th style="padding:9px 10px;text-align:right;">Qty</th><th style="padding:9px 10px;text-align:right;">Price</th><th style="padding:9px 10px;text-align:right;">Amount</th></tr></thead>
  <tbody>{rows}</tbody>
</table>
<table style="margin-left:auto;margin-top:10px;font-size:13px;min-width:220px;">
  <tr><td style="padding:3px 10px;color:#5B6478;">Net</td><td style="text-align:right;">{money(doc.get("subtotal"), cur)}</td></tr>
  <tr><td style="padding:3px 10px;color:#5B6478;">VAT {doc.get("tax_rate", 0):g}%</td><td style="text-align:right;">{money(doc.get("tax"), cur)}</td></tr>
  <tr><td style="padding:8px 10px;font-weight:700;border-top:2px solid #0B1220;">Total</td><td style="text-align:right;font-weight:700;border-top:2px solid #0B1220;">{money(doc.get("total"), cur)}</td></tr>
</table>
{('<p style="margin-top:16px;font-size:12px;color:#3A4358;background:#F6F8FB;border-radius:10px;padding:10px 12px;">' + esc(doc.get("notes")) + '</p>') if doc.get("notes") else ""}
{mark}"""
