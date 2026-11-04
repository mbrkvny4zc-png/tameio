import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, Building2, CheckCircle2, Download, Lock, MailPlus, Plus, Search } from "lucide-react";
import { api } from "@/lib/api";
import { money, relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, PageLoader, Segmented } from "@/components/ui";

const STATUS = { attention: ["Needs work", "warn"], ready: ["Ready to close", "success"], closed: ["Closed", "neutral"] };

function monthOptions() {
  const out = [];
  const d = new Date();
  for (let i = 0; i < 12; i++) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function RequestReceipts({ client, period, onClose }) {
  const { t } = useT();
  const [items, setItems] = useState(null);
  const [picked, setPicked] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const as = api.as(client.org_id);
  useEffect(() => {
    as.get(`/receipts/missing?period=${period}`).then((rows) => {
      setItems(rows); setPicked(Object.fromEntries(rows.map((r) => [r.ref_id, true])));
    }).catch(() => setItems([]));
  }, [client.org_id, period]); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async () => {
    setBusy(true);
    try {
      await as.post("/receipt-requests", { items: items.filter((i) => picked[i.ref_id]), message: msg });
      toast.success(t("Request sent to {name}", { name: client.name })); onClose();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} wide title={t("Request missing receipts")} description={t("{name} will get an email and a list to upload from.", { name: client.name })}
      footer={<><Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button><Button onClick={send} loading={busy} disabled={!items?.some((i) => picked[i.ref_id])} data-testid="send-request">{t("Send request")}</Button></>}>
      {!items ? <PageLoader /> : items.length === 0 ? <p className="text-sm text-muted py-6 text-center">{t("Nothing is missing for this month.")}</p> : (
        <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {items.map((i) => (
            <label key={i.ref_id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2 text-sm cursor-pointer hover:bg-surface-2">
              <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={!!picked[i.ref_id]} onChange={(e) => setPicked({ ...picked, [i.ref_id]: e.target.checked })} />
              <span className="text-muted w-24 shrink-0">{i.date}</span><span className="flex-1 truncate">{i.description}</span>
              <Badge>{t(i.kind === "bank" ? "Bank payment" : "Expense")}</Badge><span className="num font-semibold w-20 text-right">{money(i.amount)}</span>
            </label>
          ))}
        </div>
      )}
      <Field label={t("Message (optional)")} className="mt-4"><Input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t("e.g. Needed for the VAT return by Friday")} /></Field>
    </Modal>
  );
}

function AddClient({ onClose, onAdded }) {
  const { t } = useT();
  const [f, setF] = useState({ business_name: "", afm: "", owner_email: "" });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const r = await api.post("/practice/clients", f);
      toast.success(r.invite_url ? t("Client added and invited") : t("Client added"));
      onAdded();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal open onClose={onClose} title={t("Add a client business")} description={t("Set it up now; invite the owner when you're ready.")}
      footer={<><Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button><Button onClick={save} loading={busy} disabled={!f.business_name.trim()} data-testid="add-client-save">{t("Add client")}</Button></>}>
      <div className="space-y-3">
        <Field label={t("Business name")}><Input value={f.business_name} onChange={(e) => setF({ ...f, business_name: e.target.value })} data-testid="add-client-name" /></Field>
        <Field label={t("ΑΦΜ")}><Input value={f.afm} onChange={(e) => setF({ ...f, afm: e.target.value })} placeholder={t("9 digits")} /></Field>
        <Field label={t("Owner's email (optional)")} hint={t("They'll get an invitation to become the owner.")}><Input type="email" value={f.owner_email} onChange={(e) => setF({ ...f, owner_email: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function Practice() {
  const { t } = useT();
  const { switchTo } = useOrg();
  const months = monthOptions();
  const [period, setPeriod] = useState(months[0]);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [requestFor, setRequestFor] = useState(null);
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => setData(await api.get(`/practice/clients?period=${period}`)), [period]);
  useEffect(() => { setData(null); load().catch((e) => toast.error(e.message)); }, [load]);

  const close = async (c) => {
    try { await api.as(c.org_id).post("/practice/close", { period }); toast.success(t("{name}: {period} closed", { name: c.name, period })); load(); }
    catch (e) { toast.error(e.message); }
  };
  const pack = async (c) => {
    let blob;
    try { blob = await api.as(c.org_id).blob(`/export/pack.zip?period=${period}`); } catch { return toast.error(t("Export failed")); }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${c.name}-${period}.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (!data) return <PageLoader />;
  const clients = data.clients.filter((c) => (filter === "all" || c.status === filter) && (!q || `${c.name} ${c.afm}`.toLowerCase().includes(q.toLowerCase())));
  const counts = data.clients.reduce((a, c) => ({ ...a, [c.status]: (a[c.status] || 0) + 1 }), {});
  return (
    <div className="animate-in">
      <PageHeader title={t("My clients")} subtitle={t("Every client's month at a glance — what's missing, what's ready, what's closed.")}
        actions={<>
          <select value={period} onChange={(e) => setPeriod(e.target.value)} className="input w-40" aria-label={t("Month")} data-testid="practice-period">
            {months.map((m) => <option key={m} value={m}>{new Date(m + "-01T00:00:00").toLocaleDateString(undefined, { month: "long", year: "numeric" })}</option>)}
          </select>
          <Button onClick={() => setAdding(true)} data-testid="add-client"><Plus className="h-4 w-4" />{t("Add client")}</Button>
        </>} />
      {data.clients.length === 0 ? (
        <Empty icon={Building2} title={t("No clients yet")} text={t("Ask your clients to invite you from Settings → Team, or add their business yourself.")}
          action={<Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" />{t("Add client")}</Button>} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 justify-between mb-5">
            <Segmented value={filter} onChange={setFilter} options={[["all", `${t("All")} ${data.clients.length}`], ["attention", `${t("Needs work")} ${counts.attention || 0}`],
              ["ready", `${t("Ready")} ${counts.ready || 0}`], ["closed", `${t("Closed")} ${counts.closed || 0}`]]} />
            <div className="relative sm:w-64"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={t("Search clients")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="practice-grid">
            {clients.map((c) => {
              const [label, tone] = STATUS[c.status];
              return (
                <Card key={c.org_id} className="p-5 flex flex-col" data-testid={`client-card-${c.org_id}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="font-bold truncate">{c.name}</p><p className="text-xs text-muted">{c.afm ? `ΑΦΜ ${c.afm}` : t("No ΑΦΜ yet")}{c.last_activity && ` · ${relative(c.last_activity)}`}</p></div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <Badge tone={tone}>{t(label)}</Badge>
                      <button onClick={() => pack(c)} title={t("Export pack (ZIP)")} aria-label={t("Export pack (ZIP)")} className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2"><Download className="h-4 w-4" /></button>
                      {c.status !== "closed" && <button onClick={() => close(c)} title={t("Mark month as closed")} aria-label={t("Mark month as closed")} className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2"><Lock className="h-4 w-4" /></button>}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                    {[["Income", c.figures.income], ["Expenses", c.figures.expenses], ["VAT due", c.figures.vat_payable]].map(([l, v]) => (
                      <div key={l} className="rounded-xl bg-surface-2 py-2"><p className="text-[10px] text-muted">{t(l)}</p><p className="num text-sm font-bold">{money(v)}</p></div>
                    ))}
                  </div>
                  <ul className="mt-4 space-y-1.5 flex-1">
                    {c.checklist.map((i) => (
                      <li key={i.key} className="flex items-center gap-2 text-sm">
                        {i.count === 0 ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <span className="h-4 min-w-4 px-1 rounded-full bg-warn/15 text-warn text-[10px] font-bold flex items-center justify-center shrink-0">{i.count}</span>}
                        <span className={i.count === 0 ? "text-muted" : ""}>{t(i.label)}</span>
                      </li>
                    ))}
                    {c.open_requests > 0 && <li className="text-xs text-brand font-semibold">{t("{n} receipt request(s) waiting on the client", { n: c.open_requests })}</li>}
                    {!c.has_owner && <li className="text-xs text-muted">{t("Owner hasn't joined yet")}</li>}
                  </ul>
                  <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line">
                    <Button size="sm" onClick={() => switchTo(c.org_id, "/app")} data-testid={`open-client-${c.org_id}`}>{t("Open")}<ArrowRight className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" variant="secondary" onClick={() => setRequestFor(c)}><MailPlus className="h-3.5 w-3.5" />{t("Request receipts")}</Button>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
      {requestFor && <RequestReceipts client={requestFor} period={period} onClose={() => { setRequestFor(null); load(); }} />}
      {adding && <AddClient onClose={() => setAdding(false)} onAdded={() => { setAdding(false); load(); }} />}
    </div>
  );
}
