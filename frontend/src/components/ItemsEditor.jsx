import { Plus, Trash2 } from "lucide-react";
import { Button, Input, Select, Field } from "@/components/ui";
import { lineTotals, money, VAT_RATES } from "@/lib/format";
import { translate as tr } from "@/lib/i18n";

export const EMPTY_ITEM = { description: "", qty: 1, unit_price: "" };

export function ItemsEditor({ items, onChange, taxRate, onTaxRate, currency = "EUR", taxOptions = VAT_RATES }) {
  const set = (idx, k, v) => onChange(items.map((it, i) => (i === idx ? { ...it, [k]: v } : it)));
  const t = lineTotals(items, taxRate);
  return (
    <div>
      <div className="hidden sm:grid grid-cols-[1fr_80px_110px_100px_36px] gap-2 px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
        <span>{tr("Description")}</span><span className="text-right">{tr("Qty")}</span><span className="text-right">{tr("Unit price")}</span><span className="text-right">{tr("Amount")}</span><span />
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div key={i} className="grid grid-cols-[1fr_70px_96px_32px] sm:grid-cols-[1fr_80px_110px_100px_36px] gap-2 items-center" data-testid={`item-row-${i}`}>
            <Input placeholder={tr("What did you sell?")} value={it.description} onChange={(e) => set(i, "description", e.target.value)} data-testid={`item-desc-${i}`} />
            <Input type="number" inputMode="decimal" min="0" step="any" className="text-right num" value={it.qty} onChange={(e) => set(i, "qty", e.target.value)} aria-label={tr("Quantity")} />
            <Input type="number" inputMode="decimal" min="0" step="any" className="text-right num" placeholder="0.00" value={it.unit_price} onChange={(e) => set(i, "unit_price", e.target.value)} aria-label={tr("Unit price")} data-testid={`item-price-${i}`} />
            <span className="hidden sm:block text-right text-sm num text-muted">{money((parseFloat(it.qty) || 0) * (parseFloat(it.unit_price) || 0), currency)}</span>
            <button type="button" onClick={() => onChange(items.filter((_, j) => j !== i))} disabled={items.length === 1}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-muted hover:text-danger hover:bg-danger/10 disabled:opacity-30" aria-label={tr("Remove line")}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => onChange([...items, { ...EMPTY_ITEM }])}><Plus className="h-4 w-4" />{tr("Add line")}</Button>
      <div className="mt-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-t border-line pt-4">
        <Field label={tr("VAT rate")} className="w-36">
          <Select value={taxRate} onChange={(e) => onTaxRate(parseFloat(e.target.value))} data-testid="tax-rate">
            {taxOptions.map((r) => <option key={r} value={r}>{r}%</option>)}
          </Select>
        </Field>
        <dl className="text-sm min-w-[220px] space-y-1">
          <div className="flex justify-between text-muted"><dt>{tr("Net")}</dt><dd className="num">{money(t.net, currency)}</dd></div>
          <div className="flex justify-between text-muted"><dt>VAT {taxRate}%</dt><dd className="num">{money(t.vat, currency)}</dd></div>
          <div className="flex justify-between font-bold text-base pt-1 border-t border-line"><dt>{tr("Total")}</dt><dd className="num" data-testid="editor-total">{money(t.total, currency)}</dd></div>
        </dl>
      </div>
    </div>
  );
}

/** Pick a saved client, or type a one-off name. */
export function ClientPicker({ clients, value, onChange }) {
  const mode = value.client_id ? "saved" : clients.length ? "saved" : "new";
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field label={tr("Client")}>
        <Select value={value.client_id || ""} onChange={(e) => onChange({ ...value, client_id: e.target.value || null })} data-testid="client-select">
          <option value="">{clients.length ? "— One-off client (type below) —" : "No saved clients yet"}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.afm ? ` · ${c.afm}` : ""}</option>)}
        </Select>
      </Field>
      {!value.client_id && (
        <Field label={mode === "new" ? "Client name" : "Or client name"}>
          <Input value={value.client_name || ""} onChange={(e) => onChange({ ...value, client_name: e.target.value })} placeholder={tr("e.g. Kafeneio Plaka")} data-testid="client-name" />
        </Field>
      )}
      {!value.client_id && (
        <>
          <Field label={tr("Client email")}><Input type="email" value={value.client_email || ""} onChange={(e) => onChange({ ...value, client_email: e.target.value })} /></Field>
          <Field label={tr("Client ΑΦΜ")}><Input value={value.client_afm || ""} onChange={(e) => onChange({ ...value, client_afm: e.target.value })} placeholder={tr("9 digits")} /></Field>
        </>
      )}
    </div>
  );
}
