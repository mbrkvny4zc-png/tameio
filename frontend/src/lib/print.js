import QRCode from "qrcode";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const TITLES = { invoice: ["INVOICE", "ΤΙΜΟΛΟΓΙΟ"], credit_note: ["CREDIT NOTE", "ΠΙΣΤΩΤΙΚΟ ΤΙΜΟΛΟΓΙΟ"], quote: ["QUOTE", "ΠΡΟΣΦΟΡΑ"],
  sales_order: ["SALES ORDER", "ΠΑΡΑΓΓΕΛΙΑ"], purchase_order: ["PURCHASE ORDER", "ΠΑΡΑΓΓΕΛΙΑ ΑΓΟΡΑΣ"],
  receipt_11_1: ["RETAIL SALES RECEIPT", "ΑΠΟΔΕΙΞΗ ΛΙΑΝΙΚΗΣ ΠΩΛΗΣΗΣ"], receipt_11_2: ["SERVICE RECEIPT", "ΑΠΟΔΕΙΞΗ ΠΑΡΟΧΗΣ ΥΠΗΡΕΣΙΩΝ"],
  invoice_dn: ["INVOICE — DELIVERY NOTE", "ΤΙΜΟΛΟΓΙΟ - ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ"] };

// Document wording per language. Greek documents are what Greek clients and inspectors expect.
const L = {
  el: { billTo: "Πελάτης", supplier: "Προμηθευτής", desc: "Περιγραφή", qty: "Ποσότητα", unit: "Τιμή μονάδας", amount: "Αξία", net: "Καθαρή αξία",
    vat: "ΦΠΑ", withheld: "Παρακράτηση φόρου", stamp: "Χαρτόσημο", total: "Σύνολο", payable: "Πληρωτέο", credited: "Σύνολο πίστωσης",
    date: "Ημερομηνία", due: "Λήξη", valid: "Ισχύει έως", credits: "Πιστώνει το", payment: "Τρόπος πληρωμής", paid: "Έχουν καταβληθεί",
    balance: "Υπόλοιπο", loading: "Τόπος φόρτωσης", delivery: "Τόπος παράδοσης", purpose: "Σκοπός διακίνησης", vehicle: "Όχημα", sim: "ΠΡΟΣΟΜΟΙΩΣΗ — δεν διαβιβάστηκε στην ΑΑΔΕ" },
  en: { billTo: "Bill to", supplier: "Supplier", desc: "Description", qty: "Qty", unit: "Unit price", amount: "Amount", net: "Net",
    vat: "VAT", withheld: "Withholding tax", stamp: "Stamp duty", total: "Total", payable: "Amount due", credited: "Total credited",
    date: "Date", due: "Due", valid: "Valid until", credits: "Credits", payment: "Payment", paid: "Paid so far",
    balance: "Balance due", loading: "Loading from", delivery: "Deliver to", purpose: "Purpose", vehicle: "Vehicle", sim: "SIMULATION — not reported to AADE" },
};

const fmt = (lang) => (v, cur = "EUR") => new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", { style: "currency", currency: cur || "EUR" }).format(v || 0);
const dfmt = (lang) => (iso) => (iso ? new Date(iso.length <= 10 ? iso + "T00:00:00" : iso).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

/* Three looks. "classic" = clean and safe, "modern" = colour band, "minimal" = typographic, lots of white. */
function css(template, brand) {
  const b = /^#[0-9a-f]{6}$/i.test(brand || "") ? brand : "#1E4FD8";
  const base = `
  @page { size: A4; margin: 14mm; } * { box-sizing: border-box; }
  body { font-family: Inter, "Segoe UI", Arial, sans-serif; color: #17140f; margin: 0; font-size: 12.5px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .wrap { max-width: 780px; margin: 0 auto; padding: 24px; }
  .top { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
  .biz b { font-size: 17px; } .muted { color: #6b6257; }
  h1 { margin: 0; font-size: 22px; letter-spacing: -0.01em; } .sub { color: #6b6257; font-size: 10.5px; letter-spacing: .08em; }
  .meta { text-align: right; } .meta div { margin-top: 2px; } .num { font-size: 15px; font-weight: 700; margin-top: 10px; }
  .party { border-radius: 10px; padding: 14px 16px; margin-bottom: 20px; }
  .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .1em; color: #6b6257; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; } th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .08em; color: #6b6257; padding: 8px 10px; }
  td { padding: 9px 10px; border-bottom: 1px solid #ece5d8; vertical-align: top; } .r { text-align: right; font-variant-numeric: tabular-nums; }
  .tot { margin-left: auto; margin-top: 14px; width: 290px; } .tot td { border: 0; padding: 4px 10px; } .neg { color: #9a3b1b; }
  .grand td { font-weight: 700; font-size: 15px; padding-top: 9px; }
  .box { margin-top: 16px; padding: 12px 14px; border: 1px solid #ece5d8; border-radius: 10px; white-space: pre-line; }
  .dn { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 18px; } .dn .box { margin: 0; }
  .mark { display: flex; gap: 14px; align-items: center; margin-top: 20px; padding: 12px 14px; border: 1px solid #ece5d8; border-radius: 10px; font-size: 11px; line-height: 1.6; }
  .foot { margin-top: 26px; padding-top: 10px; border-top: 1px solid #ece5d8; color: #6b6257; font-size: 11px; text-align: center; white-space: pre-line; }`;
  if (template === "modern") return base + `
  .band { background: ${b}; color: #fff; margin: -24px -24px 24px; padding: 22px 24px; display: flex; justify-content: space-between; align-items: flex-end; }
  .band h1, .band .sub, .band .muted { color: #fff; } .band .sub { opacity: .8; }
  .party { background: ${b}12; } th { border-bottom: 2px solid ${b}; color: ${b}; } .grand td { border-top: 2px solid ${b}; color: ${b}; }
  .pay { background: ${b}10; border-color: ${b}33; }`;
  if (template === "minimal") return base + `
  body { font-family: Georgia, "Times New Roman", serif; } h1 { font-weight: 400; font-size: 28px; }
  .party { padding: 0 0 14px; border-bottom: 1px solid #17140f; border-radius: 0; } th { border-bottom: 1px solid #17140f; }
  td { border-bottom: 1px solid #f1ece2; } .grand td { border-top: 1px solid #17140f; font-weight: 400; font-size: 18px; } .box, .mark { border-radius: 0; }`;
  return base + `
  .party { background: #f6f1e7; } th { border-bottom: 1.5px solid #17140f; } .grand td { border-top: 2px solid #17140f; }
  .accent { height: 4px; background: ${b}; margin: -24px -24px 22px; } .pay { background: #f6f1e7; border-color: transparent; }`;
}

const PURPOSES_EL = { 1: "Πώληση", 2: "Πώληση για λογαριασμό τρίτων", 3: "Δειγματισμός", 4: "Έκθεση", 5: "Επιστροφή", 6: "Φύλαξη", 7: "Επεξεργασία / Συναρμολόγηση",
  8: "Μεταξύ εγκαταστάσεων", 9: "Αγορά", 11: "Δωρεάν διάθεση", 12: "Εγγύηση", 13: "Χρησιδανεισμός", 19: "Λοιπές διακινήσεις" };

/** Opens a print-ready A4 page (Save as PDF from the print dialog). */
export async function printDocument(doc, biz = {}, kind = "invoice") {
  const w = window.open("", "_blank");
  if (!w) return false;
  const lang = doc.language || doc.client_language || (doc.client_country && doc.client_country !== "GR" ? "en" : "el");
  const t = L[lang] || L.el;
  const money = fmt(lang);
  const date = dfmt(lang);
  const cur = doc.currency || "EUR";
  const md = doc.mydata || {};
  let qr = "";
  if (md.state === "transmitted" && md.qr_url) {
    try { qr = await QRCode.toDataURL(md.qr_url, { margin: 1, width: 180 }); } catch { qr = ""; }
  }
  if (doc.kind === "receipt") kind = md.invoice_type === "11.2" ? "receipt_11_2" : "receipt_11_1";
  if (kind === "invoice" && doc.delivery) kind = "invoice_dn";
  const [en, el] = TITLES[kind] || TITLES.invoice;
  const [title, sub] = lang === "el" ? [el, en] : [en, el];
  const party = kind === "purchase_order"
    ? { label: t.supplier, name: doc.supplier_name, extra: doc.supplier_afm ? `ΑΦΜ ${doc.supplier_afm}` : "" }
    : { label: t.billTo, name: doc.client_name, extra: [doc.client_company, doc.client_afm && `ΑΦΜ ${doc.client_afm}`, doc.client_address, doc.client_city].filter(Boolean).join(" · ") };
  const logo = (biz.logo || "").startsWith("data:image/") ? `<img src="${esc(biz.logo)}" style="max-height:52px;max-width:180px;display:block;margin-bottom:10px" alt="">` : "";
  const rows = (doc.items || []).map((i) => `<tr><td>${esc(i.description)}</td><td class="r">${esc(i.qty)}</td><td class="r">${esc(money(i.unit_price, cur))}</td><td class="r">${esc(money((i.qty || 0) * (i.unit_price || 0), cur))}</td></tr>`).join("");
  const markBlock = md.state === "transmitted"
    ? `<div class="mark">${qr ? `<img src="${qr}" width="90" height="90" alt="QR">` : ""}<div><div><b>ΜΑΡΚ</b> ${esc(md.mark)}${md.simulated ? ` <span style='color:#B45309'>(${t.sim})</span>` : ""}</div>${md.uid ? `<div><b>UID</b> ${esc(md.uid)}</div>` : ""}<div><b>Σειρά / Α.Α.</b> ${esc(md.series)} / ${esc(md.aa)}${md.branch ? ` · Υποκατάστημα ${esc(md.branch)}` : ""}</div>${md.correlated_mark ? `<div><b>Συσχετιζόμενο ΜΑΡΚ</b> ${esc(md.correlated_mark)}</div>` : ""}${md.transaction_id ? `<div><b>POS</b> ${esc(md.terminal_id || "")} · ${esc(md.transaction_id)}</div>` : ""}</div></div>`
    : "";
  const isInvoice = ["invoice", "invoice_dn"].includes(kind);
  const iban = doc.iban || biz.iban;
  const extras = (doc.withheld || doc.stamp_duty)
    ? `<tr><td class="muted">${t.total} (${t.net} + ${t.vat})</td><td class="r">${esc(money(doc.gross ?? doc.subtotal + doc.tax, cur))}</td></tr>
       ${doc.withheld ? `<tr><td class="muted">${t.withheld}</td><td class="r neg">−${esc(money(doc.withheld, cur))}</td></tr>` : ""}
       ${doc.stamp_duty ? `<tr><td class="muted">${t.stamp}</td><td class="r">${esc(money(doc.stamp_duty, cur))}</td></tr>` : ""}` : "";
  const paidRows = isInvoice && doc.paid_amount > 0 && doc.status !== "paid"
    ? `<tr><td class="muted">${t.paid}</td><td class="r">−${esc(money(doc.paid_amount, cur))}</td></tr><tr class="grand"><td>${t.balance}</td><td class="r">${esc(money(doc.balance, cur))}</td></tr>` : "";
  const a = (x) => esc([[x.street, x.number].filter(Boolean).join(" "), [x.postal_code, x.city].filter(Boolean).join(" ")].filter(Boolean).join(", "));
  const dn = doc.delivery
    ? `<div class="dn"><div class="box"><div class="lbl">${t.loading}</div>${a(doc.delivery.loading_address)}</div><div class="box"><div class="lbl">${t.delivery}</div>${a(doc.delivery.delivery_address)}</div></div>
       <p class="muted" style="margin:-6px 0 16px">${t.purpose}: ${esc(PURPOSES_EL[doc.delivery.move_purpose] || doc.delivery.move_purpose)} · ${esc(date(doc.delivery.dispatch_date))} ${esc(doc.delivery.dispatch_time || "")}${doc.delivery.vehicle_number ? ` · ${t.vehicle} ${esc(doc.delivery.vehicle_number)}` : ""}</p>` : "";
  const head = `<div class="biz">${logo}<b>${esc(biz.business_name)}</b><div class="muted">${esc([biz.address, biz.postal_code, biz.city].filter(Boolean).join(", "))}</div>
      <div class="muted">${esc([biz.afm && `ΑΦΜ ${biz.afm}`, biz.doy && `ΔΟΥ ${biz.doy}`].filter(Boolean).join(" · "))}</div>
      <div class="muted">${esc([biz.business_email, biz.business_phone].filter(Boolean).join(" · "))}</div></div>`;
  const meta = `<div class="meta"><h1>${title}</h1><div class="sub">${sub}</div><div class="num">${esc(doc.number)}</div>
      <div class="muted">${t.date} ${esc(date(doc.issue_date))}</div>${doc.due_date ? `<div class="muted">${t.due} ${esc(date(doc.due_date))}</div>` : ""}${doc.valid_until ? `<div class="muted">${t.valid} ${esc(date(doc.valid_until))}</div>` : ""}
      ${doc.credit_of_number ? `<div class="muted">${t.credits} ${esc(doc.credit_of_number)}</div>` : ""}</div>`;
  const template = biz.invoice_template || "classic";
  const top = template === "modern" ? `<div class="band">${meta.replace('class="meta"', 'class="meta" style="text-align:left"')}${logo ? `<div>${logo}</div>` : ""}</div><div class="top">${head.replace(logo, "")}</div>`
    : `${template === "classic" ? '<div class="accent"></div>' : ""}<div class="top">${head}${meta}</div>`;
  w.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(doc.number)} — ${esc(biz.business_name || en)}</title>
<style>${css(template, biz.brand_color)}</style></head><body><div class="wrap">
  ${top}
  <div class="party"><div class="lbl">${party.label}</div><b>${esc(party.name)}</b><div class="muted">${esc(party.extra)}</div></div>
  ${dn}
  <table><thead><tr><th>${t.desc}</th><th class="r">${t.qty}</th><th class="r">${t.unit}</th><th class="r">${t.amount}</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="tot"><tr><td class="muted">${t.net}</td><td class="r">${esc(money(doc.subtotal, cur))}</td></tr><tr><td class="muted">${t.vat} ${esc(doc.tax_rate)}%</td><td class="r">${esc(money(doc.tax, cur))}</td></tr>
    ${extras}
    <tr class="grand"><td>${kind === "credit_note" ? t.credited : (doc.withheld || doc.stamp_duty) ? t.payable : t.total}</td><td class="r">${esc(money(doc.total, cur))}</td></tr>${paidRows}</table>
  ${doc.notes ? `<div class="box">${esc(doc.notes)}</div>` : ""}
  ${isInvoice && (iban || biz.payment_instructions) ? `<div class="box pay"><b>${t.payment}</b>${iban ? `<br>IBAN ${esc(iban)}` : ""}${biz.payment_instructions ? `<br>${esc(biz.payment_instructions)}` : ""}</div>` : ""}
  ${markBlock}
  ${biz.invoice_footer ? `<div class="foot">${esc(biz.invoice_footer)}</div>` : ""}
</div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
  return true;
}

/** Client statement (καρτέλα πελάτη) as a printable page. */
export function printStatement(st, biz = {}) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const lang = st.client.language === "en" ? "en" : "el";
  const money = fmt(lang);
  const date = dfmt(lang);
  const T = lang === "el"
    ? { title: "Καρτέλα πελάτη", opening: "Από μεταφορά", d: "Ημ/νία", doc: "Παραστατικό", what: "Αιτιολογία", debit: "Χρέωση", credit: "Πίστωση", bal: "Υπόλοιπο", closing: "Υπόλοιπο προς εξόφληση" }
    : { title: "Statement of account", opening: "Opening balance", d: "Date", doc: "Document", what: "Details", debit: "Charges", credit: "Payments", bal: "Balance", closing: "Balance due" };
  const rows = st.rows.map((r) => `<tr><td>${esc(date(r.date))}</td><td>${esc(r.ref)}</td><td>${esc(r.text)}</td><td class="r">${r.debit ? esc(money(r.debit)) : ""}</td><td class="r">${r.credit ? esc(money(r.credit)) : ""}</td><td class="r"><b>${esc(money(r.balance))}</b></td></tr>`).join("");
  w.document.write(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${T.title} — ${esc(st.client.name)}</title><style>${css(biz.invoice_template || "classic", biz.brand_color)}</style></head><body><div class="wrap">
  <div class="top"><div class="biz"><b>${esc(biz.business_name)}</b><div class="muted">${esc([biz.afm && `ΑΦΜ ${biz.afm}`, biz.address, biz.city].filter(Boolean).join(" · "))}</div></div>
  <div class="meta"><h1>${T.title}</h1><div class="muted">${st.start ? esc(date(st.start)) : ""} – ${esc(date(st.end || new Date().toISOString().slice(0, 10)))}</div></div></div>
  <div class="party"><b>${esc(st.client.name)}</b><div class="muted">${esc([st.client.company, st.client.afm && `ΑΦΜ ${st.client.afm}`, st.client.address, st.client.city].filter(Boolean).join(" · "))}</div></div>
  <table><thead><tr><th>${T.d}</th><th>${T.doc}</th><th>${T.what}</th><th class="r">${T.debit}</th><th class="r">${T.credit}</th><th class="r">${T.bal}</th></tr></thead>
  <tbody>${st.opening ? `<tr><td></td><td></td><td>${T.opening}</td><td></td><td></td><td class="r"><b>${esc(money(st.opening))}</b></td></tr>` : ""}${rows}</tbody></table>
  <table class="tot"><tr class="grand"><td>${T.closing}</td><td class="r">${esc(money(st.closing))}</td></tr></table>
  ${biz.invoice_footer ? `<div class="foot">${esc(biz.invoice_footer)}</div>` : ""}
</div><script>window.onload=()=>setTimeout(()=>window.print(),250)</script></body></html>`);
  w.document.close();
  return true;
}
