import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { money, VAT_RATES } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { resetProducts } from "@/components/ItemsEditor";
import { ImportDialog } from "@/components/Extras";
import { Button, Empty, Field, IconBtn, Input, PageHeader, PageLoader, Segmented, Select, Sheet, Table } from "@/components/ui";

const EMPTY = { name: "", code: "", description: "", unit_price: "", tax_rate: 24, unit: "pcs", kind: "service" };
const UNITS = [["pcs", "pieces"], ["hour", "hour"], ["day", "day"], ["month", "month"], ["service", "service"], ["kg", "kg"], ["lt", "litre"], ["m", "metre"], ["m2", "m²"]];

export default function Products() {
  const { t } = useT();
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [importing, setImporting] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { resetProducts(); setList(await api.get("/products")); }, []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...editing, unit_price: parseFloat(editing.unit_price) || 0, tax_rate: Number(editing.tax_rate) };
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
          <Table head={["Name", { label: "Code", className: "hidden md:table-cell" }, { label: "Price", className: "text-right" }, { label: "VAT", className: "text-right hidden sm:table-cell" }, { label: "Used", className: "text-right hidden md:table-cell" }, ""]}>
            {shown.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2/50">
                <td className="td"><p className="font-medium">{p.name}</p><p className="text-[11px] text-muted">{t(p.kind === "goods" ? "Goods" : "Service")} · {t((UNITS.find((u) => u[0] === p.unit) || [, p.unit])[1])}</p></td>
                <td className="td hidden md:table-cell font-mono text-xs">{p.code || "—"}</td>
                <td className="td text-right num font-semibold">{money(p.unit_price)}</td>
                <td className="td text-right num hidden sm:table-cell">{p.tax_rate}%</td>
                <td className="td text-right num text-muted hidden md:table-cell">{p.uses || 0}×</td>
                <td className="td"><div className="flex justify-end -mr-2">
                  <IconBtn icon={Pencil} label={t("Edit")} onClick={() => setEditing({ ...EMPTY, ...p })} />
                  <IconBtn icon={Trash2} label={t("Delete")} tone="danger" onClick={() => del(p)} />
                </div></td>
              </tr>
            ))}
          </Table>
        </>
      )}
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
              {F("code", t("Code (optional)"))}
            </div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
