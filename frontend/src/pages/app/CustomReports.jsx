import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CalendarClock, Download, FilePlus2, Mail, Printer, Save, Share2, Sparkles, Trash2, Users } from "lucide-react";
import { api, download } from "@/lib/api";
import { date, money, relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Empty, Field, Input, PageHeader, PageLoader, Select, Textarea, cx } from "@/components/ui";

const PERIOD_LABEL = { this_month: "This month", last_month: "Last month", this_quarter: "This quarter", last_quarter: "Last quarter", this_year: "This year",
  last_year: "Last year", last_30_days: "Last 30 days", last_7_days: "Last 7 days", all_time: "All time", custom: "Custom dates" };
const GROUP_LABEL = { month: "Month", week: "Week", day: "Day", client: "Client", status: "Status", category: "Category", vendor: "Supplier", product: "Product / service",
  payment_method: "Payment method", payment_status: "Paid or unpaid", age: "How late", none: "No grouping (list every document)" };
const METRIC_LABEL = { count: "Count", net: "Net", vat: "VAT", total: "Total", paid: "Paid", balance: "Owed", qty: "Quantity", amount: "Amount" };
const MONEY = new Set(["net", "vat", "total", "paid", "balance", "amount"]);
const BLANK = { name: "", source: "invoices", period: "this_month", start: "", end: "", group_by: "client", metrics: ["count", "total"], status: "", category: "",
  limit: 50, shared: false, schedule: "none", recipients: [], note: "" };

function printReport(res) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const cell = (m, v) => (MONEY.has(m) ? money(v) : v);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(res.name)}</title><style>
  body{font:13px/1.5 Inter,Segoe UI,Arial,sans-serif;color:#17140f;padding:28px} h1{font-size:20px;margin:0} p{color:#6b6257;margin:4px 0 18px}
  table{width:100%;border-collapse:collapse} th,td{padding:7px 8px;border-bottom:1px solid #ece5d8;text-align:right} th:first-child,td:first-child{text-align:left}
  th{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b6257} tfoot td{font-weight:700;border-top:2px solid #17140f}</style></head><body>
  <h1>${esc(res.name)}</h1><p>${esc(res.start)} – ${esc(res.end)}</p>
  <table><thead><tr><th></th>${res.metrics.map((m) => `<th>${esc(METRIC_LABEL[m])}</th>`).join("")}</tr></thead>
  <tbody>${res.rows.map((r) => `<tr><td>${esc(r.key)}${r.label ? ` · ${esc(r.label)}` : ""}</td>${res.metrics.map((m) => `<td>${esc(cell(m, r[m]))}</td>`).join("")}</tr>`).join("")}</tbody>
  <tfoot><tr><td>Total</td>${res.metrics.map((m) => `<td>${esc(cell(m, res.totals[m]))}</td>`).join("")}</tr></tfoot></table>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
  w.document.close();
  return true;
}

/** Build any report: what, when, grouped how, which figures — then save, share, download or schedule it. */
export default function CustomReports() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [saved, setSaved] = useState([]);
  const [f, setF] = useState(BLANK);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/custom-reports").then(setSaved).catch(() => {}), []);
  useEffect(() => { api.get("/custom-reports/meta").then(setMeta).catch((e) => toast.error(e.message)); load(); }, [load]);
  useEffect(() => {
    const id = params.get("id");
    if (id && saved.length) { const r = saved.find((x) => x.id === id); if (r) setF({ ...BLANK, ...r, start: r.start || "", end: r.end || "" }); }
  }, [params, saved]);
  const spec = meta?.sources[f.source];

  // Live preview: re-run whenever the definition changes.
  useEffect(() => {
    if (!meta || (f.period === "custom" && (!f.start || !f.end))) return undefined;
    const id = setTimeout(() => api.post("/custom-reports/run", f).then(setRes).catch((e) => { setRes(null); toast.error(e.message); }), 250);
    return () => clearTimeout(id);
  }, [f.source, f.period, f.start, f.end, f.group_by, f.metrics.join(), f.status, f.category, f.limit, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const setSource = (source) => { const s = meta.sources[source]; setF({ ...f, source, group_by: s.group[0], metrics: s.metrics.slice(0, 3), status: "", category: "" }); };
  const toggleMetric = (m) => setF({ ...f, metrics: f.metrics.includes(m) ? f.metrics.filter((x) => x !== m) : [...f.metrics, m] });
  const useTemplate = (tpl) => { setParams({}); setF({ ...BLANK, ...tpl, name: t(tpl.name) }); };
  const save = async () => {
    setBusy(true);
    try {
      const body = { ...f, start: f.start || null, end: f.end || null };
      const r = f.id ? await api.put(`/custom-reports/${f.id}`, body) : await api.post("/custom-reports", body);
      toast.success(t("Report saved")); setF({ ...BLANK, ...r, start: r.start || "", end: r.end || "" }); setParams({ id: r.id }); load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const del = async () => { if (!window.confirm(t("Delete “{name}”?", { name: f.name }))) return; try { await api.del(`/custom-reports/${f.id}`); setF(BLANK); setParams({}); load(); } catch (e) { toast.error(e.message); } };
  const sendNow = async () => { try { const r = await api.post(`/custom-reports/${f.id}/send`); toast.success(r.emailed ? t("Emailed to {n} people", { n: r.emailed }) : t("Sent to the team in the app (email isn't set up on the server)")); } catch (e) { toast.error(e.message); } };
  const max = useMemo(() => {
    const m = res?.metrics.find((x) => x !== "count") || res?.metrics[0];
    return { m, v: Math.max(1, ...(res?.rows || []).map((r) => Math.abs(r[m] || 0))) };
  }, [res]);

  if (!meta) return <PageLoader />;
  return (
    <div className="animate-in">
      <PageHeader title={t("Custom reports")} subtitle={t("Build the report you need, save it, and send it to your team — once or every week or month.")}
        actions={<Button variant="secondary" onClick={() => { setF(BLANK); setParams({}); }}><FilePlus2 className="h-4 w-4" />{t("New report")}</Button>} />
      <div className="grid xl:grid-cols-[260px_1fr] gap-6 items-start">
        <div className="space-y-5 order-2 xl:order-1">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted mb-2">{t("Saved reports")}</p>
            {saved.length === 0 ? <p className="text-sm text-muted">{t("None yet — start from a template below.")}</p> : (
              <div className="space-y-1">
                {saved.map((r) => (
                  <button key={r.id} onClick={() => setParams({ id: r.id })} className={cx("w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-surface-2", f.id === r.id && "bg-brand-soft text-brand")} data-testid={`saved-report-${r.id}`}>
                    <span className="block font-medium truncate">{r.name}</span>
                    <span className="flex gap-1.5 mt-0.5">{r.shared && <Badge tone="brand">{t("Team")}</Badge>}{r.schedule !== "none" && <Badge tone="violet">{t(r.schedule === "weekly" ? "Weekly" : "Monthly")}</Badge>}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted mb-2">{t("Templates")}</p>
            <div className="space-y-1">
              {meta.templates.map((tpl) => (
                <button key={tpl.name} onClick={() => useTemplate(tpl)} className="w-full text-left rounded-xl px-3 py-2 text-sm hover:bg-surface-2 flex items-center gap-2" data-testid="report-template">
                  <Sparkles className="h-3.5 w-3.5 text-brand shrink-0" /><span className="truncate">{t(tpl.name)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-6 min-w-0 order-1 xl:order-2">
          <Card className="p-5 sm:p-6" data-testid="report-builder">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label={t("Report about")}><Select value={f.source} onChange={(e) => setSource(e.target.value)} data-testid="report-source">
                {Object.entries(meta.sources).map(([k, v]) => <option key={k} value={k}>{t(v.label)}</option>)}</Select></Field>
              <Field label={t("Period")}><Select value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} data-testid="report-period">
                {meta.periods.map((p) => <option key={p} value={p}>{t(PERIOD_LABEL[p])}</option>)}</Select></Field>
              <Field label={t("Group by")}><Select value={f.group_by} onChange={(e) => setF({ ...f, group_by: e.target.value })} data-testid="report-group">
                {spec.group.map((g) => <option key={g} value={g}>{t(GROUP_LABEL[g])}</option>)}</Select></Field>
              {f.source === "invoices" && <Field label={t("Status")}><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                <option value="">{t("All issued")}</option>{["sent", "paid", "overdue", "draft"].map((s) => <option key={s} value={s}>{t(s[0].toUpperCase() + s.slice(1))}</option>)}</Select></Field>}
              {f.source === "expenses" && <Field label={t("Category")}><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                <option value="">{t("All")}</option>{Object.entries(meta.categories).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select></Field>}
            </div>
            {f.period === "custom" && (
              <div className="grid grid-cols-2 gap-3 mt-3 max-w-md">
                <Field label={t("From")}><Input type="date" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></Field>
                <Field label={t("To")}><Input type="date" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></Field>
              </div>
            )}
            <div className="mt-4">
              <p className="label">{t("Figures to show")}</p>
              <div className="flex flex-wrap gap-2">
                {spec.metrics.map((m) => (
                  <button key={m} onClick={() => toggleMetric(m)} data-testid={`metric-${m}`}
                    className={cx("px-3 h-8 rounded-full text-sm border", f.metrics.includes(m) ? "border-brand bg-brand-soft text-brand font-semibold" : "border-line text-muted hover:text-ink")}>{t(METRIC_LABEL[m])}</button>
                ))}
              </div>
            </div>
          </Card>

          <Card className="p-5 sm:p-6" data-testid="report-result">
            {!res ? <PageLoader /> : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div><p className="font-bold">{f.name || t(spec.label)}</p><p className="text-xs text-muted">{date(res.start)} – {date(res.end)} · {t("{n} records", { n: res.records })}</p></div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => !printReport({ ...res, name: f.name || t(spec.label) }) && toast.error(t("Allow pop-ups to print"))}><Printer className="h-3.5 w-3.5" />{t("Print / PDF")}</Button>
                    {f.id && <Button size="sm" variant="secondary" onClick={() => download(`/custom-reports/${f.id}/csv`, `${f.name}.csv`)}><Download className="h-3.5 w-3.5" />CSV</Button>}
                  </div>
                </div>
                {res.rows.length === 0 ? <Empty title={t("No data for this period")} text={t("Try a longer period or a different grouping.")} /> : (
                  <div className="mt-4 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="border-b border-line"><th className="table-head">{t(GROUP_LABEL[res.group_by])}</th>{res.metrics.map((m) => <th key={m} className="table-head text-right">{t(METRIC_LABEL[m])}</th>)}</tr></thead>
                      <tbody>
                        {res.rows.map((r) => (
                          <tr key={r.key + (r.date || "")} className="border-b border-line/60">
                            <td className="td"><span className="font-medium">{r.key}</span>{r.label && <span className="text-muted"> · {r.label}</span>}
                              {res.group_by !== "none" && <div className="h-1 rounded-full bg-surface-2 mt-1.5 max-w-[240px] overflow-hidden"><div className="h-full bg-brand" style={{ width: `${(Math.abs(r[max.m] || 0) / max.v) * 100}%` }} /></div>}</td>
                            {res.metrics.map((m) => <td key={m} className="td text-right num">{MONEY.has(m) ? money(r[m]) : r[m]}</td>)}
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><td className="td font-bold">{t("Total")}</td>{res.metrics.map((m) => <td key={m} className="td text-right num font-bold" data-testid={`total-${m}`}>{MONEY.has(m) ? money(res.totals[m]) : res.totals[m]}</td>)}</tr></tfoot>
                    </table>
                    {res.total_rows > res.rows.length && <p className="text-xs text-muted mt-2">{t("Showing {a} of {b} rows", { a: res.rows.length, b: res.total_rows })}</p>}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card className="p-5 sm:p-6 space-y-4" data-testid="report-save">
            <div className="grid sm:grid-cols-[1fr_auto] gap-3 items-end">
              <Field label={t("Report name")}><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t("e.g. Weekly sales by client")} data-testid="report-name" /></Field>
              <div className="flex gap-2">
                <Button onClick={save} loading={busy} disabled={!f.name.trim()} data-testid="report-save-btn"><Save className="h-4 w-4" />{f.id ? t("Save changes") : t("Save report")}</Button>
                {f.id && <Button variant="ghost" onClick={del} aria-label={t("Delete")}><Trash2 className="h-4 w-4" /></Button>}
              </div>
            </div>
            {meta.can_share ? (
              <div className="grid lg:grid-cols-2 gap-4 pt-2 border-t border-line">
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={f.shared} onChange={(e) => setF({ ...f, shared: e.target.checked })} data-testid="report-shared" /><Share2 className="h-4 w-4 text-muted" />{t("Share with the whole team")}</label>
                  <Field label={t("Send it automatically")}><Select value={f.schedule} onChange={(e) => setF({ ...f, schedule: e.target.value })} data-testid="report-schedule">
                    <option value="none">{t("Don't send automatically")}</option><option value="weekly">{t("Every Monday morning")}</option><option value="monthly">{t("On the 1st of every month")}</option></Select></Field>
                  <Field label={t("Message at the top (optional)")}><Textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder={t("e.g. Please chase anything over 30 days late.")} /></Field>
                </div>
                <div>
                  <p className="label flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />{t("Send to")}</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto">
                    {meta.members.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-sm rounded-lg px-2 py-1.5 hover:bg-surface-2 cursor-pointer">
                        <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={f.recipients.includes(m.id)} data-testid={`recipient-${m.email}`}
                          onChange={(e) => setF({ ...f, recipients: e.target.checked ? [...f.recipients, m.id] : f.recipients.filter((x) => x !== m.id) })} />
                        <span className="flex-1 truncate">{m.name}</span><span className="text-xs text-muted truncate">{m.email}</span>
                      </label>
                    ))}
                  </div>
                  {f.id && f.recipients.length > 0 && <Button size="sm" variant="secondary" className="mt-3" onClick={sendNow} data-testid="report-send-now"><Mail className="h-3.5 w-3.5" />{t("Send now")}</Button>}
                  {f.last_sent && <p className="text-xs text-muted mt-2 flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" />{t("Last sent {when}", { when: relative(f.last_sent) })}</p>}
                </div>
              </div>
            ) : <p className="text-xs text-muted">{t("Your report is private to you. Owners and admins can share reports with the team and schedule them.")}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
