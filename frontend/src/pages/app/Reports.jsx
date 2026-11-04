import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Download, Landmark } from "lucide-react";
import { api, download } from "@/lib/api";
import { money, todayISO } from "@/lib/format";
import { Button, Card, Input, PageHeader, PageLoader, Segmented, Stat } from "@/components/ui";
import { IncomeExpenseChart } from "@/pages/app/Dashboard";
import { translate as tr } from "@/lib/i18n";

const PALETTE = ["#2F6BFF", "#7C5CFF", "#0EA5A4", "#F59E0B", "#EF4467", "#22C55E", "#64748B", "#A855F7", "#0EA5E9", "#F97316"];

function rangeFor(preset) {
  const now = new Date(todayISO() + "T00:00:00");
  const y = now.getFullYear(), m = now.getMonth();
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  if (preset === "month") return [iso(new Date(y, m, 1)), todayISO()];
  if (preset === "last") return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
  if (preset === "quarter") return [iso(new Date(y, Math.floor(m / 3) * 3, 1)), todayISO()];
  return [iso(new Date(y, 0, 1)), todayISO()];
}

export default function Reports() {
  const [preset, setPreset] = useState("month");
  const [range, setRange] = useState(rangeFor("month"));
  const [r, setR] = useState(null);
  useEffect(() => { if (preset !== "custom") setRange(rangeFor(preset)); }, [preset]);
  useEffect(() => { setR(null); api.get(`/reports/summary?start=${range[0]}&end=${range[1]}`).then(setR).catch((e) => { toast.error(e.message); setR(false); }); }, [range]);
  const exp = (kind) => download(`/reports/export.csv?kind=${kind}&start=${range[0]}&end=${range[1]}`, `${kind}-${range[0]}-to-${range[1]}.csv`).catch((e) => toast.error(e.message)); return (<div className="animate-in">
      <PageHeader title={tr("Reports")} subtitle={tr("Income vs expenses, profit and your VAT position.")}
        actions={<><Button variant="secondary" onClick={() => exp("invoices")}><Download className="h-4 w-4" />{tr("Invoices CSV")}</Button><Button variant="secondary" onClick={() => exp("expenses")}><Download className="h-4 w-4" />{tr("Expenses CSV")}</Button></>} />
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Segmented value={preset} onChange={setPreset} options={[["month", "This month"], ["last", "Last month"], ["quarter", "This quarter"], ["year", "This year"], ["custom", "Custom"]]} />
        {preset === "custom" && <div className="flex items-center gap-2">
          <Input type="date" className="w-40" value={range[0]} onChange={(e) => setRange([e.target.value, range[1]])} />
          <span className="text-muted">→</span>
          <Input type="date" className="w-40" value={range[1]} onChange={(e) => setRange([range[0], e.target.value])} />
        </div>}
      </div>
      {r === null ? <PageLoader /> : r === false ? null : (<>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Stat label={tr("Income (net)")} value={money(r.income.net)} sub={`+ ${money(r.income.vat)} VAT`} />
            <Stat label={tr("Expenses (net)")} value={money(r.expenses.net)} sub={`+ ${money(r.expenses.vat)} VAT`} />
            <Stat label={tr("Profit")} value={money(r.profit)} tone={r.profit >= 0 ? "success" : "danger"} sub={r.margin != null ? `${r.margin}% margin` : "No income in this period"} />
            <Stat label={tr("Collected")} value={money(r.income.collected)} sub={`${money(r.receivables.total)} still owed`} />
          </div>

          <div className="mt-6 grid lg:grid-cols-[1fr_360px] gap-6">
            <Card className="p-5 sm:p-6"><p className="font-bold">{tr("Last 12 months")}</p><p className="text-xs text-muted mb-4">{tr("Net of VAT")}</p><IncomeExpenseChart data={r.monthly} height={280} /></Card>
            <Card className="p-5 sm:p-6">
              <div className="flex items-center gap-2"><Landmark className="h-4 w-4 text-warn" /><p className="font-bold">{tr("VAT estimate")}</p></div>
              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex justify-between"><dt className="text-muted">{tr("VAT on your sales")}</dt><dd className="num">{money(r.vat.output)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{tr("VAT you paid on expenses")}</dt><dd className="num">− {money(r.vat.input)}</dd></div>
                <div className="flex justify-between pt-2.5 border-t border-line font-bold text-base"><dt>{r.vat.payable >= 0 ? "Estimated VAT to pay" : "Estimated VAT credit"}</dt><dd className={`num ${r.vat.payable > 0 ? "text-warn" : "text-success"}`}>{money(Math.abs(r.vat.payable))}</dd></div>
              </dl>
              <p className="text-[11px] text-muted mt-4 leading-relaxed">{tr("An estimate from what's recorded here. Not every expense's VAT is deductible — confirm with your accountant before filing.")}</p>
            </Card>
          </div>

          <div className="mt-6 grid lg:grid-cols-2 gap-6">
            <Card className="p-5 sm:p-6">
              <p className="font-bold mb-4">{tr("Expenses by category")}</p>
              {r.categories.length === 0 ? <p className="text-sm text-muted py-8 text-center">{tr("No expenses in this period.")}</p> : (
                <div className="grid sm:grid-cols-[180px_1fr] gap-6 items-center">
                  <ResponsiveContainer width="100%" height={180}>
                    <PieChart><Pie data={r.categories} dataKey="total" nameKey="label" innerRadius={52} outerRadius={84} paddingAngle={2} stroke="none">
                      {r.categories.map((c, i) => <Cell key={c.key} fill={PALETTE[i % PALETTE.length]} />)}</Pie>
                      <Tooltip formatter={(v) => money(v)} contentStyle={{ borderRadius: 12, border: "1px solid hsl(var(--line))", background: "hsl(var(--surface))" }} /></PieChart>
                  </ResponsiveContainer>
                  <div className="space-y-2">
                    {r.categories.map((c, i) => (
                      <div key={c.key} className="flex items-center gap-2.5 text-sm">
                        <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                        <span className="flex-1 truncate">{tr(c.label)}</span><span className="text-xs text-muted">{c.count}×</span><span className="num font-semibold w-24 text-right">{money(c.total)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            <div className="grid sm:grid-cols-2 gap-6">
              {[["Top clients", r.top_clients], ["Top vendors", r.top_vendors]].map(([t, rows]) => (
                <Card key={t} className="p-5 sm:p-6">
                  <p className="font-bold mb-3">{t}</p>
                  {rows.length === 0 ? <p className="text-sm text-muted">{tr("Nothing yet.")}</p> : rows.map((x) => (
                    <div key={x.name} className="flex justify-between gap-2 text-sm py-1.5"><span className="truncate">{x.name}</span><span className="num font-semibold">{money(x.net)}</span></div>
                  ))}
                </Card>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
