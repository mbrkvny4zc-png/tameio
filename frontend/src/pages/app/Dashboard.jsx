import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowUpRight, ScanLine, FilePlus2, FileSignature, ReceiptText, AlertTriangle, ShieldCheck, Truck, Clock, CheckCircle2, Circle, TrendingUp, TrendingDown, Landmark,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { compactMoney, money, date } from "@/lib/format";
import { Card, PageLoader, Stat, Badge } from "@/components/ui";

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
  const done = steps.filter((s) => s[1]).length;
  if (done === steps.length) return null;
  return (
    <Card className="p-5 sm:p-6 mb-6 bg-gradient-to-br from-brand-soft to-surface">
      <div className="flex items-center justify-between gap-3">
        <div><p className="font-bold">Get set up</p><p className="text-sm text-muted">{done} of {steps.length} done</p></div>
        <div className="h-2 w-32 rounded-full bg-line overflow-hidden"><div className="h-full bg-brand transition-all" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
      </div>
      <div className="mt-4 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {steps.map(([t, ok, to]) => (
          <Link key={t} to={to} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm border ${ok ? "border-transparent text-muted line-through" : "border-line bg-surface hover:border-brand/40"}`}>
            {ok ? <CheckCircle2 className="h-4 w-4 text-success shrink-0" /> : <Circle className="h-4 w-4 text-muted shrink-0" />}{t}
          </Link>
        ))}
      </div>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [d, setD] = useState(null);

  useEffect(() => {
    Promise.all([api.get("/reports/summary"), api.get("/reports/attention"), api.get("/business"), api.get("/mydata/stats"),
      api.get("/invoices"), api.get("/expenses"), api.get("/suppliers")])
      .then(([summary, attention, biz, mydata, invoices, expenses, suppliers]) => setD({ summary, attention, biz, mydata, invoices, expenses, suppliers }))
      .catch(() => setD(false));
  }, []);

  if (d === null) return <PageLoader />;
  if (d === false) return <p className="text-muted">Couldn't load your dashboard. Refresh to try again.</p>;
  const { summary: s, attention: a } = d;
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Καλημέρα" : hour < 18 ? "Good afternoon" : "Καλησπέρα";
  const monthName = new Date().toLocaleDateString("en-GB", { month: "long" });

  const alerts = [
    a.overdue_invoices && [AlertTriangle, "danger", `${a.overdue_invoices} overdue invoice${a.overdue_invoices > 1 ? "s" : ""}`, "/app/invoices?filter=overdue"],
    a.mydata_unreported && [ShieldCheck, "warn", `${a.mydata_unreported} invoice${a.mydata_unreported > 1 ? "s" : ""} not reported to myDATA`, "/app/invoices?filter=unreported"],
    a.suppliers_blocked && [Truck, "danger", `${a.suppliers_blocked} supplier${a.suppliers_blocked > 1 ? "s" : ""} missing documents`, "/app/suppliers?filter=blocked"],
    a.suppliers_expiring && [Clock, "warn", `${a.suppliers_expiring} supplier document${a.suppliers_expiring > 1 ? "s" : ""} expiring soon`, "/app/suppliers?filter=attention"],
    a.quotes_open && [FileSignature, "brand", `${a.quotes_open} quote${a.quotes_open > 1 ? "s" : ""} awaiting a reply`, "/app/quotes"],
    a.unpaid_bills && [ReceiptText, "neutral", `${a.unpaid_bills} unpaid bill${a.unpaid_bills > 1 ? "s" : ""}`, "/app/expenses?filter=unpaid"],
    a.draft_invoices && [FilePlus2, "neutral", `${a.draft_invoices} draft invoice${a.draft_invoices > 1 ? "s" : ""}`, "/app/invoices?filter=draft"],
  ].filter(Boolean);
  const recent = [
    ...d.invoices.slice(0, 6).map((i) => ({ id: i.id, when: i.created_at, title: `${i.number} · ${i.client_name}`, amount: (i.kind === "credit_note" ? -1 : 1) * i.total, type: i.kind === "credit_note" ? "Credit note" : "Invoice", to: "/app/invoices" })),
    ...d.expenses.slice(0, 6).map((x) => ({ id: x.id, when: x.created_at, title: x.vendor_name, amount: -x.total, type: "Expense", to: "/app/expenses" })),
  ].sort((p, q) => q.when.localeCompare(p.when)).slice(0, 7);

  return (
    <div className="animate-in">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <p className="text-sm text-muted">{greet}, {user?.name?.split(" ")[0]}</p>
          <h1 className="text-2xl sm:text-[28px] font-bold">Here's {monthName} so far</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/app/scan" className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand text-white text-sm font-semibold hover:brightness-110"><ScanLine className="h-4 w-4" />Scan receipt</Link>
          <Link to="/app/invoices?new=1" className="h-10 px-4 inline-flex items-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold hover:bg-surface-2"><FilePlus2 className="h-4 w-4" />New invoice</Link>
          <Link to="/app/quotes?new=1" className="h-10 px-4 hidden sm:inline-flex items-center gap-2 rounded-xl border border-line bg-surface text-sm font-semibold hover:bg-surface-2"><FileSignature className="h-4 w-4" />New quote</Link>
        </div>
      </div>

      <Setup biz={d.biz} mydata={d.mydata} invoices={d.invoices.length} expenses={d.expenses.length} suppliers={d.suppliers.length} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat label="Income (net)" value={money(s.income.net)} sub={`${money(s.income.collected)} collected`} icon={TrendingUp} />
        <Stat label="Expenses (net)" value={money(s.expenses.net)} sub={`${s.categories.length} categor${s.categories.length === 1 ? "y" : "ies"}`} icon={TrendingDown} />
        <Stat label="Profit" value={money(s.profit)} tone={s.profit >= 0 ? "success" : "danger"} sub={s.margin != null ? `${s.margin}% margin` : "—"} />
        <Stat label="VAT to pay (est.)" value={money(s.vat.payable)} tone={s.vat.payable > 0 ? "warn" : "success"} sub={`${money(s.vat.output)} out − ${money(s.vat.input)} in`} icon={Landmark} />
      </div>

      <div className="mt-6 grid lg:grid-cols-[1fr_360px] gap-6">
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div><p className="font-bold">Income vs expenses</p><p className="text-xs text-muted">Last 12 months, net of VAT</p></div>
            <div className="flex gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />Income</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-danger/55" />Expenses</span>
            </div>
          </div>
          <IncomeExpenseChart data={s.monthly} />
        </Card>

        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-3">Needs your attention</p>
          {alerts.length === 0 ? (
            <div className="py-8 text-center"><CheckCircle2 className="h-8 w-8 text-success mx-auto" /><p className="text-sm text-muted mt-2">Nothing waiting on you.</p></div>
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
            <div><p className="text-xs text-muted">Owed to you</p><p className="num font-bold">{money(s.receivables.total)}</p></div>
            <div><p className="text-xs text-muted">Bills to pay</p><p className="num font-bold">{money(s.expenses.unpaid)}</p></div>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid lg:grid-cols-2 gap-6">
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-3">Recent activity</p>
          {recent.length === 0 ? <p className="text-sm text-muted py-6 text-center">Your invoices and expenses will show up here.</p> : (
            <div className="divide-y divide-line">
              {recent.map((r) => (
                <Link key={r.type + r.id} to={r.to} className="flex items-center gap-3 py-2.5">
                  <Badge tone={r.type === "Expense" ? "danger" : r.type === "Credit note" ? "violet" : "brand"}>{r.type}</Badge>
                  <span className="text-sm flex-1 truncate">{r.title}</span>
                  <span className={`num text-sm font-semibold ${r.amount < 0 ? "text-muted" : ""}`}>{money(r.amount)}</span>
                  <span className="text-[11px] text-muted w-20 text-right hidden sm:block">{date(r.when)}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card className="p-5 sm:p-6">
          <div className="flex items-center justify-between mb-3"><p className="font-bold">Where the money went</p><Link to="/app/reports" className="text-xs font-semibold text-brand">Reports →</Link></div>
          {s.categories.length === 0 ? <p className="text-sm text-muted py-6 text-center">Scan a receipt to see spending by category.</p> : (
            <div className="space-y-3">
              {s.categories.slice(0, 6).map((c) => (
                <div key={c.key}>
                  <div className="flex justify-between text-sm"><span>{c.label}</span><span className="num font-semibold">{money(c.total)}</span></div>
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
