import { getLang, translate } from "@/lib/i18n";

export const money = (v, cur = "EUR") =>
  new Intl.NumberFormat("el-GR", { style: "currency", currency: cur || "EUR" }).format(v || 0);

export const compactMoney = (v) =>
  new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", notation: Math.abs(v) >= 10000 ? "compact" : "standard", maximumFractionDigits: Math.abs(v) >= 10000 ? 1 : 0 }).format(v || 0);

export const date = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString(getLang() === "el" ? "el-GR" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const relative = (iso) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return translate("just now");
  if (diff < 3600) return translate("{n}m ago", { n: Math.floor(diff / 60) });
  if (diff < 86400) return translate("{n}h ago", { n: Math.floor(diff / 3600) });
  return date(iso);
};

export const todayISO = () => new Date().toISOString().slice(0, 10);

export const lineTotals = (items, taxRate) => {
  let net = 0, vat = 0;
  for (const i of items) {
    const line = Math.round((parseFloat(i.qty) || 0) * (parseFloat(i.unit_price) || 0) * 100) / 100;
    net += line;
    vat += Math.round(line * (parseFloat(taxRate) || 0)) / 100;
  }
  return { net: Math.round(net * 100) / 100, vat: Math.round(vat * 100) / 100, total: Math.round((net + vat) * 100) / 100 };
};

export const VAT_RATES = [24, 13, 6, 17, 9, 4, 0];

// myDATA withholding (table 8.4, percentage codes) and stamp duty (table 8.6) — same codes as the backend.
export const WITHHOLDING = {
  1: ["Interest", 15], 2: ["Royalties", 20], 3: ["Professional / management fees", 20], 4: ["Technical works", 3], 5: ["Fuel & tobacco", 1],
  6: ["Other goods", 4], 7: ["Provision of services", 8], 8: ["Engineers — studies", 4], 9: ["Engineers — other works", 10], 10: ["Lawyers' fees", 15],
};
export const STAMP_DUTY = { 1: 1.2, 2: 2.4, 3: 3.6 };

/** Net/VAT plus withholding and stamp duty, per line like myDATA. `payable` is what the client actually pays. */
export const docTotals = (items, taxRate, wcat, scat) => {
  const wp = WITHHOLDING[wcat]?.[1] || 0;
  const sp = STAMP_DUTY[scat] || 0;
  let net = 0, vat = 0, wh = 0, st = 0;
  for (const i of items) {
    const line = Math.round((parseFloat(i.qty) || 0) * (parseFloat(i.unit_price) || 0) * 100) / 100;
    net += line;
    vat += Math.round(line * (parseFloat(taxRate) || 0)) / 100;
    wh += Math.round(line * wp) / 100;
    st += Math.round(line * sp) / 100;
  }
  const r = (v) => Math.round(v * 100) / 100;
  return { net: r(net), vat: r(vat), withheld: r(wh), stamp: r(st), gross: r(net + vat), payable: r(net + vat + st - wh) };
};
