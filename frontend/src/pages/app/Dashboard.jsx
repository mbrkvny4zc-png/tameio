import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowUpRight, ScanLine, FilePlus2, FileSignature, ReceiptText, AlertTriangle, ShieldCheck, Truck, Clock, CheckCircle2, Circle, TrendingUp, TrendingDown, Landmark,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { compactMoney, money, date } from "@/lib/format";
import { Card, PageLoader, Stat, Badge } from "@/components/ui";
import { translate as tr } from "@/lib/i18n";

const MONTH = (m) => new Date(m + "-01T00:00:00").toLocaleDateString("en-GB", { month: "short" });

export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card shadow-lift px-3 py-2 text-xs">
      <p className="font-semibold mb-1">{new Date(label + "-01T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</p>
      {payload.map((p) => <p key={p.dataKey} className="flex justify-between gap-4"><span className="text-muted">{p.name}</span><span className="num font-semibold">{money(p.value)}</span></p>)}
    </div>
  );
}

export function IncomeExpenseChart({ data, height = 260 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barGap={3} margin={{ left: -12, right: 4, top: 8 }}>
        <CartesianGrid vertical={false} stroke="hsl(var(--line))" />
        <XAxis dataKey="month" tickFormatter={MONTH} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} />
        <YAxis tickFormatter={(v) => compactMoney(v)} tickLine={false} axisLine={false} tick={{ fill: "hsl(var(--muted))", fontSize: 11 }} width={64} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "hsl(var(--surface-2))" }} />
        <Bar dataKey="income" name="Income" fill="hsl(var(--brand))" radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive={false} />
        <Bar dataKey="expenses" name="Expenses" fill="hsl(var(--danger) / 0.55)" radius={[5, 5, 0, 0]} maxBarSize={22} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function Setup({ biz, mydata, invoices, expenses, suppliers }) {
  const steps = [
    ["Add your business details", !!(biz.business_name && biz.afm), "/app/settings"],
    ["Try myDATA (simulation is fine)", mydata.transmitted > 0, "/app/mydata"],
    ["Create your first invoice", invoices > 0, "/app/invoices?new=1"],
    ["Scan a receipt", expenses > 0, "/app/scan"],
    ["Invite a supplier", suppliers > 0, "/app/suppliers"],
  ];
  const done = steps.filter((s) => s[1]).length; if (done === steps.length) return null; return (<Card className="p-5 sm:p-6 mb-6 bg-gradient-to-br from-brand-soft to-surface">
      <div className="flex items-center justify-between gap-3">
        <div><p className="font-bold">{tr("Get set up")}</p><p className="text-sm text-muted">{tr("{a} of {b} done", { a: done, b: steps.length })}</p></div>
        <div className="h-2 w-32 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {steps.map(([t, ok, to]) => (
          <Link key={t} to={to} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm border ${ok ? "border-transparent text-muted line-through" : "border-line bg-surface hover:border-brand/40"}`}>
            {ok ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <Circle className="h-4 w-4 text-muted shrink-0" />}{tr(t)}
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { t, lang } = useT();
  const [d, setD] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/reports/summary"), api.get("/reports/attention"), api.get("/business"), api.get("/mydata/stats"),
      api.get("/invoices"), api.get("/expenses"), api.get("/suppliers"), api.get("/receipt-requests").catch(() => []), api.get("/tax/calendar?months=2").catch(() => ({ items: [] }))])
      .then(([summary, attention, biz, mydata, invoices, expenses, suppliers, requests, calendar]) => setD({ summary, attention, biz, mydata, invoices, expenses, suppliers, requests, calendar }))
      .catch(() => setD(false));
  }, []);

  if (d === null) return <PageLoader />; if (d === false) return <p className="text-muted">{tr("Couldn't load your dashboard. Refresh to try again.")}</p>;
  const { summary: s, attention: a } = d;
  const hour = new Date().getHours();
  const greet = t(hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
  const monthName = new Date().toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { month: "long" });

  const openReq = (d.requests || []).filter((r) => r.status === "open");
  const reqItems = openReq.reduce((n, r) => n + r.items.filter((i) => i.status !== "done").length, 0);
  const nextTax = (d.calendar?.items || []).find((i) => !i.done && i.days_left >= 0 && i.days_left <= 21);
  const alerts = [
    reqItems && [ReceiptText, "brand", t("Your accountant needs {n} receipt(s)", { n: reqItems }), "/app/requests"],
    nextTax && [Landmark, nextTax.days_left <= 7 ? "danger" : "warn", `${lang === "el" ? nextTax.title : nextTax.title_en} — ${nextTax.days_left === 0 ? t("today") : t("in {n} days", { n: nextTax.days_left })}${nextTax.estimate != null ? ` · ${money(nextTax.estimate)}` : ""}`, "/app/calendar"],
    a.overdue_invoices && [AlertTriangle, "danger", t("Overdue invoices: {n}", { n: a.overdue_invoices }), "/app/invoices?filter=overdue"],
    a.mydata_unreported && [ShieldCheck, "warn", t("Not reported to myDATA: {n}", { n: a.mydata_unreported }), "/app/invoices?filter=unreported"],
    a.suppliers_blocked && [Truck, "danger", t("Suppliers missing documents: {n}", { n: a.suppliers_blocked }), "/app/suppliers?filter=blocked"],
    a.suppliers_expiring && [Clock, "warn", t("Supplier documents expiring soon: {n}", { n: a.suppliers_expiring }), "/app/suppliers?filter=attention"],
    a.quotes_open && [FileSignature, "brand", t("Quotes awaiting a reply: {n}", { n: a.quotes_open }), "/app/quotes"],
    a.unpaid_bills && [ReceiptText, "neutral", t("Unpaid bills: {n}", { n: a.unpaid_bills }), "/app/expenses?filter=unpaid"],
    a.draft_invoices && [FilePlus2, "neutral", t("Draft invoices: {n}", { n: a.draft_invoices }), "/app/invoices?filter=draft"],
  ].filter(Boolean);
  const recent = [
    ...d.invoices.slice(0, 6).map((i) => ({ id: i.id, when: i.created_at, title: `${i.number} · ${i.client_name}`, amount: (i.kind === "credit_note" ? -1 : 1) * i.total, type: i.kind === "credit_note" ? "Credit note" : "Invoice", to: "/app/invoices" })),
    ...d.expenses.slice(0, 6).map((x) => ({ id: x.id, when: x.created_at, title: x.vendor_name, amount: -x.total, type: "Expense", to: "/app/expenses" })),
  ].sort((p, q) => q.when.localeCompare(p.when)).slice(0, 7); return (<div className="animate-in">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-sm text-muted">{greet}, {user?.name?.split(" ")[0]}</p>
          <h1 className="text-2xl sm:text-[28px] font-bold">{t("Here's {month} so far", { month: monthName })}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/scan" className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand text-white text-sm font-semibold hover:brightness-110"><ScanLine className="h-4 w-4" />{tr("Scan receipt")}</Link>
          <Link to="/app/invoices?new=1" className="h-10 px-4 inline-flex items-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold hover:bg-surface-2"><FilePlus2 className="h-4 w-4" />{tr("New invoice")}</Link>
          <Link to="/app/quotes?new=1" className="h-10 px-4 hidden sm:inline-flex items-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold hover:bg-surface-2"><FileSignature className="h-4 w-4" />{tr("New quote")}</Link>
        </div>
      </div>

      <Setup biz={d.biz} mydata={d.mydata} invoices={d.invoices.length} expenses={d.expenses.length} suppliers={d.suppliers.length} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label={tr("Income (net)")} value={money(s.income.net)} sub={t("{x} collected", { x: money(s.income.collected) })} icon={TrendingUp} />
        <Stat label={tr("Expenses (net)")} value={money(s.expenses.net)} sub={t("Categories: {n}", { n: s.categories.length })} icon={TrendingDown} />
        <Stat label={tr("Profit")} value={money(s.profit)} tone={s.profit >= 0 ? "success" : "danger"} sub={s.margin != null ? t("{n}% margin", { n: s.margin }) : "—"} />
        <Stat label={tr("VAT to pay (est.)")} value={money(s.vat.payable)} tone={s.vat.payable > 0 ? "warn" : "success"} sub={t("{a} on sales − {b} on expenses", { a: money(s.vat.output), b: money(s.vat.input) })} icon={Landmark} />
      </div>

      <div className="mt-6 grid lg:grid-cols-[1fr_360px] gap-6">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div><p className="font-bold">{tr("Income vs expenses")}</p><p className="text-xs text-muted">{tr("Last 12 months, net of VAT")}</p></div>
            <div className="flex gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />{tr("Income")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger/55" />{tr("Expenses")}</span>
            </div>
          </div>
          <IncomeExpenseChart data={s.monthly} />
        </Card>

        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-3">{tr("Needs your attention")}</p>
          {alerts.length === 0 ? (
            <div className="py-8 text-center"><CheckCircle2 className="h-8 w-8 text-success mx-auto" /><p className="text-sm text-muted mt-2">{tr("Nothing waiting on you.")}</p></div>
          ) : (
            <div className="space-y-1">
              {alerts.map(([Icon, tone, text, to]) => (
                <Link key={text} to={to} className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 hover:bg-surface-2 group">
                  <span className={`h-8 w-8 rounded-lg flex items-center justify-center ${{ danger: "bg-danger/10 text-danger", warn: "bg-warn/10 text-warn", brand: "bg-brand-soft text-brand", neutral: "bg-surface-2 text-muted" }[tone]}`}><Icon className="h-4 w-4" /></span>
                  <span className="text-sm flex-1">{text}</span>
                  <ArrowUpRight className="h-4 w-4 text-muted opacity-0 group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-line grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-muted">{tr("Owed to you")}</p><p className="num font-bold">{money(s.receivables.total)}</p></div>
            <div><p className="text-xs text-muted">{tr("Bills to pay")}</p><p className="num font-bold">{money(s.expenses.unpaid)}</p></div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-3">{tr("Recent activity")}</p>
          {recent.length === 0 ? <p className="text-sm text-muted py-6 text-center">{tr("Your invoices and expenses will show up here.")}</p> : (
            <div className="divide-y divide-line">
              {recent.map((r) => (
                <Link key={r.type + r.id} to={r.to} className="flex items-center gap-3 py-2.5">
                  <Badge tone={r.type === "Expense" ? "danger" : r.type === "Credit note" ? "violet" : "brand"}>{tr(r.type)}</Badge>
                  <span className="text-sm flex-1 truncate">{r.title}</span>
                  <span className={`num text-sm font-semibold ${r.amount < 0 ? "text-muted" : ""}`}>{money(r.amount)}</span>
                  <span className="text-[11px] text-muted w-20 text-right hidden sm:block">{date(r.when)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-3"><p className="font-bold">{tr("Where the money went")}</p><Link to="/app/reports" className="text-xs font-semibold text-brand">{tr("Reports →")}</Link></div>
          {s.categories.length === 0 ? <p className="text-sm text-muted py-6 text-center">{tr("Scan a receipt to see spending by category.")}</p> : (
            <div className="space-y-3">
              {s.categories.slice(0, 6).map((c) => (
                <div key={c.key}>
                  <div className="flex justify-between text-sm"><span>{tr(c.label)}</span><span className="num font-semibold">{money(c.total)}</span></div>
                  <div className="mt-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${(c.total / s.categories[0].total) * 100}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
