import QRCode from "qrcode";
import { money, date } from "@/lib/format";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TITLES = { invoice: ["INVOICE", "ΤΙΜΟΛΟΓΙΟ"], credit_note: ["CREDIT NOTE", "ΠΙΣΤΩΤΙΚΟ"], quote: ["QUOTE", "ΠΡΟΣΦΟΡΑ"],
  sales_order: ["SALES ORDER", "ΠΑΡΑΓΓΕΛΙΑ"], purchase_order: ["PURCHASE ORDER", "ΠΑΡΑΓΓΕΛΙΑ ΑΓΟΡΑΣ"],
  receipt_11_1: ["RETAIL SALES RECEIPT", "ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ"], receipt_11_2: ["SERVICE RECEIPT", "ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ"] };

/** Opens a print-ready A4 page (Save as PDF from the print dialog). */
export async function printDocument(doc, biz = {}, kind = "invoice") {
  const w = window.open("", "_blank");
  if (!w) return false;
  const cur = doc.currency || "EUR";
  const md = doc.mydata || {};
  let qr = "";
  if (md.state === "transmitted" && md.qr_url) {
    try { qr = await QRCode.toDataURL(md.qr_url, { margin: 1, width: 180 }); } catch { qr = ""; }
  }
  if (doc.kind === "receipt") kind = md.invoice_type === "11.2" ? "receipt_11_2" : "receipt_11_1";
  const [en, el] = TITLES[kind] || TITLES.invoice;
  const party = kind === "purchase_order"
    ? { label: "Supplier", name: doc.supplier_name, extra: doc.supplier_afm ? `ΑΦΜ ${doc.supplier_afm}` : "" }
    : { label: "Bill to", name: doc.client_name, extra: [doc.client_company, doc.client_afm && `ΑΦΜ ${doc.client_afm}`, doc.client_address, doc.client_city].filter(Boolean).join(" · ") };
  const logo = (biz.logo || "").startsWith("data:image/") ? `<img src="${esc(biz.logo)}" style="max-height:52px;max-width:180px;display:block;margin-bottom:10px" alt="">` : "";
  const rows = (doc.items || []).map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${esc(i.qty)}</td><td class="r">${esc(money(i.unit_price, cur))}</td><td class="r">${esc(money((i.qty || 0) * (i.unit_price || 0), cur))}</td></tr>`).join("");
  const markBlock = md.state === "transmitted"
    ? `<div class="mark">${qr ? `<img src="${qr}" width="90" height="90" alt="QR">` : ""}<div><div><b>ΜΑΡΚ</b> ${esc(md.mark)}${md.simulated ? " <span style='color:#B45309'>(SIMULATION — not reported to AADE)</span>" : ""}</div>${md.uid ? `<div><b>UID</b> ${esc(md.uid)}</div>` : ""}<div><b>Σειρά / Α.Α.</b> ${esc(md.series)} / ${esc(md.aa)}</div>${md.correlated_mark ? `<div><b>Συσχετιζόμενο ΜΑΡΚ</b> ${esc(md.correlated_mark)}</div>` : ""}</div></div>`
    : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(doc.number)} — ${esc(biz.business_name || en)}</title>
<style>
  @page { size: A4; margin: 16mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, "Segoe UI", Arial, sans-serif; color: #0B1220; margin: 0; font-size: 12.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 780px; margin: 0 auto; padding: 28px; }
  .top { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 30px; }
  .biz b { font-size: 17px; } .muted { color: #5B6478; }
  h1 { margin: 0; font-size: 26px; letter-spacing: -0.02em; } .el { color: #5B6478; font-size: 11px; letter-spacing: .08em; }
  .meta { text-align: right; } .meta div { margin-top: 2px; }
  .party { background: #F5F7FB; border-radius: 12px; padding: 14px 16px; margin-bottom: 22px; }
  .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #5B6478; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #5B6478; padding: 8px 10px; border-bottom: 1.5px solid #0B1220; }
  td { padding: 10px; border-bottom: 1px solid #E8ECF3; vertical-align: top; } .r { text-align: right; font-variant-numeric: tabular-nums; }
  .tot { margin-left: auto; margin-top: 14px; width: 260px; } .tot td { border: 0; padding: 4px 10px; } .grand td { border-top: 2px solid #0B1220; font-weight: 700; font-size: 15px; padding-top: 8px; }
  .notes { margin-top: 22px; padding: 12px 14px; border: 1px solid #E8ECF3; border-radius: 10px; white-space: pre-line; }
  .pay { margin-top: 12px; padding: 12px 14px; background: #EEF3FF; border-radius: 10px; white-space: pre-line; }
  .mark { display: flex; gap: 14px; align-items: center; margin-top: 22px; padding: 12px 14px; border: 1px solid #E8ECF3; border-radius: 10px; font-size: 11px; line-height: 1.6; }
</style></head><body><div class="wrap">
  <div class="top">
    <div class="biz">${logo}<b>${esc(biz.business_name)}</b><div class="muted">${esc([biz.address, biz.postal_code, biz.city].filter(Boolean).join(", "))}</div>
      <div class="muted">${esc([biz.afm && `ΑΦΜ ${biz.afm}`, biz.doy && `ΔΟΥ ${biz.doy}`].filter(Boolean).join(" · "))}</div>
      <div class="muted">${esc([biz.business_email, biz.business_phone].filter(Boolean).join(" · "))}</div></div>
    <div class="meta"><h1>${en}</h1><div class="el">${el}</div><div style="margin-top:10px;font-size:15px;font-weight:700">${esc(doc.number)}</div>
      <div class="muted">Date ${esc(date(doc.issue_date))}</div>${doc.due_date ? `<div class="muted">Due ${esc(date(doc.due_date))}</div>` : ""}${doc.valid_until ? `<div class="muted">Valid until ${esc(date(doc.valid_until))}</div>` : ""}
      ${doc.credit_of_number ? `<div class="muted">Credits ${esc(doc.credit_of_number)}</div>` : ""}</div>
  </div>
  <div class="party"><div class="lbl">${party.label}</div><b>${esc(party.name)}</b><div class="muted">${esc(party.extra)}</div></div>
  <table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot"><tr><td class="muted">Net</td><td class="r">${esc(money(doc.subtotal, cur))}</td></tr><tr><td class="muted">VAT ${esc(doc.tax_rate)}%</td><td class="r">${esc(money(doc.tax, cur))}</td></tr>
    <tr class="grand"><td>${kind === "credit_note" ? "Total credited" : "Total"}</td><td class="r">${esc(money(doc.total, cur))}</td></tr></table>
  ${doc.notes ? `<div class="notes">${esc(doc.notes)}</div>` : ""}
  ${kind === "invoice" && (biz.iban || biz.payment_instructions) ? `<div class="pay"><b>Payment</b>${biz.iban ? `<br>IBAN ${esc(biz.iban)}` : ""}${biz.payment_instructions ? `<br>${esc(biz.payment_instructions)}` : ""}</div>` : ""}
  ${markBlock}
</div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
  return true;
}
