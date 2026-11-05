import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, Copy, FilePlus2, FileText, Link2, PackageCheck, Pencil, Printer, ReceiptText, RotateCcw, Search, Send, Trash2, Repeat, Paperclip, Banknote, CreditCard, Smartphone, Wallet, Sparkles, ScrollText } from "lucide-react";
import { RowMenu } from "@/components/Extras";
import { useProducts } from "@/components/ItemsEditor";
import { api, openFile } from "@/lib/api";
import { WITHHOLDING, STAMP_DUTY, date, docTotals, lineTotals, money, todayISO } from "@/lib/format";
import { printDocument } from "@/lib/print";
import { Badge, Button, Empty, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Segmented, Select, Sheet, Table, Textarea } from "@/components/ui";
import { ClientPicker, EMPTY_ITEM, ItemsEditor } from "@/components/ItemsEditor";
import { MyDataBadge, MyDataDialog } from "@/components/MyDataDialog";
import { translate as tr } from "@/lib/i18n";

const STATUS = {
  draft: ["Draft", "neutral"], sent: ["Sent", "brand"], paid: ["Paid", "success"], overdue: ["Overdue", "danger"], credited: ["Credit note", "violet"],
};
const FILTERS = [["all", "All"], ["unpaid", "Unpaid"], ["overdue", "Overdue"], ["paid", "Paid"], ["receipts", "Receipts"], ["draft", "Drafts"], ["unreported", "Not in myDATA"], ["credit", "Credit notes"]];

export function blankInvoice(biz) {
  return { client_id: null, client_name: "", client_email: "", client_afm: "", items: [{ ...EMPTY_ITEM }], tax_rate: biz?.default_tax_rate ?? 24,
    notes: "", status: "draft", issue_date: todayISO(), due_date: "", currency: "EUR", recurring: "none",
    withholding_category: 0, stamp_category: 0, iban: "", language: "", delivery: null };
}

const ADDR = { street: "", number: "", postal_code: "", city: "" };
const PURPOSES = [[1, "Sale"], [2, "Sale on behalf of third parties"], [3, "Sampling"], [4, "Exhibition"], [7, "Processing / assembly"], [12, "Warranty"], [13, "Loan"], [19, "Other"]];

function Addr({ label, value, onChange }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="space-y-2">
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-[1fr_72px] gap-2"><Input placeholder={tr("Street")} value={value.street} onChange={set("street")} /><Input placeholder={tr("No.")} value={value.number} onChange={set("number")} /></div>
      <div className="grid grid-cols-[96px_1fr] gap-2"><Input placeholder={tr("Postcode")} value={value.postal_code} onChange={set("postal_code")} /><Input placeholder={tr("City")} value={value.city} onChange={set("city")} /></div>
    </fieldset>
  );
}

/** Less-used invoice options, folded away so the editor stays simple. */
function MoreOptions({ f, setF, biz, clients }) {
  const [open, setOpen] = useState(!!(f.withholding_category || f.stamp_category || f.delivery || f.iban || f.language));
  const client = clients.find((c) => c.id === f.client_id);
  const toggleDN = (on) => setF({ ...f, delivery: on ? {
    enabled: true, move_purpose: 1, dispatch_date: f.issue_date || todayISO(), dispatch_time: new Date().toTimeString().slice(0, 5), vehicle_number: "",
    loading_address: { ...ADDR, street: biz?.address || "", postal_code: biz?.postal_code || "", city: biz?.city || "" },
    delivery_address: { ...ADDR, street: client?.address || f.client_address || "", postal_code: client?.postal_code || f.client_postal_code || "", city: client?.city || f.client_city || "" },
  } : null });
  const dn = f.delivery;
  return (
    <div className="rounded-xl border border-line">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 h-11 text-sm font-semibold" data-testid="invoice-more">
        {tr("Withholding, stamp duty, delivery note & more")}<span className="text-muted text-xs">{open ? tr("Hide") : tr("Show")}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-line pt-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={tr("Withholding tax")} hint={tr("e.g. 20% when a freelancer bills a business")}>
              <Select value={f.withholding_category || 0} onChange={(e) => setF({ ...f, withholding_category: Number(e.target.value) })} data-testid="withholding">
                <option value={0}>{tr("None")}</option>
                {Object.entries(WITHHOLDING).map(([k, [l, p]]) => <option key={k} value={k}>{p}% · {tr(l)}</option>)}
              </Select>
            </Field>
            <Field label={tr("Stamp duty")}>
              <Select value={f.stamp_category || 0} onChange={(e) => setF({ ...f, stamp_category: Number(e.target.value) })}>
                <option value={0}>{tr("None")}</option>
                {Object.entries(STAMP_DUTY).map(([k, p]) => <option key={k} value={k}>{String(p).replace(".", ",")}%</option>)}
              </Select>
            </Field>
            {(biz?.bank_accounts || []).length > 0 && (
              <Field label={tr("Bank account on the invoice")}>
                <Select value={f.iban || ""} onChange={(e) => setF({ ...f, iban: e.target.value })}>
                  <option value="">{biz.iban ? `${tr("Default")} · ${biz.iban}` : tr("Default")}</option>
                  {biz.bank_accounts.map((a) => <option key={a.iban} value={a.iban}>{a.label || a.iban} · …{a.iban.slice(-4)}</option>)}
                </Select>
              </Field>
            )}
            <Field label={tr("Document language")}>
              <Select value={f.language || ""} onChange={(e) => setF({ ...f, language: e.target.value })}>
                <option value="">{tr("Client's language")}</option><option value="el">Ελληνικά</option><option value="en">English</option>
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={!!dn} onChange={(e) => toggleDN(e.target.checked)} data-testid="invoice-dn-toggle" />
            {tr("This invoice is also the delivery note (Τιμολόγιο - Δελτίο Αποστολής)")}
          </label>
          {dn && (
            <div className="space-y-3 rounded-xl bg-surface-2/60 p-3">
              <div className="grid sm:grid-cols-4 gap-2">
                <Field label={tr("Purpose")} className="sm:col-span-2"><Select value={dn.move_purpose} onChange={(e) => setF({ ...f, delivery: { ...dn, move_purpose: Number(e.target.value) } })}>{PURPOSES.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select></Field>
                <Field label={tr("Dispatch date")}><Input type="date" value={dn.dispatch_date} onChange={(e) => setF({ ...f, delivery: { ...dn, dispatch_date: e.target.value } })} /></Field>
                <Field label={tr("Vehicle plate")}><Input value={dn.vehicle_number} onChange={(e) => setF({ ...f, delivery: { ...dn, vehicle_number: e.target.value.toUpperCase() } })} /></Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <Addr label={tr("Loading from")} value={dn.loading_address} onChange={(v) => setF({ ...f, delivery: { ...dn, loading_address: v } })} />
                <Addr label={tr("Delivering to")} value={dn.delivery_address} onChange={(v) => setF({ ...f, delivery: { ...dn, delivery_address: v } })} />
              </div>
              <p className="text-[11px] text-muted">{tr("Report it to myDATA as a sales invoice (1.1).")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function InvoiceEditor({ value, onClose, onSaved, clients, title, biz, hints }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(value), [value]);
  if (!f) return null;
  const save = async (status) => {
    setBusy(true);
    const body = { ...f, status: status || f.status, due_date: f.due_date || null,
      items: f.items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0, ...(i.product_id ? { product_id: i.product_id } : {}) })) };
    try {
      const saved = f.id ? await api.put(`/invoices/${f.id}`, body) : await api.post("/invoices", body);
      toast.success(f.id ? "Invoice updated" : `${saved.number} created`);
      onSaved(saved);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const t = docTotals(f.items, f.tax_rate, f.withholding_category, f.stamp_category);
  t.total = t.payable;
  return (
    <Sheet open={!!f} onClose={onClose} title={title || (f.id ? `Edit ${f.number}` : "New invoice")} width="max-w-3xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{tr("Cancel")}</Button>
        {!f.id && <Button variant="secondary" onClick={() => save("draft")} loading={busy}>{tr("Save draft")}</Button>}
        <Button onClick={() => save(f.id ? undefined : "sent")} loading={busy} disabled={t.total <= 0} data-testid="invoice-save">{f.id ? "Save changes" : "Create invoice"}</Button>
      </>}>
      <div className="space-y-6" data-testid="invoice-editor">
        {hints?.length > 0 && (
          <div className="rounded-xl bg-brand-soft text-sm px-4 py-3" data-testid="draft-hints"><p className="font-semibold text-brand">{tr("Drafted by AI — please check")}</p>
            <ul className="list-disc pl-5 mt-1 text-ink/80">{hints.map((h) => <li key={h}>{h}</li>)}</ul></div>
        )}
        <ClientPicker clients={clients} value={f} onChange={setF} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={tr("Issue date")}><Input type="date" value={f.issue_date || ""} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
          <Field label={tr("Due date")}><Input type="date" value={f.due_date || ""} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label={tr("Currency")}><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>{tr("EUR")}</option><option>{tr("USD")}</option><option>{tr("GBP")}</option></Select></Field>
          <Field label={tr("Repeat")}><Select value={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.value })}><option value="none">{tr("Never")}</option><option value="monthly">{tr("Monthly")}</option></Select></Field>
        </div>
        <ItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} taxRate={f.tax_rate} onTaxRate={(tax_rate) => setF({ ...f, tax_rate })} currency={f.currency} />
        {(t.withheld > 0 || t.stamp > 0) && (
          <dl className="text-sm ml-auto max-w-[260px] space-y-1 -mt-3" data-testid="extra-totals">
            {t.withheld > 0 && <div className="flex justify-between text-muted"><dt>{tr("Withholding tax")}</dt><dd className="num">−{money(t.withheld, f.currency)}</dd></div>}
            {t.stamp > 0 && <div className="flex justify-between text-muted"><dt>{tr("Stamp duty")}</dt><dd className="num">{money(t.stamp, f.currency)}</dd></div>}
            <div className="flex justify-between font-bold pt-1 border-t border-line"><dt>{tr("Client pays")}</dt><dd className="num">{money(t.payable, f.currency)}</dd></div>
          </dl>
        )}
        <MoreOptions f={f} setF={setF} biz={biz} clients={clients} />
        <Field label={tr("Notes (printed on the invoice)")}><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={tr("e.g. Thank you for your business")} /></Field>
      </div>
    </Sheet>
  );
}

function CreditNoteDialog({ invoice, onClose, onCreated }) {
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState("full");
  const [lines, setLines] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (invoice) { setReason(""); setMode("full"); setLines(invoice.items.map((i) => ({ ...i }))); } }, [invoice]);
  if (!invoice) return null;
  const items = mode === "full" ? invoice.items : lines;
  const t = lineTotals(items, invoice.tax_rate);
  const create = async () => {
    setBusy(true);
    try {
      const body = { reason, ...(mode === "partial" ? { items: lines.map((l) => ({ description: l.description, qty: parseFloat(l.qty) || 0, unit_price: parseFloat(l.unit_price) || 0 })) } : {}) };
      const cn = await api.post(`/invoices/${invoice.id}/credit-note`, body);
      toast.success(`${cn.number} created — now report it to myDATA`);
      onCreated(cn);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal open={!!invoice} onClose={onClose} title={`Credit note for ${invoice.number}`}
      description={`For refunds, discounts or returns after the invoice was reported. Linked to ΜΑΡΚ ${invoice.mydata?.mark}.`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("Cancel")}</Button><Button onClick={create} loading={busy} disabled={!reason.trim() || t.net <= 0} data-testid="credit-create">Create credit note · {money(t.total)}</Button></>}>
      <div className="space-y-4" data-testid="credit-dialog">
        <Segmented value={mode} onChange={setMode} options={[["full", "Full amount"], ["partial", "Some lines"]]} />
        {mode === "partial" && (
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_72px_96px] gap-2">
                <Input value={l.description} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} />
                <Input type="number" min="0" step="any" className="text-right" value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} aria-label={tr("Quantity")} />
                <Input type="number" min="0" step="any" className="text-right" value={l.unit_price} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, unit_price: e.target.value } : x)))} aria-label={tr("Unit price")} />
              </div>
            ))}
            <p className="text-[11px] text-muted">{tr("Set a quantity to 0 to leave that line out.")}</p>
          </div>
        )}
        <Field label={tr("Reason (printed on the credit note)")}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tr("e.g. 2 units returned")} data-testid="credit-reason" /></Field>
      </div>
    </Modal>
  );
}

const METHODS = [["bank_transfer", "Bank transfer"], ["cash", "Cash"], ["card", "Card"], ["cheque", "Cheque"], ["other", "Other"]];

/** Record part payments ("paid €300 of €800") and see what's left. */
function PaymentsDialog({ invoice, onClose, onChanged }) {
  const [inv, setInv] = useState(invoice);
  const [f, setF] = useState({ amount: "", date: todayISO(), method: "bank_transfer", note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { setInv(invoice); if (invoice) setF({ amount: String(invoice.balance ?? invoice.total), date: todayISO(), method: "bank_transfer", note: "" }); }, [invoice]);
  if (!inv) return null;
  const owed = Math.round(((inv.total || 0) - (inv.paid_amount || 0)) * 100) / 100;
  const add = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/invoices/${inv.id}/payments`, { ...f, amount: parseFloat(f.amount) || 0 });
      setInv(r); onChanged(r); toast.success(r.status === "paid" ? tr("Paid in full") : tr("Payment recorded"));
      setF({ ...f, amount: String(r.balance || ""), note: "" });
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const remove = async (p) => { try { const r = await api.del(`/invoices/${inv.id}/payments/${p.id}`); setInv(r); onChanged(r); } catch (e) { toast.error(e.message); } };
  return (
    <Modal open onClose={onClose} title={tr("Payments for {n}", { n: inv.number })} description={tr("{paid} received of {total}", { paid: money(inv.paid_amount || 0, inv.currency), total: money(inv.total, inv.currency) })}>
      <div className="space-y-4" data-testid="payments-dialog">
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-success" style={{ width: `${Math.min(100, ((inv.paid_amount || 0) / (inv.total || 1)) * 100)}%` }} /></div>
        {(inv.payments || []).length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line text-sm">
            {inv.payments.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2">
                <span className="text-muted w-24">{date(p.date)}</span><span className="flex-1">{tr((METHODS.find((m) => m[0] === p.method) || [, p.method])[1])}{p.note ? ` · ${p.note}` : ""}</span>
                <span className="num font-semibold">{money(p.amount, inv.currency)}</span>
                <IconBtn icon={Trash2} label={tr("Remove")} tone="danger" onClick={() => remove(p)} />
              </li>
            ))}
          </ul>
        )}
        {owed > 0 ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("Amount")}><Input type="number" step="0.01" min="0" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="payment-amount" /></Field>
            <Field label={tr("Date")}><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label={tr("How")}><Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{METHODS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select></Field>
            <Field label={tr("Note")}><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
            <Button className="col-span-2" onClick={add} loading={busy} data-testid="payment-add">{tr("Record payment")} · {tr("{n} still owed", { n: money(owed, inv.currency) })}</Button>
          </div>
        ) : <p className="text-sm text-success font-semibold text-center">{tr("Paid in full")}</p>}
      </div>
    </Modal>
  );
}

/** Counter sale: a few taps, paid on the spot, reported to myDATA as ΑΛΠ (goods) or ΑΠΥ (services). */
function QuickReceipt({ open, onClose, onDone, biz, preset }) {
  const products = useProducts();
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [rate, setRate] = useState(24);
  const [kind, setKind] = useState("goods");
  const [payment, setPayment] = useState("card");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState(null);
  const [waiting, setWaiting] = useState(null);
  useEffect(() => {
    if (!open) return;
    setItems(preset?.items?.length ? preset.items : [{ ...EMPTY_ITEM }]); setRate(preset?.tax_rate ?? biz?.default_tax_rate ?? 24); setEmail(""); setWaiting(null);
    api.get("/pos/settings").then(setPos).catch(() => setPos(null));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Card terminal: poll until the customer has tapped their card.
  useEffect(() => {
    if (!waiting) return undefined;
    let stop = false;
    const tick = async () => {
      try {
        const r = await api.get(`/receipts/${waiting.id}/terminal`);
        if (r.status === "approved") { toast.success(r.mydata ? tr("{n} issued · ΜΑΡΚ {m}", { n: waiting.number, m: r.mydata }) : tr("{n} issued", { n: waiting.number })); onDone(waiting); return; }
        if (r.status === "declined") { toast.error(tr("Card declined — try again or take cash")); setWaiting(null); return; }
      } catch { /* keep polling */ }
      if (!stop) setTimeout(tick, 2000);
    };
    const id = setTimeout(tick, 1500);
    return () => { stop = true; clearTimeout(id); };
  }, [waiting]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = lineTotals(items, rate);
  const add = (p) => {
    const blank = items.findIndex((i) => !i.description.trim());
    const line = { description: p.name, qty: 1, unit_price: p.unit_price, product_id: p.id };
    setItems(blank >= 0 ? items.map((x, j) => (j === blank ? line : x)) : [...items, line]);
    if (items.every((i) => !i.description.trim())) setRate(p.tax_rate);
    api.post(`/products/${p.id}/used`).catch(() => {});
  };
  const issue = async () => {
    setBusy(true);
    try {
      const r = await api.post("/receipts", { items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0, ...(i.product_id ? { product_id: i.product_id } : {}) })),
        tax_rate: rate, kind, payment, customer_email: email });
      if (r.awaiting_terminal) {
        await api.post(`/receipts/${r.receipt.id}/terminal`);
        setWaiting(r.receipt); setBusy(false); return;
      }
      if (r.mydata) toast.success(tr("{n} issued · ΜΑΡΚ {m}", { n: r.receipt.number, m: r.mydata }));
      else toast.message(tr("{n} issued", { n: r.receipt.number }), { description: r.mydata_error ? tr(r.mydata_error) : undefined });
      onDone(r.receipt);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} wide title={tr("Quick receipt")} description={tr("For walk-in customers. It's marked paid and reported to myDATA straight away.")}
      footer={waiting ? null : <><Button variant="secondary" onClick={onClose}>{tr("Cancel")}</Button><Button onClick={issue} loading={busy} disabled={t.total <= 0} data-testid="receipt-issue">{tr("Issue receipt")} · {money(t.total)}</Button></>}>
      {waiting ? (
        <div className="py-10 text-center" data-testid="terminal-waiting">
          <div className="mx-auto h-14 w-14 rounded-2xl bg-brand-soft text-brand flex items-center justify-center"><Smartphone className="h-7 w-7 animate-pulse" /></div>
          <p className="font-serif text-2xl mt-4">{tr("Tap or insert the card on the terminal")}</p>
          <p className="text-sm text-muted mt-1">{money(waiting.total)} · {waiting.number}</p>
          <Button variant="secondary" className="mt-6" onClick={async () => { await api.post(`/receipts/${waiting.id}/terminal/cancel`).catch(() => {}); setWaiting(null); }}>{tr("Cancel payment")}</Button>
        </div>
      ) : (
      <div className="space-y-5" data-testid="quick-receipt">
        {products.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {products.slice(0, 10).map((p) => (
              <button key={p.id} onClick={() => add(p)} className="px-3 py-1.5 rounded-full border border-line text-sm hover:bg-surface-2">{p.name} <span className="text-muted num">€{p.unit_price}</span></button>
            ))}
          </div>
        )}
        <ItemsEditor items={items} onChange={setItems} taxRate={rate} onTaxRate={setRate} />
        <div className="grid sm:grid-cols-3 gap-3">
          <Field label={tr("What was sold")}><Segmented value={kind} onChange={setKind} options={[["goods", "Goods"], ["services", "Services"]]} /></Field>
          <Field label={tr("Paid with")}>
            <div className="flex gap-2">{[...(pos?.terminal_id || pos?.simulate ? [["terminal", "Terminal", Smartphone]] : []), ["card", "Card", CreditCard], ["cash", "Cash", Banknote]].map(([k, l, I]) => (
              <button key={k} onClick={() => setPayment(k)} className={`flex-1 h-10 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 ${payment === k ? "border-brand bg-brand-soft text-brand" : "border-line"}`}><I className="h-4 w-4" />{tr(l)}</button>
            ))}</div>
          </Field>
          <Field label={tr("Email a copy (optional)")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.gr" /></Field>
        </div>
      </div>
      )}
    </Modal>
  );
}

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [clients, setClients] = useState([]);
  const [biz, setBiz] = useState({});
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [q, setQ] = useState(params.get("q") || "");
  const [editing, setEditing] = useState(null);
  const [mydataInv, setMydataInv] = useState(null);
  const [creditFor, setCreditFor] = useState(null);
  const [receipt, setReceipt] = useState(false);
  const [paying, setPaying] = useState(null);
  const [hints, setHints] = useState(null);
  const [preset, setPreset] = useState(null);
  const go = useNavigate();

  const load = useCallback(async () => {
    const [inv, cl, b] = await Promise.all([api.get("/invoices"), api.get("/clients"), api.get("/business")]);
    setList(inv); setClients(cl); setBiz(b);
    return inv;
  }, []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);
  useEffect(() => {
    if (!list) return;
    if (params.get("new")) { setEditing(blankInvoice(biz)); params.delete("new"); setParams(params, { replace: true }); }
    const draft = params.get("draft") ? JSON.parse(sessionStorage.getItem("tameio_draft") || "null") : null;
    if (draft) {
      sessionStorage.removeItem("tameio_draft");
      const due = draft.due_in_days ? new Date(Date.now() + draft.due_in_days * 864e5).toISOString().slice(0, 10) : "";
      if (draft.doc_kind === "receipt") { setPreset({ items: draft.items, tax_rate: draft.tax_rate }); setReceipt(true); }
      else { setEditing({ ...blankInvoice(biz), client_id: draft.client_id, client_name: draft.client_name, client_afm: draft.client_afm, items: draft.items, tax_rate: draft.tax_rate, due_date: due, notes: draft.notes }); setHints(draft.questions); }
      params.delete("draft"); setParams(params, { replace: true });
    }
    if (params.get("receipt")) { setReceipt(true); params.delete("receipt"); setParams(params, { replace: true }); }

  }, [params, list]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the search and filter in the address so the view can be pinned or shared.
  useEffect(() => {
    const next = new URLSearchParams(params);
    q ? next.set("q", q) : next.delete("q");
    filter !== "all" ? next.set("filter", filter) : next.delete("filter");
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [q, filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (list || []).filter((i) => {
    const md = i.mydata || {};
    const ok = { all: true, draft: i.status === "draft", unpaid: ["sent", "overdue"].includes(i.status), overdue: i.status === "overdue", paid: i.status === "paid",
      unreported: i.status !== "draft" && !i.imported && !["transmitted", "cancelled"].includes(md.state), credit: i.kind === "credit_note", receipts: i.kind === "receipt" }[filter];
    return ok && (!q || `${i.number} ${i.client_name} ${i.client_company || ""}`.toLowerCase().includes(q.toLowerCase()));
  }), [list, filter, q]);

  const totals = useMemo(() => {
    const L = list || [];
    const sum = (f) => L.filter(f).reduce((s, i) => s + (i.currency === "EUR" ? i.total : 0), 0);
    return { unpaid: sum((i) => ["sent", "overdue"].includes(i.status)), overdue: sum((i) => i.status === "overdue"), paid: sum((i) => i.status === "paid") };
  }, [list]);

  const locked = (i) => i.mydata?.state && ["transmitted", "cancelled"].includes(i.mydata.state) && !i.mydata.simulated;
  const setStatus = async (inv, status) => {
    try { await api.put(`/invoices/${inv.id}/status`, { status }); load(); } catch (e) { toast.error(e.message); }
  };
  const send = async (inv) => {
    if (!inv.client_email) return toast.error(tr("Add the client's email first (edit the invoice or the client)"));
    try {
      const r = await api.post(`/invoices/${inv.id}/send`);
      if (r.emailed) toast.success(`Sent to ${inv.client_email}`);
      else { await navigator.clipboard?.writeText(r.url).catch(() => {}); toast.message(tr("Email isn't set up on the server — link copied instead"), { description: r.url }); }
      load();
    } catch (e) { toast.error(e.message); }
  };
  const remind = async (inv) => {
    try { const r = await api.post(`/invoices/${inv.id}/remind`); r.emailed ? toast.success(`Reminder sent to ${inv.client_email}`) : toast.message(tr("Email isn't set up on the server — reminder recorded")); load(); }
    catch (e) { toast.error(e.message); }
  };
  const share = async (inv) => {
    try { const r = await api.post(`/invoices/${inv.id}/share`); await navigator.clipboard?.writeText(r.url); toast.success(tr("Invoice link copied")); }
    catch (e) { toast.error(e.message); }
  };
  const del = async (inv) => {
    if (!window.confirm(`Delete ${inv.number}?`)) return;
    try { await api.del(`/invoices/${inv.id}`); toast.success(tr("Deleted")); load(); } catch (e) { toast.error(e.message); }
  };
  const duplicate = async (inv) => {
    try { const d = await api.post(`/invoices/${inv.id}/duplicate`); toast.success(tr("{n} created as a draft", { n: d.number })); const l = await load(); const x = l.find((y) => y.id === d.id); if (x && x.kind !== "receipt") setEditing({ ...x, due_date: "" }); }
    catch (e) { toast.error(e.message); }
  };
  const deliveryNote = async (inv) => {
    try { const n = await api.post(`/delivery-notes/from-invoice/${inv.id}`); toast.success(tr("Delivery note {n} drafted from the invoice", { n: n.number })); go(`/app/delivery-notes?open=${n.id}`); }
    catch (e) { toast.error(e.message); }
  };
  const print = async (inv) => { if (!(await printDocument(inv, biz, inv.kind === "credit_note" ? "credit_note" : "invoice"))) toast.error(tr("Allow pop-ups to print")); };

  if (!list) return <PageLoader />; return (<div className="animate-in">
      <PageHeader title={tr("Invoices & receipts")} subtitle={tr("Bill clients, ring up counter sales, get paid — all reported to myDATA.")}
        actions={<>
          <Button variant="secondary" onClick={() => window.dispatchEvent(new Event("tameio:ai-draft"))} data-testid="ai-draft-open"><Sparkles className="h-4 w-4" />{tr("Write with AI")}</Button>
          <Button variant="secondary" onClick={() => { setPreset(null); setReceipt(true); }} data-testid="new-receipt"><ReceiptText className="h-4 w-4" />{tr("Quick receipt")}</Button>
          <Button onClick={() => setEditing(blankInvoice(biz))} data-testid="new-invoice"><FilePlus2 className="h-4 w-4" />{tr("New invoice")}</Button>
        </>} />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[["Unpaid", totals.unpaid, ""], ["Overdue", totals.overdue, "text-danger"], ["Paid", totals.paid, "text-success"]].map(([l, v, c]) => (
          <div key={l} className="card px-4 py-3"><p className="text-xs text-muted">{tr(l)}</p><p className={`num font-bold text-lg ${c}`}>{money(v)}</p></div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center justify-between mb-4">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0"><Segmented value={filter} onChange={setFilter} options={FILTERS} /></div>
        <div className="relative sm:w-64"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={tr("Search invoices")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>

      {list.length === 0 ? (
        <Empty icon={FileText} title={tr("No invoices yet")} text={tr("Create one from scratch, convert an accepted quote, or scan a paper invoice.")}
          action={<Button onClick={() => setEditing(blankInvoice(biz))}><FilePlus2 className="h-4 w-4" />{tr("New invoice")}</Button>} />
      ) : (
        <Table head={["Number", "Client", { label: "Total", className: "text-right" }, "Status", { label: "Due", className: "hidden md:table-cell" }, "myDATA", ""]}>
          {shown.map((i) => (
            <tr key={i.id} className="hover:bg-surface-2/50" data-testid={`invoice-row-${i.id}`}>
              <td className="td font-semibold whitespace-nowrap">
                {i.number}
                {i.kind === "credit_note" && <span className="block text-[11px] font-normal text-violet">→ {i.credit_of_number}</span>}
                {i.recurring === "monthly" && <Repeat className="inline h-3 w-3 ml-1 text-violet" />}
                {i.file && <Paperclip className="inline h-3 w-3 ml-1 text-muted" />}
              </td>
              <td className="td"><p className="font-medium">{i.client_name === "Retail customer" ? tr("Retail customer") : i.client_name}</p><p className="text-[11px] text-muted">{date(i.issue_date)}{i.paid_amount > 0 && i.status !== "paid" ? <span className="text-success font-semibold">{` · ${tr("{a} of {b} paid", { a: money(i.paid_amount), b: money(i.total) })}`}</span> : ""}{i.withheld ? ` · ${tr("withholding")} ${money(i.withheld)}` : ""}{i.delivery ? ` · ${tr("+ delivery note")}` : ""}{i.source?.platform ? ` · ${i.source.platform} ${i.source.order_number}` : ""}{i.paid_via && ` · paid by ${i.paid_via === "viva" ? "card" : "bank"}`}{i.reminders?.length ? ` · ${i.reminders.length} reminder(s)` : ""}</p></td>
              <td className={`td text-right num font-semibold ${i.kind === "credit_note" ? "text-violet" : ""}`}>{i.kind === "credit_note" ? "−" : ""}{money(i.total, i.currency)}</td>
              <td className="td">
                {i.kind === "credit_note" ? <Badge tone="violet">{tr("Credit note")}</Badge> : i.kind === "receipt" ? <Badge tone="success">{tr(i.payment === "cash" ? "Paid · cash" : "Paid · card")}</Badge> : (
                  <select value={i.status} onChange={(e) => setStatus(i, e.target.value)} aria-label={tr("Status")}
                    className={`chip cursor-pointer border-0 pr-5 appearance-none ${{ neutral: "bg-surface-2 text-muted", brand: "bg-brand-soft text-brand", success: "bg-success/10 text-success", danger: "bg-danger/10 text-danger" }[STATUS[i.status][1]]}`}>
                    {["draft", "sent", "paid", "overdue"].map((s) => <option key={s} value={s}>{tr(STATUS[s][0])}</option>)}
                  </select>
                )}
              </td>
              <td className="td text-muted hidden md:table-cell whitespace-nowrap">{i.due_date ? date(i.due_date) : "—"}</td>
              <td className="td">{i.imported ? <span className="text-[11px] text-muted">{tr("Imported")}</span> : <MyDataBadge inv={i} onClick={() => setMydataInv(i)} />}</td>
              <td className="td">
                <div className="flex justify-end items-center -mr-2">
                  {i.kind !== "receipt" && <IconBtn icon={Send} label={tr("Email to client")} onClick={() => send(i)} />}
                  <IconBtn icon={Printer} label={tr("Print / PDF")} onClick={() => print(i)} />
                  {!locked(i) && !["credit_note", "receipt"].includes(i.kind) && <IconBtn icon={Pencil} label={tr("Edit")} onClick={() => setEditing({ ...i, due_date: i.due_date || "" })} />}
                  <RowMenu items={[
                    i.kind === "invoice" && i.status !== "draft" && { label: tr("Record payment"), icon: Wallet, onClick: () => setPaying(i), testid: `pay-${i.id}` },
                    i.client_id && { label: tr("Client statement"), icon: ScrollText, onClick: () => go(`/app/clients?statement=${i.client_id}`) },
                    ["sent", "overdue"].includes(i.status) && i.client_email && { label: tr("Send payment reminder"), icon: BellRing, onClick: () => remind(i) },
                    i.status !== "draft" && { label: tr("Copy client link"), icon: Link2, onClick: () => share(i) },
                    i.kind !== "credit_note" && { label: tr("Duplicate"), icon: Copy, onClick: () => duplicate(i), testid: `dup-${i.id}` },
                    i.kind === "invoice" && { label: tr("Create delivery note"), icon: PackageCheck, onClick: () => deliveryNote(i), testid: `dn-${i.id}` },
                    i.kind === "invoice" && i.mydata?.state === "transmitted" && { label: tr("Issue credit note"), icon: RotateCcw, onClick: () => setCreditFor(i), testid: `credit-${i.id}` },
                    i.file && { label: tr("Original scan"), icon: Paperclip, onClick: () => openFile(`/scans/${i.scan_id}/file`).catch(() => toast.error(tr("File not available"))) },
                    !locked(i) && { label: tr("Delete"), icon: Trash2, tone: "danger", onClick: () => del(i) },
                  ]} />
                </div>
              </td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={7} className="text-center text-sm text-muted py-10">{tr("Nothing matches this filter.")}</td></tr>}
        </Table>
      )}

      <InvoiceEditor value={editing} clients={clients} biz={biz} hints={hints} onClose={() => { setEditing(null); setHints(null); }} onSaved={() => { setEditing(null); setHints(null); load(); }} />
      <PaymentsDialog invoice={paying} onClose={() => setPaying(null)} onChanged={() => load()} />
      <MyDataDialog invoice={mydataInv} onClose={() => setMydataInv(null)} onChanged={async (u) => { const l = await load(); if (u) setMydataInv(l.find((x) => x.id === u.id) || u); }} />
      <QuickReceipt open={receipt} biz={biz} preset={preset} onClose={() => setReceipt(false)} onDone={() => { setReceipt(false); setFilter("receipts"); load(); }} />
      <CreditNoteDialog invoice={creditFor} onClose={() => setCreditFor(null)} onCreated={async (cn) => { setCreditFor(null); const l = await load(); setMydataInv(l.find((x) => x.id === cn.id)); }} />
    </div>
  );
}
