import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Boxes, FileSpreadsheet, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { money, VAT_RATES } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { resetProducts } from "@/components/ItemsEditor";
import { ImportDialog } from "@/components/Extras";
import { Badge, Button, Empty, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Segmented, Select, Sheet, Table } from "@/components/ui";
import { relative } from "@/lib/format";

const EMPTY = { name: "", code: "", description: "", unit_price: "", tax_rate: 24, unit: "pcs", kind: "service", track_stock: false, low_stock: 0 };
const UNITS = [["pcs", "pieces"], ["hour", "hour"], ["day", "day"], ["month", "month"], ["service", "service"], ["kg", "kg"], ["lt", "litre"], ["m", "metre"], ["m2", "m²"]];

function StockDialog({ product, onClose, onSaved }) {
  const { t } = useT();
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [moves, setMoves] = useState([]);
  useEffect(() => { if (product) { setQty(""); setNote(""); api.get(`/products/${product.id}/moves`).then(setMoves).catch(() => {}); } }, [product]);
  if (!product) return null;
  const save = async (sign) => {
    try { await api.post(`/products/${product.id}/stock`, { qty: sign * (parseFloat(qty) || 0), note }); toast.success(t("Stock updated")); onSaved(); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open onClose={onClose} title={t("Stock · {name}", { name: product.name })} description={t("{n} in stock now", { n: product.stock ?? 0 })}>
      <div className="space-y-4" data-testid="stock-dialog">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("Quantity")}><Input type="number" step="any" min="0" value={qty} onChange={(e) => setQty(e.target.value)} data-testid="stock-qty" /></Field>
          <Field label={t("Note")}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. delivery from supplier")} /></Field>
        </div>
        <div className="flex gap-2"><Button className="flex-1" onClick={() => save(1)} disabled={!parseFloat(qty)} data-testid="stock-in">+ {t("Goods in")}</Button><Button variant="secondary" className="flex-1" onClick={() => save(-1)} disabled={!parseFloat(qty)}>− {t("Goods out / write-off")}</Button></div>
        {moves.length > 0 && (
          <ul className="max-h-56 overflow-y-auto divide-y divide-line rounded-xl border border-line text-sm">
            {moves.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2"><span className={`num font-semibold w-14 ${m.qty < 0 ? "text-danger" : "text-success"}`}>{m.qty > 0 ? "+" : ""}{m.qty}</span>
                <span className="flex-1 truncate">{t(m.reason === "sale" ? "Sale" : m.reason === "adjustment" ? "Adjustment" : m.reason === "credit note" ? "Credit note" : m.reason)}{m.ref ? ` · ${m.ref}` : ""}</span><span className="text-[11px] text-muted">{relative(m.created_at)}</span></li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export default function Products() {
  const { t } = useT();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  useEffect(() => { const n = new URLSearchParams(params); q ? n.set("q", q) : n.delete("q"); if (n.toString() !== params.toString()) setParams(n, { replace: true }); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [stockOf, setStockOf] = useState(null);
  const load = useCallback(async () => { resetProducts(); setList(await api.get("/products")); }, []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...editing, unit_price: parseFloat(editing.unit_price) || 0, tax_rate: Number(editing.tax_rate), low_stock: parseFloat(editing.low_stock) || 0 };
      if (editing.id) await api.put(`/products/${editing.id}`, body); else await api.post("/products", body);
      toast.success(t("Saved")); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const del = async (p) => { if (window.confirm(t("Delete {name}?", { name: p.name }))) { await api.del(`/products/${p.id}`); load(); } };
  if (!list) return <PageLoader />;
  const shown = list.filter((p) => !q || `${p.name} ${p.code}`.toLowerCase().includes(q.toLowerCase()));
  const F = (k, label, props = {}) => <Field label={label}><Input value={editing[k] ?? ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} {...props} /></Field>;
  return (
    <div className="animate-in">
      <PageHeader title={t("Products & services")} subtitle={t("Save what you sell once. Pick it on invoices, quotes and receipts — the price fills itself in.")}
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" />{t("Import")}</Button>
          <Button onClick={() => setEditing({ ...EMPTY })} data-testid="new-product"><Plus className="h-4 w-4" />{t("New item")}</Button>
        </>} />
      {list.length === 0 ? (
        <Empty icon={Package} title={t("Nothing saved yet")} text={t("Add the products and services you sell most — or import your price list from Excel.")}
          action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />{t("New item")}</Button><Button variant="secondary" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" />{t("Import from Excel")}</Button></div>} />
      ) : (
        <>
          <div className="relative sm:w-64 mb-4"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={t("Search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Table head={["Name", { label: "Code", className: "hidden md:table-cell" }, { label: "Price", className: "text-right" }, { label: "VAT", className: "text-right hidden sm:table-cell" }, { label: "In stock", className: "text-right" }, { label: "Used", className: "text-right hidden md:table-cell" }, ""]}>
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2/50">
                <td className="td"><p className="font-medium">{p.name}</p><p className="text-[11px] text-muted">{t(p.kind === "goods" ? "Goods" : "Service")} · {t((UNITS.find((u) => u[0] === p.unit) || [, p.unit])[1])}</p></td>
                <td className="td hidden md:table-cell font-mono text-xs">{p.code || "—"}</td>
                <td className="td text-right num font-semibold">{money(p.unit_price)}</td>
                <td className="td text-right num hidden sm:table-cell">{p.tax_rate}%</td>
                <td className="td text-right">{p.track_stock
                  ? <button onClick={() => setStockOf(p)} className="num font-semibold hover:underline" data-testid={`stock-${p.id}`}>{p.stock ?? 0}{p.low_stock > 0 && (p.stock ?? 0) <= p.low_stock && <Badge tone="danger" className="ml-1.5">{t("Low")}</Badge>}</button>
                  : <span className="text-muted">—</span>}</td>
                <td className="td text-right num text-muted hidden md:table-cell">{p.uses || 0}×</td>
                <td className="td"><div className="flex justify-end -mr-2">
                  {p.track_stock && <IconBtn icon={Boxes} label={t("Stock")} onClick={() => setStockOf(p)} />}
                  <IconBtn icon={Pencil} label={t("Edit")} onClick={() => setEditing({ ...EMPTY, ...p })} />
                  <IconBtn icon={Trash2} label={t("Delete")} tone="danger" onClick={() => del(p)} />
                </div></td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <StockDialog product={stockOf} onClose={() => setStockOf(null)} onSaved={() => { setStockOf(null); load(); }} />
      <ImportDialog kind="products" open={importing} onClose={() => setImporting(false)} onDone={load} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? editing.name : t("New item")} width="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>{t("Cancel")}</Button><Button onClick={save} loading={busy} disabled={!editing?.name?.trim()} data-testid="product-save">{t("Save")}</Button></>}>
        {editing && (
          <div className="space-y-4">
            <Segmented value={editing.kind} onChange={(kind) => setEditing({ ...editing, kind })} options={[["service", "Service"], ["goods", "Goods"]]} />
            {F("name", t("Name"), { "data-testid": "product-name", placeholder: t("e.g. Electrical inspection") })}
            <div className="grid grid-cols-2 gap-3">
              {F("unit_price", t("Price before VAT (€)"), { type: "number", step: "any", min: 0, inputMode: "decimal", "data-testid": "product-price" })}
              <Field label={t("VAT rate")}><Select value={editing.tax_rate} onChange={(e) => setEditing({ ...editing, tax_rate: Number(e.target.value) })}>{VAT_RATES.map((r) => <option key={r} value={r}>{r}%</option>)}</Select></Field>
              <Field label={t("Unit")}><Select value={editing.unit} onChange={(e) => setEditing({ ...editing, unit: e.target.value })}>{UNITS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}</Select></Field>
              {F("code", t("Code / SKU (optional)"))}
            </div>
            {editing.kind === "goods" && (
              <div className="rounded-xl border border-line p-3 space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={!!editing.track_stock} onChange={(e) => setEditing({ ...editing, track_stock: e.target.checked })} data-testid="product-track" />{t("Track stock")}</label>
                {editing.track_stock && <Field label={t("Warn me when stock falls to")}><Input type="number" min="0" step="any" value={editing.low_stock} onChange={(e) => setEditing({ ...editing, low_stock: e.target.value })} /></Field>}
                <p className="text-[11px] text-muted">{t("Sales and receipts take stock out automatically; credit notes put it back. The code is used to match online-shop orders (SKU).")}</p>
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}
