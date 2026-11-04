import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Button, Empty, Field, IconBtn, Input, PageHeader, PageLoader, Sheet, Table, Textarea } from "@/components/ui";
import { translate as tr } from "@/lib/i18n";

const EMPTY = { name: "", company: "", email: "", phone: "", afm: "", doy: "", country: "GR", address: "", city: "", postal_code: "", notes: "" };

export default function Clients() {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => setList(await api.get("/clients")), []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);

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
        actions={<Button onClick={() => setEditing({ ...EMPTY })} data-testid="new-client"><Plus className="h-4 w-4" />{tr("New client")}</Button>} />
      {list.length === 0 ? <Empty icon={Users} title={tr("No clients yet")} text={tr("Add a client once and never type their ΑΦΜ again.")} action={<Button onClick={() => setEditing({ ...EMPTY })}><Plus className="h-4 w-4" />{tr("New client")}</Button>} /> : (
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
                  <IconBtn icon={Pencil} label={tr("Edit")} onClick={() => setEditing({ ...EMPTY, ...c })} />
                  <IconBtn icon={Trash2} label={tr("Delete")} tone="danger" onClick={() => del(c)} />
                </div></td>
              </tr>
            ))}
          </Table>
        </>
      )}
      <Sheet open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? editing.name : "New client"} width="max-w-lg"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>{tr("Cancel")}</Button><Button onClick={save} loading={busy} data-testid="client-save">{tr("Save")}</Button></>}>
        {editing && (
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">{F("name", "Name", { required: true, "data-testid": "client-name-input" })}</div>
            <div className="col-span-2">{F("company", "Company")}</div>
            {F("afm", "ΑΦΜ", { placeholder: "9 digits" })}{F("doy", "ΔΟΥ")}
            {F("email", "Email", { type: "email" })}{F("phone", "Phone")}
            <div className="col-span-2">{F("address", "Address")}</div>
            {F("city", "City")}{F("postal_code", "Postal code")}
            {F("country", "Country", { maxLength: 2 })}
            <div className="col-span-2"><Field label={tr("Notes")}><Textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} /></Field></div>
          </div>
        )}
      </Sheet>
    </div>
  );
}
