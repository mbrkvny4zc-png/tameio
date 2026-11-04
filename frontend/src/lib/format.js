export const money = (v, cur = "EUR") =>
  new Intl.NumberFormat("el-GR", { style: "currency", currency: cur || "EUR" }).format(v || 0);

export const compactMoney = (v) =>
  new Intl.NumberFormat("el-GR", { style: "currency", currency: "EUR", notation: Math.abs(v) >= 10000 ? "compact" : "standard", maximumFractionDigits: Math.abs(v) >= 10000 ? 1 : 0 }).format(v || 0);

export const date = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? iso + "T00:00:00" : iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const relative = (iso) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
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
