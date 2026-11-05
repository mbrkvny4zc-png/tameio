import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Activity, AlertOctagon, Bug, Building2, ClipboardCopy, Gauge, Handshake, Lightbulb, MessageCircleQuestion, Play, RefreshCw, Search, Users, Workflow } from "lucide-react";
import { api } from "@/lib/api";
import { date, money, relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Empty, Input, PageHeader, PageLoader, Segmented, Select, Stat, Table, Textarea, cx } from "@/components/ui";
import AdminPartners from "@/pages/app/AdminPartners";
import { FB_STATUS } from "@/pages/app/Feedback";

const copy = (text, t) => navigator.clipboard?.writeText(text).then(() => toast.success(t("Copied — paste it to Claude to get it fixed")));

/* ------------------------------------------------------------ overview */

function Overview() {
  const { t } = useT();
  const [days, setDays] = useState("30");
  const [o, setO] = useState(null);
  useEffect(() => { setO(null); api.get(`/admin/overview?days=${days}`).then(setO).catch((e) => toast.error(e.message)); }, [days]);
  if (!o) return <PageLoader />;
  const max = Math.max(1, ...o.signups.map((d) => d.businesses + d.firms));
  const totalPlans = Object.values(o.plans).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="space-y-6" data-testid="admin-overview">
      <div className="flex justify-end"><Segmented value={days} onChange={setDays} options={[["7", "7 days"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]]} /></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label={t("Monthly revenue (MRR)")} value={money(o.mrr)} sub={t("{n} paying · {arr} a year", { n: o.paying, arr: money(o.arr) })} tone="success" />
        <Stat label={t("Businesses")} value={o.orgs.businesses} sub={t("+{n} new · {a} active", { n: o.orgs.new, a: o.orgs.active })} icon={Building2} />
        <Stat label={t("Users")} value={o.users.total} sub={t("+{n} new · {a} signed in", { n: o.users.new, a: o.users.active })} icon={Users} />
        <Stat label={t("Accounting firms")} value={o.orgs.firms} sub={t("{n} businesses referred", { n: o.orgs.referred })} icon={Handshake} />
      </div>
      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6">
        <Card className="p-5 sm:p-6">
          <p className="font-bold">{t("Sign-ups")}</p>
          <div className="flex items-end gap-[2px] h-32 mt-4" aria-label={t("Sign-ups per day")}>
            {o.signups.map((d) => (
              <div key={d.day} className="flex-1 flex flex-col justify-end h-full" title={`${d.day}: ${d.businesses} + ${d.firms}`}>
                {d.firms > 0 && <div className="bg-violet rounded-t-sm" style={{ height: `${(d.firms / max) * 100}%` }} />}
                <div className={cx("bg-brand", d.firms ? "" : "rounded-t-sm")} style={{ height: `${(d.businesses / max) * 100}%`, minHeight: d.businesses ? 2 : 0 }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[11px] text-muted mt-1"><span>{date(o.signups[0].day)}</span><span className="flex gap-3"><span className="text-brand">■ {t("Businesses")}</span><span className="text-violet">■ {t("Firms")}</span></span><span>{date(o.signups[o.signups.length - 1].day)}</span></div>
        </Card>
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-4">{t("Plans")}</p>
          <div className="space-y-2.5">
            {Object.entries(o.plans).map(([k, n]) => (
              <div key={k} className="text-sm"><div className="flex justify-between"><span className="capitalize">{k}</span><span className="num font-semibold">{n}</span></div>
                <div className="h-1.5 rounded-full bg-surface-2 mt-1 overflow-hidden"><div className="h-full bg-brand" style={{ width: `${(n / totalPlans) * 100}%` }} /></div></div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-4">{t("Usage in this period")}</p>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            {[["Invoices", o.usage.invoices], ["Receipts", o.usage.receipts], ["Credit notes", o.usage.credit_notes], ["Value invoiced", money(o.usage.invoiced_value)],
              ["myDATA sent", `${o.usage.mydata_ok} (${o.usage.mydata_live} ${t("live")})`], ["myDATA failed", o.usage.mydata_failed], ["Receipts scanned", o.usage.scans],
              ["AI questions", o.usage.ai_questions], ["Delivery notes", o.usage.delivery_notes], ["Online-shop orders", o.usage.shop_orders]].map(([l, v]) => (
              <div key={l} className="flex justify-between border-b border-line pb-2"><dt className="text-muted">{t(l)}</dt><dd className="num font-semibold">{v}</dd></div>
            ))}
          </dl>
        </Card>
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-4">{t("Most active businesses")}</p>
          {o.top_businesses.length === 0 ? <p className="text-sm text-muted">{t("No documents in this period.")}</p> : (
            <ol className="space-y-2 text-sm">{o.top_businesses.map((b, i) => <li key={b.org_id} className="flex gap-3"><span className="text-muted w-5">{i + 1}.</span><span className="flex-1 truncate">{b.name}</span><span className="num font-semibold">{b.documents}</span></li>)}</ol>
          )}
          <div className="grid grid-cols-2 gap-3 mt-6">
            <div className="rounded-xl bg-surface-2 p-3"><p className="text-[11px] text-muted">{t("Open reports")}</p><p className="text-xl font-bold num">{o.feedback.new + o.feedback.in_progress}</p></div>
            <div className={cx("rounded-xl p-3", o.errors_24h ? "bg-danger/10" : "bg-surface-2")}><p className="text-[11px] text-muted">{t("Errors in 24 hours")}</p><p className={cx("text-xl font-bold num", o.errors_24h && "text-danger")}>{o.errors_24h}</p></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ users */

function UsersTab() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get(`/admin/users?q=${encodeURIComponent(q)}`).then(setList).catch((e) => toast.error(e.message)), [q]);
  useEffect(() => { const id = setTimeout(load, 250); return () => clearTimeout(id); }, [load]);
  const setPlan = async (orgId, plan) => { try { await api.put(`/admin/orgs/${orgId}/plan`, { plan }); toast.success(t("Plan changed")); load(); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      <div className="relative sm:w-72 mb-4"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={t("Search name or email")} value={q} onChange={(e) => setQ(e.target.value)} data-testid="admin-user-search" /></div>
      {!list ? <PageLoader /> : (
        <Table head={["User", "Businesses", { label: "Joined", className: "hidden md:table-cell" }, { label: "Last sign-in", className: "hidden lg:table-cell" }]}>
          {list.map((u) => (
            <tr key={u.id}>
              <td className="td"><p className="font-medium">{u.name} {u.account_type === "accountant" && <Badge tone="violet">{t("Accountant")}</Badge>}</p><p className="text-[11px] text-muted">{u.email}{u.two_factor ? " · 2FA" : ""}</p></td>
              <td className="td"><div className="space-y-1">{u.orgs.map((o) => (
                <div key={o.org_id} className="flex items-center gap-2 text-sm"><span className="truncate max-w-[180px]">{o.name}</span><span className="text-[11px] text-muted">{t(o.role)}</span>
                  {o.kind === "business" && o.role === "owner" && (
                    <Select className="h-7 w-28 text-xs" value={o.plan || "free"} onChange={(e) => setPlan(o.org_id, e.target.value)} aria-label={t("Plan")}>
                      {["free", "solo", "business", "team"].map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  )}</div>
              ))}</div></td>
              <td className="td hidden md:table-cell text-muted text-sm">{date(u.created_at)}</td>
              <td className="td hidden lg:table-cell text-muted text-sm">{u.last_login_at ? relative(u.last_login_at) : "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ bug reports & ideas */

const KIND_ICON = { bug: Bug, idea: Lightbulb, question: MessageCircleQuestion };

function ReportsTab() {
  const { t } = useT();
  const [status, setStatus] = useState("open");
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [reply, setReply] = useState("");
  const load = useCallback(() => api.get(`/admin/feedback${status === "open" ? "" : `?status=${status}`}`).then((l) => setList(status === "open" ? l.filter((f) => ["new", "in_progress"].includes(f.status)) : l)).catch((e) => toast.error(e.message)), [status]);
  useEffect(() => { load(); }, [load]);
  const update = async (f, body) => { try { await api.put(`/admin/feedback/${f.id}`, body); setReply(""); toast.success(t("Saved — the user is notified")); load(); } catch (e) { toast.error(e.message); } };
  const fixRequest = (f) => `Tameio ${f.kind} report #${f.number} (from ${f.email}, ${f.created_at.slice(0, 10)})\nPage: ${f.page || "—"}\nBrowser: ${f.user_agent || "—"}\n\n${f.message}\n\nPlease investigate and fix this in the tameio repo.`;
  return (
    <div>
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[["open", "Unresolved"], ["new", "Just in"], ["in_progress", "In progress"], ["fixed", "Fixed"], ["wont_fix", "Closed"], ["all", "All"]]} />
      {!list ? <PageLoader /> : list.length === 0 ? <Empty icon={Bug} title={t("Nothing here")} text={t("New reports from users appear here, and you get an email for each one.")} /> : (
        <div className="space-y-3">
          {list.map((f) => {
            const Icon = KIND_ICON[f.kind] || Bug;
            const [label, tone] = FB_STATUS[f.status] || FB_STATUS.new;
            const isOpen = open === f.id;
            return (
              <Card key={f.id} className="p-4" data-testid={`admin-report-${f.number}`}>
                <button className="w-full flex items-start gap-3 text-left" onClick={() => { setOpen(isOpen ? null : f.id); setReply(""); }}>
                  <Icon className={cx("h-4 w-4 mt-1 shrink-0", f.kind === "bug" ? "text-danger" : "text-brand")} />
                  <div className="flex-1 min-w-0"><p className={cx("text-sm", !isOpen && "line-clamp-2")}>{f.message}</p>
                    <p className="text-[11px] text-muted mt-1">#{f.number} · {f.name} ({f.email}) · {relative(f.created_at)}{f.page ? ` · ${f.page}` : ""}</p></div>
                  <Badge tone={tone}>{t(label)}</Badge>
                </button>
                {isOpen && (
                  <div className="mt-4 pl-7 space-y-3">
                    {f.screenshot && <a href={f.screenshot} target="_blank" rel="noreferrer"><img src={f.screenshot} alt="" className="max-h-64 rounded-lg border border-line" /></a>}
                    {f.user_agent && <p className="text-[11px] text-muted break-all">{f.user_agent}</p>}
                    {(f.replies || []).map((r, i) => <div key={i} className="rounded-xl bg-brand-soft px-3 py-2 text-sm"><p className="text-[11px] font-semibold text-brand">{r.by} · {relative(r.at)}</p>{r.text}</div>)}
                    <Textarea rows={2} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={t("Reply to the user (optional) — they see it in the app")} data-testid="admin-reply" />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => update(f, { status: "in_progress", reply })}>{t("Working on it")}</Button>
                      <Button size="sm" onClick={() => update(f, { status: "fixed", reply })} data-testid="admin-mark-fixed">{t("Mark fixed")}</Button>
                      <Button size="sm" variant="ghost" onClick={() => update(f, { status: "wont_fix", reply })}>{t("Close")}</Button>
                      <Button size="sm" variant="ghost" className="ml-auto" onClick={() => copy(fixRequest(f), t)}><ClipboardCopy className="h-3.5 w-3.5" />{t("Copy for fixing")}</Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ crashes */

function ErrorsTab() {
  const { t } = useT();
  const [status, setStatus] = useState("open");
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get(`/admin/errors?status=${status}`).then(setList).catch((e) => toast.error(e.message)), [status]);
  useEffect(() => { load(); }, [load]);
  const resolve = async (e, s) => { await api.put(`/admin/errors/${e.key}`, { status: s }); load(); };
  const fixRequest = (e) => `Tameio ${e.source} error, seen ${e.count}× (first ${e.first_seen.slice(0, 16)}, last ${e.last_seen.slice(0, 16)})\nWhere: ${e.last_page || "—"}\n\n${e.message}\n\n${e.stack}\n\nPlease find the cause and fix it in the tameio repo.`;
  return (
    <div>
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[["open", "Unresolved"], ["resolved", "Resolved"]]} />
      {!list ? <PageLoader /> : list.length === 0 ? <Empty icon={AlertOctagon} title={t("No errors")} text={t("Crashes in the app and server errors are captured here automatically, grouped and counted.")} /> : (
        <div className="space-y-3">
          {list.map((e) => (
            <Card key={e.key} className="p-4">
              <button className="w-full flex items-start gap-3 text-left" onClick={() => setOpen(open === e.key ? null : e.key)}>
                <Badge tone={e.source === "backend" ? "danger" : e.source === "automation" ? "warn" : "violet"}>{e.source}</Badge>
                <div className="flex-1 min-w-0"><p className="text-sm font-mono break-all line-clamp-2">{e.message}</p>
                  <p className="text-[11px] text-muted mt-1">{t("{n}× · last {when}", { n: e.count, when: relative(e.last_seen) })}{e.last_page ? ` · ${e.last_page}` : ""}{e.last_user ? ` · ${e.last_user}` : ""}</p></div>
              </button>
              {open === e.key && (
                <div className="mt-3 space-y-3">
                  {e.stack && <pre className="text-[11px] bg-surface-2 rounded-lg p-3 overflow-x-auto max-h-64 whitespace-pre-wrap">{e.stack}</pre>}
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => copy(fixRequest(e), t)}><ClipboardCopy className="h-3.5 w-3.5" />{t("Copy for fixing")}</Button>
                    {e.status === "open" ? <Button size="sm" onClick={() => resolve(e, "resolved")}>{t("Mark resolved")}</Button> : <Button size="sm" variant="ghost" onClick={() => resolve(e, "open")}>{t("Reopen")}</Button>}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ automations */

function AutomationsTab() {
  const { t } = useT();
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => api.get("/admin/automations").then(setD).catch((e) => toast.error(e.message)), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <PageLoader />;
  const runNow = async (a) => { setBusy(a.name); try { const r = await api.post(`/admin/automations/${a.name}/run`); r.ok ? toast.success(t("{title}: done ({n})", { title: t(a.title), n: r.result })) : toast.error(r.error); load(); } catch (e) { toast.error(e.message); } setBusy(null); };
  const toggle = async (a) => { await api.put(`/admin/automations/${a.name}`, { enabled: !a.enabled }); load(); };
  return (
    <div className="space-y-4" data-testid="admin-automations">
      <p className="text-sm text-muted">{d.scheduler_enabled ? t("Automations run every {n} minutes on the server.", { n: d.interval_minutes }) : t("The scheduler is off on this server (SCHEDULER_ENABLED=false) — use “Run now”.")}</p>
      <div className="grid md:grid-cols-2 gap-4">
        {d.automations.map((a) => (
          <Card key={a.name} className="p-5">
            <div className="flex items-start gap-3">
              <div className={cx("h-9 w-9 rounded-xl flex items-center justify-center shrink-0", a.enabled ? "bg-brand-soft text-brand" : "bg-surface-2 text-muted")}><Workflow className="h-4 w-4" /></div>
              <div className="flex-1 min-w-0"><p className="font-semibold">{t(a.title)}</p><p className="text-xs text-muted mt-0.5">{t(a.description)}</p></div>
              <label className="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={a.enabled} onChange={() => toggle(a)} data-testid={`auto-toggle-${a.name}`} />{a.enabled ? t("On") : t("Off")}
              </label>
            </div>
            <div className="mt-4 flex items-center gap-3 text-xs">
              {a.last_run ? (
                <span className={cx("inline-flex items-center gap-1.5", a.last_run.ok ? "text-success" : "text-danger")}><Activity className="h-3.5 w-3.5" />
                  {a.last_run.ok ? t("Last run {when} · {n} done", { when: relative(a.last_run.started_at), n: a.last_run.result }) : t("Failed {when}: {e}", { when: relative(a.last_run.started_at), e: a.last_run.error })}</span>
              ) : <span className="text-muted">{t("Not run yet")}</span>}
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => runNow(a)} loading={busy === a.name} data-testid={`auto-run-${a.name}`}><Play className="h-3.5 w-3.5" />{t("Run now")}</Button>
            </div>
            {a.recent.length > 1 && (
              <div className="mt-3 flex gap-1" title={t("Last {n} runs", { n: a.recent.length })}>
                {[...a.recent].reverse().map((r) => <span key={r.id} className={cx("h-1.5 flex-1 rounded-full", r.ok ? "bg-success/60" : "bg-danger")} />)}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ page */

export default function Admin() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const tabs = [["overview", t("Overview"), Gauge], ["users", t("Users"), Users], ["reports", t("Bugs & ideas"), Bug], ["errors", t("Errors"), AlertOctagon],
    ["automations", t("Automations"), Workflow], ["partners", t("Partners"), Handshake]];
  const tab = tabs.find(([k]) => k === params.get("tab"))?.[0] || "overview";
  return (
    <div className="animate-in">
      <PageHeader title={t("Management")} subtitle={t("Only you can see this: the whole of Tameio at a glance.")}
        actions={<Button variant="secondary" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" />{t("Refresh")}</Button>} />
      <div className="flex gap-1 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 mb-6 border-b border-line">
        {tabs.map(([k, l, Icon]) => (
          <button key={k} onClick={() => setParams({ tab: k })} data-testid={`admin-tab-${k}`}
            className={cx("flex items-center gap-2 px-3 h-10 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap", tab === k ? "border-brand text-brand" : "border-transparent text-muted hover:text-ink")}>
            <Icon className="h-4 w-4" />{l}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "users" && <UsersTab />}
      {tab === "reports" && <ReportsTab />}
      {tab === "errors" && <ErrorsTab />}
      {tab === "automations" && <AutomationsTab />}
      {tab === "partners" && <AdminPartners embedded />}
    </div>
  );
}
