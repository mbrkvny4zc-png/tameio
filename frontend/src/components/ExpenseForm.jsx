import { Field, Input, Select } from "@/components/ui";
import { translate as tr } from "@/lib/i18n";

export function ExpenseForm({ draft, categories, onChange }) {
  const set = (k, v) => {
    const next = { ...draft, [k]: v };
    if (k === "net" || k === "vat") next.total = Math.round(((parseFloat(next.net) || 0) + (parseFloat(next.vat) || 0)) * 100) / 100;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label={tr("Paid to")} className="col-span-2"><Input value={draft.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} data-testid="scan-vendor" /></Field>
      <Field label={tr("Their ΑΦΜ")}><Input value={draft.vendor_afm || ""} onChange={(e) => set("vendor_afm", e.target.value)} /></Field>
      <Field label={tr("Date")}><Input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} /></Field>
      <Field label={tr("Category")} className="col-span-2">
        <Select value={draft.category} onChange={(e) => set("category", e.target.value)} data-testid="scan-category">
          {categories.map((c) => <option key={c.key} value={c.key}>{tr(c.label)}</option>)}
        </Select>
      </Field>
      <Field label={tr("Description")} className="col-span-2"><Input value={draft.description || ""} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label={tr("Net")}><Input type="number" step="0.01" inputMode="decimal" className="num text-right" value={draft.net} onChange={(e) => set("net", e.target.value)} data-testid="scan-net" /></Field>
      <Field label={tr("VAT")}><Input type="number" step="0.01" inputMode="decimal" className="num text-right" value={draft.vat} onChange={(e) => set("vat", e.target.value)} data-testid="scan-vat" /></Field>
      <Field label={tr("Total")}><Input type="number" step="0.01" inputMode="decimal" className="num text-right font-semibold" value={draft.total} onChange={(e) => set("total", e.target.value)} data-testid="scan-total" /></Field>
      <Field label={tr("Paid?")}>
        <Select value={draft.payment_status} onChange={(e) => set("payment_status", e.target.value)}><option value="paid">{tr("Paid")}</option><option value="unpaid">{tr("To pay")}</option></Select>
      </Field>
      <Field label={tr("Payment method")}>
        <Select value={draft.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
          <option value="card">{tr("Card")}</option><option value="cash">{tr("Cash")}</option><option value="bank_transfer">{tr("Bank transfer")}</option><option value="other">{tr("Other")}</option>
        </Select>
      </Field>
      <Field label={tr("Document no.")}><Input value={draft.document_number || ""} onChange={(e) => set("document_number", e.target.value)} /></Field>
      <Field label="ΜΑΡΚ" className="col-span-2"><Input value={draft.mark || ""} onChange={(e) => set("mark", e.target.value)} className="font-mono" /></Field>
    </div>
  );
}
