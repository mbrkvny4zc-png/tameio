import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FileSpreadsheet, Mail, Pencil, Plus, Printer, ScrollText, Search, Trash2, Users } from "lucide-react";
import { printStatement } from "@/lib/print";
import { date as fdate } from "@/lib/format";
import { useSearchParams } from "react-router-dom";
import { AfmInput, ImportDialog } from "@/components/Extras";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Button, Empty, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Select, Sheet, Table, Textarea } from "@/components/ui";
import { translate as tr } from "@/lib/i18n";

const EMPTY = { name: "", company: "", email: "", phone: "", afm: "", doy: "", country: "GR", address: "", city: "", postal_code: "", notes: "", language: "el" };

/** Statement of account (καρτέλα πελάτη): invoices, credits and payments with a running balance. */
function Statement({ clientId, onClose }) {
  const [st, setSt] = useState(null);
  const [range, setRange] = useState({ start: "", end: "" });
  useEffect(() => {
    if (!clientId) return;
    const q = new URLSearchParams(Object.entries(range).filter(([, v]) => v)).toString();
    api.get(`/clients/${clientId}/statement${q ? `?${q}` : ""}`).then(setSt).catch((e) => toast.error(e.message));
  }, [clientId, range]);
  if (!clientId) return null;
  const print = async () => { const b = await api.get("/business"); if (!printStatement(st, b)) toast.error(tr("Allow pop-ups to print")); };
  return (
    <Modal open onClose={onClose} wide title={st ? tr("Statement · {name}", { name: st.client.name }) : tr("Statement")}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("Close")}</Button><Button onClick={print} disabled={!st}><Printer className="h-4 w-4" />{tr("Print / PDF")}</Button></>}>
      {!st ? <PageLoader /> : (
        <div className="space-y-4" data-testid="statement">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Field label={tr("From")}><Input type="date" value={range.start} onChange={(e) => setRange({ ...range, start: e.target.value })} /></Field>
            <Field label={tr("To")}><Input type="date" value={range.end} onChange={(e) => setRange({ ...range, end: e.target.value })} /></Field>
            <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-[11px] text-muted">{tr("Invoiced")}</p><p className="num font-bold">{money(st.invoiced)}</p></div>
            <div className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-[11px] text-muted">{tr("Balance")}</p><p className={`num font-bold ${st.closing > 0 ? "text-warn" : "text-success"}`}>{money(st.closing)}</p></div>
          </div>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 sticky top-0"><tr><th className="table-head">{tr("Date")}</th><th className="table-head">{tr("Document")}</th><th className="table-head text-right">{tr("Charges")}</th><th className="table-head text-right">{tr("Payments")}</th><th className="table-head text-right">{tr("Balance")}</th></tr></thead>
              <tbody>
                {st.opening !== 0 && <tr><td className="td text-muted" colSpan={4}>{tr("Opening balance")}</td><td className="td text-right num font-semibold">{money(st.opening)}</td></tr>}
                {st.rows.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="td text-muted whitespace-nowrap">{fdate(r.date)}</td><td className="td"><span className="font-medium">{r.ref}</span> <span className="text-muted">· {tr(r.text)}</span></td>
                    <td className="td text-right num">{r.debit ? money(r.debit) : ""}</td><td className="td text-right num text-success">{r.credit ? money(r.credit) : ""}</td>
                    <td className="td text-right num font-semibold">{money(r.balance)}</td>
                  </tr>
                ))}
                {st.rows.length === 0 && <tr><td className="td text-center text-muted py-8" colSpan={5}>{tr("Nothing in this period.")}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Clients() {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search).get("q") || "");
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statement, setStatement] = useState(null);
  const [params, setParams] = useSearchParams();
  const load = useCallback(async () => setList(await api.get("/clients")), []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);
  useEffect(() => {
    if (!list) return;
    if (params.get("new")) setEditing({ ...EMPTY });
    const o = params.get("open") && list.find((c) => c.id === params.get("open"));
    if (o) setEditing({ ...EMPTY, ...o });
    if (params.get("statement")) setStatement(params.get("statement"));
    if (params.get("new") || params.get("open") || params.get("statement")) setParams(q ? { q } : {}, { replace: true });
  }, [params, list]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const n = new URLSearchParams(params); q ? n.set("q", q) : n.delete("q"); if (n.toString() !== params.toString()) setParams(n, { replace: true }); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const fill = (r) => setEditing((e) => ({ ...e, name: e.name || r.trade_name || r.name, company: e.company || r.name, address: e.address || r.address,
    city: e.city || r.city, postal_code: e.postal_code || r.postal_code, doy: e.doy || r.doy }));

  const save = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, editing[k] || ""]));
      if (editing.id) await api.put(`/clients/${editing.id}`, body); else await api.post("/clients", body);
      toast.success(tr("Client saved")); setEditing(null); load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const del = async (c) => { if (window.confirm(`Delete ${c.name}? Their invoices are kept.`)) { await api.del(`/clients/${c.id}`); load(); } };
  const F = (k, label, props = {}) => <Field label={label}><Input value={editing[k] || ""} onChange={(e) => setEditing({ ...editing, [k]: e.target.value })} {...props} /></Field>; if (!list) return <PageLoader />;
  const shown = list.filter((c) => !q || `${c.name} ${c.company} ${c.afm} ${c.email}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="animate-in">
      <PageHeader title={tr("Clients")} subtitle={tr("Saved details fill in automatically on quotes, invoices and myDATA.")}
        actions={<>
          <Button variant="secondary" onClick={() => setImporting(true)} data-testid="import-clients"><FileSpreadsheet className="h-4 w-4" />{tr("Import")}</Button>
          <Button onClick={() => setEditing({ ...EMPTY })} data-testid="new-client"><Plus className="h-4 w-4" />{tr("New client")}</Button>
        </>} />
      {list.length === 0 ? <Empty icon={Users} title={tr("No clients yet")} text={tr("Type a client's ΑΦΜ and their details fill in by themselves — or import your list from Excel.")}
        action={<div className="flex flex-wrap justify-center gap-2"><Button onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />{tr("New client")}</Button><Button variant="secondary" onClick={() => setImporting(true)}><FileSpreadsheet className="h-4 w-4" />{tr("Import from Excel")}</Button></div>} /> : (
        <>
          <div className="relative sm:w-64 mb-4"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={tr("Search name, ΑΦΜ, email")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <Table head={["Client", { label: "ΑΦΜ", className: "hidden md:table-cell" }, { label: "Contact", className: "hidden lg:table-cell" }, { label: "Billed", className: "text-right" }, { label: "Owed", className: "text-right" }, ""]}>
            {shown.map((c) => (
              <tr key={c.id} className="hover:bg-surface-2/50">
                <td className="td"><p className="font-medium">{c.name}</p>{c.company && <p className="text-[11px] text-muted">{c.company}</p>}</td>
                <td className="td font-mono text-xs hidden md:table-cell">{c.afm || "—"}</td>
                <td className="td text-muted hidden lg:table-cell">{c.email || c.phone || "—"}</td>
                <td className="td text-right num">{money(c.stats?.billed)}</td>
                <td className={`td text-right num font-semibold ${c.stats?.outstanding ? "text-warn" : "text-muted"}`}>{money(c.stats?.outstanding)}</td>
                <td className="td"><div className="flex justify-end -mr-2">
                  {c.email && <a href={`mailto:${c.email}`} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface-2" title={tr("Email")}><Mail className="h-4 w-4" /></a>}
                  <IconBtn icon={ScrollText} label={tr("Statement")} onClick={() => setStatement(c.id)} data-testid={`statement-${c.id}`} />
                  <IconBtn icon={Pencil} label={tr("Edit")} onClick={() => setEditing({ ...EMPTY, ...c })} />
                  <IconBtn icon={Trash2} label={tr("Delete")} tone="danger" onClick={() => del(c)} />
                </div></td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <Statement clientId={statement} onClose={() => setStatement(null)} />
      <ImportDialog kind="clients" open={importing} onClose={() => setImporting(false)} onDone={load} />
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? editing.name : tr("New client")} description={editing?.id ? undefined : tr("Start with the ΑΦΜ — the rest fills in from the registry.")} width="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>{tr("Cancel")}</Button><Button onClick={save} loading={busy} data-testid="client-save">{tr("Save")}</Button></>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <Field label={tr("ΑΦΜ")}><AfmInput value={editing.afm} country={editing.country} onChange={(v) => setEditing((e) => ({ ...e, afm: v }))} onFound={fill} data-testid="client-afm" /></Field>{F("doy", tr("ΔΟΥ"))}
            <div className="col-span-2">{F("name", tr("Name"), { required: true, "data-testid": "client-name-input" })}</div>
            <div className="col-span-2">{F("company", tr("Company"))}</div>
            {F("email", tr("Email"), { type: "email" })}{F("phone", tr("Phone"))}
            <div className="col-span-2">{F("address", tr("Address"))}</div>
            {F("city", tr("City"))}{F("postal_code", tr("Postal code"))}
            {F("country", tr("Country"), { maxLength: 2 })}
            <Field label={tr("Documents in")}><Select value={editing.language || "el"} onChange={(e) => setEditing({ ...editing, language: e.target.value })}><option value="el">Ελληνικά</option><option value="en">English</option></Select></Field>
            <div className="col-span-2"><Field label={tr("Notes")}><Textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
