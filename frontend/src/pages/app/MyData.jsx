import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { api } from "@/lib/api";
import { relative } from "@/lib/format";
import { Badge, Button, Card, Field, Input, PageHeader, PageLoader, Select, Table } from "@/components/ui";
import { ENV_META } from "@/components/MyDataDialog";
import { translate as tr } from "@/lib/i18n";

export default function MyData() {
  const [s, setS] = useState(null);
  const [form, setForm] = useState(null);
  const [stats, setStats] = useState(null);
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [st, sts, lg] = await Promise.all([api.get("/mydata/settings"), api.get("/mydata/stats"), api.get("/mydata/transmissions")]);
    setS(st); setForm({ ...st, subscription_key: "" }); setStats(sts); setLog(lg);
  }, []);
  useEffect(() => { load().catch((e) => toast.error(e.message)); }, [load]);

  const save = async (e) => {
    e.preventDefault(); setBusy(true);
    try {
      const body = { vat_number: form.vat_number, branch: parseInt(form.branch, 10) || 0, series: form.series, environment: form.environment, aade_user_id: form.aade_user_id };
      if (form.subscription_key) body.subscription_key = form.subscription_key;
      const r = await api.put("/mydata/settings", body);
      setS(r); setForm({ ...r, subscription_key: "" }); toast.success(tr("myDATA settings saved"));
    } catch (e2) { toast.error(e2.message); }
    setBusy(false);
  };

  if (!s || !form) return <PageLoader />; const E = ENV_META[s.environment]; return (<div className="animate-in">
      <PageHeader title={tr("myDATA")} subtitle={tr("Your connection to AADE, and everything you've reported.")} />
      <div className="grid lg:grid-cols-[380px_1fr] gap-6 items-start">
        <Card className="p-5 sm:p-6">
          <form onSubmit={save} className="space-y-4">
            <div className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-brand" /><p className="font-bold">{tr("AADE connection")}</p><Badge tone={E.tone} className="ml-auto">{tr(E.label)}</Badge></div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={tr("Business ΑΦΜ")} className="col-span-2"><Input value={form.vat_number} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} placeholder={tr("from your business profile")} /></Field>
              <Field label={tr("Branch")}><Input type="number" min={0} value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} /></Field>
            </div>
            <Field label={tr("Invoice series")} hint={tr("Numbers in a series are gap-free and assigned when a document is reported.")}><Input value={form.series} onChange={(e) => setForm({ ...form, series: e.target.value })} /></Field>
            <Field label={tr("Mode")} hint={tr(ENV_META[form.environment].hint)}>
              <Select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })} data-testid="mydata-env">
                {Object.entries(ENV_META).map(([k, m]) => <option key={k} value={k}>{tr(m.label)}</option>)}
              </Select>
            </Field>
            {form.environment !== "simulation" && <>
              <Field label={tr("AADE user ID")}><Input value={form.aade_user_id} autoComplete="off" onChange={(e) => setForm({ ...form, aade_user_id: e.target.value })} /></Field>
              <Field label={tr("Subscription key")} hint={s.has_subscription_key ? `Saved (${s.subscription_key_hint}). Leave blank to keep it.` : "From your myDATA REST API registration on myAADE. Stored encrypted."}>
                <Input type="password" autoComplete="new-password" value={form.subscription_key} onChange={(e) => setForm({ ...form, subscription_key: e.target.value })} />
              </Field>
            </>}
            <Button className="w-full" loading={busy}>{tr("Save")}</Button>
          </form>
        </Card>
        <div className="space-y-4 min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[["transmitted", "With ΜΑΡΚ", "text-success"], ["pending", "Not reported", "text-warn"], ["rejected", "Rejected", "text-danger"], ["cancelled", "Cancelled", "text-muted"]].map(([k, l, c]) => (
              <Card key={k} className="p-4"><p className={`num text-2xl font-bold ${c}`}>{stats[k]}</p><p className="text-xs text-muted">{l}</p></Card>
            ))}
          </div>
          {stats.pending > 0 && <p className="text-sm rounded-xl bg-warn/10 text-warn px-4 py-3">{stats.pending} issued document{stats.pending === 1 ? " is" : "s are"} not in myDATA yet. <Link to="/app/invoices?filter=unreported" className="font-semibold underline">{tr("Review them")}</Link>.</p>}
          <p className="font-bold pt-2">{tr("Transmission log")}</p>
          {log.length === 0 ? <Card className="p-8 text-center text-sm text-muted">{tr("Nothing sent yet.")}</Card> : (
            <Table head={["When", "Document", "Action", "Mode", "Result"]}>
              {log.map((e) => (
                <tr key={e.id}>
                  <td className="td text-muted whitespace-nowrap">{relative(e.created_at)}</td>
                  <td className="td font-medium">{e.invoice_number}<p className="text-[11px] text-muted font-normal">{e.client_name}</p></td>
                  <td className="td capitalize">{e.action}</td>
                  <td className="td"><Badge tone={ENV_META[e.environment]?.tone}>{tr(ENV_META[e.environment]?.label) || e.environment}</Badge></td>
                  <td className="td">{e.ok ? <span className="font-mono text-success text-xs">{e.mark}</span> : <span className="text-danger text-xs">{(e.errors || []).map((x) => `${x.code} ${x.message}`.trim()).join("; ") || e.status}</span>}</td>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
