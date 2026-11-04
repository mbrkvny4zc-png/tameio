import { Field, Input, Select } from "@/components/ui";

export function ExpenseForm({ draft, categories, onChange }) {
  const set = (k, v) => {
    const next = { ...draft, [k]: v };
    if (k === "net" || k === "vat") next.total = Math.round(((parseFloat(next.net) || 0) + (parseFloat(next.vat) || 0)) * 100) / 100;
    onChange(next);
  };
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Paid to" className="col-span-2"><Input value={draft.vendor_name} onChange={(e) => set("vendor_name", e.target.value)} data-testid="scan-vendor" /></Field>
      <Field label="Their ΑΦΜ"><Input value={draft.vendor_afm || ""} onChange={(e) => set("vendor_afm", e.target.value)} /></Field>
      <Field label="Date"><Input type="date" value={draft.date} onChange={(e) => set("date", e.target.value)} /></Field>
      <Field label="Category" className="col-span-2">
        <Select value={draft.category} onChange={(e) => set("category", e.target.value)} data-testid="scan-category">
          {categories.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </Select>
      </Field>
      <Field label="Description" className="col-span-2"><Input value={draft.description || ""} onChange={(e) => set("description", e.target.value)} /></Field>
      <Field label="Net"><Input type="number" step="0.01" inputMode="decimal" className="num text-right" value={draft.net} onChange={(e) => set("net", e.target.value)} data-testid="scan-net" /></Field>
      <Field label="VAT"><Input type="number" step="0.01" inputMode="decimal" className="num text-right" value={draft.vat} onChange={(e) => set("vat", e.target.value)} data-testid="scan-vat" /></Field>
      <Field label="Total"><Input type="number" step="0.01" inputMode="decimal" className="num text-right font-semibold" value={draft.total} onChange={(e) => set("total", e.target.value)} data-testid="scan-total" /></Field>
      <Field label="Paid?">
        <Select value={draft.payment_status} onChange={(e) => set("payment_status", e.target.value)}><option value="paid">Paid</option><option value="unpaid">To pay</option></Select>
      </Field>
      <Field label="Payment method">
        <Select value={draft.payment_method} onChange={(e) => set("payment_method", e.target.value)}>
          <option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Document no."><Input value={draft.document_number || ""} onChange={(e) => set("document_number", e.target.value)} /></Field>
      <Field label="ΜΑΡΚ" className="col-span-2"><Input value={draft.mark || ""} onChange={(e) => set("mark", e.target.value)} className="font-mono" /></Field>
    </div>
  );
}
