import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowRight, ClipboardList, FileSignature, Pencil, Plus, Printer, Search, Send, ShoppingCart, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { date, lineTotals, money, todayISO } from "@/lib/format";
import { printDocument } from "@/lib/print";
import { Badge, Button, Empty, Field, IconBtn, Input, PageHeader, PageLoader, Select, Sheet, Table, Textarea } from "@/components/ui";
import { ClientPicker, EMPTY_ITEM, ItemsEditor } from "@/components/ItemsEditor";
import { translate as tr } from "@/lib/i18n";

const CONFIG = {
  quote: {
    title: "Quotes", one: "quote", icon: FileSignature, subtitle: "Send a price, let clients accept online, then turn it into an order or invoice.",
    statuses: { draft: ["Draft", "neutral"], sent: ["Sent", "brand"], accepted: ["Accepted", "success"], declined: ["Declined", "danger"], expired: ["Expired", "warn"] },
    convert: [["sales_order", "Sales order"], ["invoice", "Invoice"]], dateLabel: "Valid until", party: "client",
    empty: "Quotes you send can be accepted or declined by your client with one click.",
  },
  sales_order: {
    title: "Sales orders", one: "sales order", icon: ClipboardList, subtitle: "Confirmed work and deliveries, ready to invoice.",
    statuses: { draft: ["Draft", "neutral"], confirmed: ["Confirmed", "brand"], fulfilled: ["Fulfilled", "success"], cancelled: ["Cancelled", "danger"] },
    convert: [["invoice", "Invoice"]], dateLabel: "Deliver by", party: "client",
    empty: "Accepted quotes become sales orders — or create one directly.",
  },
  purchase_order: {
    title: "Purchase orders", one: "purchase order", icon: ShoppingCart, subtitle: "Order from suppliers; received orders become expenses.",
    statuses: { draft: ["Draft", "neutral"], sent: ["Sent", "brand"], received: ["Received", "success"], cancelled: ["Cancelled", "danger"] },
    convert: [["expense", "Expense"]], dateLabel: "Needed by", party: "supplier",
    empty: "Send purchase orders to suppliers and record them as expenses when goods arrive.",
  },
};
const TONE = { neutral: "bg-surface-2 text-muted", brand: "bg-brand-soft text-brand", success: "bg-success/10 text-success", danger: "bg-danger/10 text-danger", warn: "bg-warn/10 text-warn" };

function DocEditor({ type, value, onClose, onSaved, clients, suppliers }) {
  const C = CONFIG[type];
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(value), [value]);
  if (!f) return null;
  const save = async () => {
    setBusy(true);
    const body = { doc_type: type, client_id: f.client_id || null, supplier_id: f.supplier_id || null,
      party_name: C.party === "supplier" ? f.supplier_name : f.client_name, party_email: C.party === "supplier" ? f.supplier_email : f.client_email,
      items: f.items.filter((i) => i.description.trim()).map((i) => ({ description: i.description, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0 })),
      tax_rate: f.tax_rate, notes: f.notes, status: f.status, issue_date: f.issue_date, valid_until: f.valid_until || null, currency: f.currency };
    try {
      const saved = f.id ? await api.put(`/documents/${f.id}`, body) : await api.post("/documents", body);
      toast.success(f.id ? "Saved" : `${saved.number} created`);
      onSaved(saved);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} title={f.id ? `Edit ${f.number}` : `New ${C.one}`} width="max-w-3xl"
      footer={<><Button variant="secondary" onClick={onClose}>{tr("Cancel")}</Button><Button onClick={save} loading={busy} disabled={lineTotals(f.items, f.tax_rate).total <= 0} data-testid="doc-save">{f.id ? "Save" : `Create ${C.one}`}</Button></>}>
      <div className="space-y-6">
        {C.party === "client" ? <ClientPicker clients={clients} value={f} onChange={setF} /> : (
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label={tr("Supplier")}>
              <Select value={f.supplier_id || ""} onChange={(e) => setF({ ...f, supplier_id: e.target.value || null })}>
                <option value="">{suppliers.length ? "— One-off supplier (type below) —" : "No saved suppliers yet"}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            {!f.supplier_id && <Field label={tr("Supplier name")}><Input value={f.supplier_name || ""} onChange={(e) => setF({ ...f, supplier_name: e.target.value })} /></Field>}
            {!f.supplier_id && <Field label={tr("Supplier email")}><Input type="email" value={f.supplier_email || ""} onChange={(e) => setF({ ...f, supplier_email: e.target.value })} /></Field>}
          </div>
        )}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label={tr("Date")}><Input type="date" value={f.issue_date || ""} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
          <Field label={C.dateLabel}><Input type="date" value={f.valid_until || ""} onChange={(e) => setF({ ...f, valid_until: e.target.value })} /></Field>
          <Field label={tr("Currency")}><Select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}><option>{tr("EUR")}</option><option>{tr("USD")}</option><option>{tr("GBP")}</option></Select></Field>
        </div>
        <ItemsEditor items={f.items} onChange={(items) => setF({ ...f, items })} taxRate={f.tax_rate} onTaxRate={(tax_rate) => setF({ ...f, tax_rate })} currency={f.currency} />
        <Field label={tr("Notes")}><Textarea value={f.notes || ""} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={type === "quote" ? "Scope, timing, what's included…" : ""} /></Field>
      </div>
    </Sheet>
  );
}

export default function Documents({ type }) {
  const C = CONFIG[type];
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [clients, setClients] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [biz, setBiz] = useState({});
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const [docs, cl, sp, b] = await Promise.all([api.get(`/documents?type=${type}`), api.get("/clients"), api.get("/suppliers"), api.get("/business")]);
    setList(docs); setClients(cl); setSuppliers(sp); setBiz(b);
  }, [type]);
  useEffect(() => { setList(null); load().catch(() => setList([])); }, [load]);

  const blank = () => ({ client_id: null, client_name: "", client_email: "", supplier_id: null, supplier_name: "", supplier_email: "", items: [{ ...EMPTY_ITEM }],
    tax_rate: biz.default_tax_rate ?? 24, notes: "", status: "draft", issue_date: todayISO(), valid_until: "", currency: "EUR" });
  useEffect(() => {
    if (params.get("new") && list) { setEditing(blank()); params.delete("new"); setParams(params, { replace: true }); }
    const draft = params.get("draft") && list ? JSON.parse(sessionStorage.getItem("tameio_draft") || "null") : null;
    if (draft) {
      sessionStorage.removeItem("tameio_draft");
      setEditing({ ...blank(), client_id: draft.client_id, client_name: draft.client_name, items: draft.items, tax_rate: draft.tax_rate, notes: draft.notes });
      if (draft.questions?.length) toast.message(tr("Drafted by AI — please check"), { description: draft.questions.join(" · ") });
      params.delete("draft"); setParams(params, { replace: true });
    }
  }, [params, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => (list || []).filter((d) => !q || `${d.number} ${d.client_name || d.supplier_name}`.toLowerCase().includes(q.toLowerCase())), [list, q]);

  const send = async (d) => {
    try {
      const r = await api.post(`/documents/${d.id}/send`);
      if (r.emailed) toast.success(tr("Sent"));
      else if (r.url) { await navigator.clipboard?.writeText(r.url).catch(() => {}); toast.message(tr("Email isn't set up — link copied instead"), { description: r.url }); }
      else toast.message(tr("Email isn't set up on the server — marked as sent"));
      load();
    } catch (e) { toast.error(e.message); }
  };
  const convert = async (d, to, label) => {
    if (!window.confirm(`Create ${label.toLowerCase()} from ${d.number}?`)) return;
    try {
      const r = await api.post(`/documents/${d.id}/convert`, { to });
      toast.success(`${r.number} created`, { action: { label: "Open", onClick: () => nav({ invoice: "/app/invoices", sales_order: "/app/sales-orders", expense: "/app/expenses" }[to]) } });
      load();
    } catch (e) { toast.error(e.message); }
  };
  const setStatus = async (d, status) => { try { await api.put(`/documents/${d.id}/status`, { status }); load(); } catch (e) { toast.error(e.message); } };
  const del = async (d) => { if (window.confirm(`Delete ${d.number}?`)) { await api.del(`/documents/${d.id}`).catch((e) => toast.error(e.message)); load(); } };

  if (!list) return <PageLoader />; return (<div className="animate-in">
      <PageHeader title={tr(C.title)} subtitle={tr(C.subtitle)} actions={<Button onClick={() => setEditing(blank())} data-testid="new-doc"><Plus className="h-4 w-4" />New {C.one}</Button>} />
      {list.length === 0 ? (
        <Empty icon={C.icon} title={`No ${C.title.toLowerCase()} yet`} text={C.empty} action={<Button onClick={() => setEditing(blank())}><Plus className="h-4 w-4" />New {C.one}</Button>} />
      ) : (
        <>
          <div className="relative sm:w-64 mb-4"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={tr("Search")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Table head={["Number", C.party === "supplier" ? "Supplier" : "Client", { label: "Total", className: "text-right" }, "Status", { label: C.dateLabel, className: "hidden md:table-cell" }, "Next step", ""]}>
            {shown.map((d) => (
              <tr key={d.id} className="hover:bg-surface-2/50" data-testid={`doc-row-${d.id}`}>
                <td className="td font-semibold">{d.number}<p className="text-[11px] font-normal text-muted">{date(d.issue_date)}</p></td>
                <td className="td">{d.client_name || d.supplier_name}{d.responded_by && <p className="text-[11px] text-muted">by {d.responded_by}</p>}</td>
                <td className="td text-right num font-semibold">{money(d.total, d.currency)}</td>
                <td className="td">
                  <select value={d.status} onChange={(e) => setStatus(d, e.target.value)} aria-label={tr("Status")} className={`chip cursor-pointer border-0 pr-5 appearance-none ${TONE[C.statuses[d.status][1]]}`}>
                    {Object.entries(C.statuses).map(([k, [l]]) => <option key={k} value={k}>{tr(l)}</option>)}
                  </select>
                </td>
                <td className="td text-muted hidden md:table-cell">{d.valid_until ? date(d.valid_until) : "—"}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1.5">
                    {C.convert.map(([to, label]) => d.converted?.[to] ? <Badge key={to} tone="success">{d.converted[to].number}</Badge>
                      : !["declined", "cancelled"].includes(d.status) && (
                        <button key={to} onClick={() => convert(d, to, label)} className="chip bg-surface-2 text-ink hover:bg-brand-soft hover:text-brand" data-testid={`convert-${to}-${d.id}`}>
                          {label}<ArrowRight className="h-3 w-3" />
                        </button>))}
                  </div>
                </td>
                <td className="td">
                  <div className="flex justify-end -mr-2">
                    <IconBtn icon={Send} label={type === "quote" ? "Send for approval" : "Email"} onClick={() => send(d)} />
                    <IconBtn icon={Printer} label={tr("Print / PDF")} onClick={() => printDocument(d, biz, type)} />
                    {!(type === "quote" && ["accepted", "declined"].includes(d.status)) && <IconBtn icon={Pencil} label={tr("Edit")} onClick={() => setEditing({ ...d, valid_until: d.valid_until || "" })} />}
                    <IconBtn icon={Trash2} label={tr("Delete")} tone="danger" onClick={() => del(d)} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {editing && <DocEditor type={type} value={editing} clients={clients} suppliers={suppliers} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
