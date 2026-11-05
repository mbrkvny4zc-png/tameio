import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, Copy, FilePlus2, FileText, Link2, PackageCheck, Pencil, Printer, ReceiptText, RotateCcw, Search, Send, Trash2, Repeat, Paperclip, Banknote, CreditCard } from "lucide-react";
import { RowMenu } from "@/components/Extras";
import { useProducts } from "@/components/ItemsEditor";
import { api, openFile } from "@/lib/api";
import { date, lineTotals, money, todayISO } from "@/lib/format";
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
    notes: "", status: "draft", issue_date: todayISO(), due_date: "", currency: "EUR", recurring: "none" };
}

export function InvoiceEditor({ value, onClose, onSaved, clients, title }) {
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(value), [value]);
  if (!f) return null;
  const save = async (status) => {
    setBusy(true);
    const body = { ...f, status: status || f.status, due_date: f.due_date || null,
      items: f.items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0 })) };
    try {
      const saved = f.id ? await api.put(`/invoices/${f.id}`, body) : await api.post("/invoices", body);
      toast.success(f.id ? "Invoice updated" : `${saved.number} created`);
      onSaved(saved);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const t = lineTotals(f.items, f.tax_rate);
  return (
    <Sheet open={!!f} onClose={onClose} title={title || (f.id ? `Edit ${f.number}` : "New invoice")} width="max-w-3xl"
      footer={<>
        <Button variant="secondary" onClick={onClose}>{tr("Cancel")}</Button>
        {!f.id && <Button variant="secondary" onClick={() => save("draft")} loading={busy}>{tr("Save draft")}</Button>}
        <Button onClick={() => save(f.id ? undefined : "sent")} loading={busy} disabled={t.total <= 0} data-testid="invoice-save">{f.id ? "Save changes" : "Create invoice"}</Button>
      </>}>
      <div className="space-y-6" data-testid="invoice-editor">
        <ClientPicker clients={clients} value={f} onChange={setF} />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label={tr("Issue date")}><Input type="date" value={f.issue_date || ""} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
          <Field label={tr("Due date")}><Input type="date" value={f.due_date || ""} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
          <Field label={tr("Currency")}><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>{tr("EUR")}</option><option>{tr("USD")}</option><option>{tr("GBP")}</option></Select></Field>
          <Field label={tr("Repeat")}><Select value={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.value })}><option value="none">{tr("Never")}</option><option value="monthly">{tr("Monthly")}</option></Select></Field>
        </div>
        <ItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} taxRate={f.tax_rate} onTaxRate={(tax_rate) => setF({ ...f, tax_rate })} currency={f.currency} />
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

/** Counter sale: a few taps, paid on the spot, reported to myDATA as ΑΛΠ (goods) or ΑΠΥ (services). */
function QuickReceipt({ open, onClose, onDone, biz }) {
  const products = useProducts();
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [rate, setRate] = useState(24);
  const [kind, setKind] = useState("goods");
  const [payment, setPayment] = useState("card");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setItems([{ ...EMPTY_ITEM }]); setRate(biz?.default_tax_rate ?? 24); setEmail(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = lineTotals(items, rate);
  const add = (p) => {
    const blank = items.findIndex((i) => !i.description.trim());
    const line = { description: p.name, qty: 1, unit_price: p.unit_price };
    setItems(blank >= 0 ? items.map((x, j) => (j === blank ? line : x)) : [...items, line]);
    if (items.every((i) => !i.description.trim())) setRate(p.tax_rate);
    api.post(`/products/${p.id}/used`).catch(() => {});
  };
  const issue = async () => {
    setBusy(true);
    try {
      const r = await api.post("/receipts", { items: items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0 })),
        tax_rate: rate, kind, payment, customer_email: email });
      if (r.mydata) toast.success(tr("{n} issued · ΜΑΡΚ {m}", { n: r.receipt.number, m: r.mydata }));
      else toast.message(tr("{n} issued", { n: r.receipt.number }), { description: r.mydata_error ? tr(r.mydata_error) : undefined });
      onDone(r.receipt);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} wide title={tr("Quick receipt")} description={tr("For walk-in customers. It's marked paid and reported to myDATA straight away.")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("Cancel")}</Button><Button onClick={issue} loading={busy} disabled={t.total <= 0} data-testid="receipt-issue">{tr("Issue receipt")} · {money(t.total)}</Button></>}>
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
            <div className="flex gap-2">{[["card", "Card", CreditCard], ["cash", "Cash", Banknote]].map(([k, l, I]) => (
              <button key={k} onClick={() => setPayment(k)} className={`flex-1 h-10 rounded-xl border text-sm font-semibold inline-flex items-center justify-center gap-1.5 ${payment === k ? "border-brand bg-brand-soft text-brand" : "border-line"}`}><I className="h-4 w-4" />{tr(l)}</button>
            ))}</div>
          </Field>
          <Field label={tr("Email a copy (optional)")}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.gr" /></Field>
        </div>
      </div>
    </Modal>
  );
}

export default function Invoices() {
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [clients, setClients] = useState([]);
  const [biz, setBiz] = useState({});
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState(null);
  const [mydataInv, setMydataInv] = useState(null);
  const [creditFor, setCreditFor] = useState(null);
  const [receipt, setReceipt] = useState(false);
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
    if (params.get("receipt")) { setReceipt(true); params.delete("receipt"); setParams(params, { replace: true }); }
    if (params.get("q")) { setQ(params.get("q")); params.delete("q"); setParams(params, { replace: true }); }
  }, [params, list]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Button variant="secondary" onClick={() => setReceipt(true)} data-testid="new-receipt"><ReceiptText className="h-4 w-4" />{tr("Quick receipt")}</Button>
          <Button onClick={() => setEditing(blankInvoice(biz))} data-testid="new-invoice"><FilePlus2 className="h-4 w-4" />{tr("New invoice")}</Button>
        </>} />

      <div className="grid grid-cols-3 gap-3 mb-5">
        {[["Unpaid", totals.unpaid, ""], ["Overdue", totals.overdue, "text-danger"], ["Paid", totals.paid, "text-success"]].map(([l, v, c]) => (
          <div key={l} className="card px-4 py-3"><p className="text-xs text-muted">{l}</p><p className={`num font-bold text-lg ${c}`}>{money(v)}</p></div>
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
              <td className="td"><p className="font-medium">{i.client_name}</p><p className="text-[11px] text-muted">{date(i.issue_date)}{i.paid_via && ` · paid by ${i.paid_via === "viva" ? "card" : "bank"}`}{i.reminders?.length ? ` · ${i.reminders.length} reminder(s)` : ""}</p></td>
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

      <InvoiceEditor value={editing} clients={clients} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />
      <MyDataDialog invoice={mydataInv} onClose={() => setMydataInv(null)} onChanged={async (u) => { const l = await load(); if (u) setMydataInv(l.find((x) => x.id === u.id) || u); }} />
      <QuickReceipt open={receipt} biz={biz} onClose={() => setReceipt(false)} onDone={() => { setReceipt(false); setFilter("receipts"); load(); }} />
      <CreditNoteDialog invoice={creditFor} onClose={() => setCreditFor(null)} onCreated={async (cn) => { setCreditFor(null); const l = await load(); setMydataInv(l.find((x) => x.id === cn.id)); }} />
    </div>
  );
}
