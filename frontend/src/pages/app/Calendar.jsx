import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, Check, Plus, Settings2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { date, money, todayISO } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Select } from "@/components/ui";

const KIND = { vat: ["VAT", "brand"], efka: ["e-ΕΦΚΑ", "violet"], income_tax: ["Income tax", "warn"], custom: ["Custom", "neutral"] };

function SettingsDialog({ onClose, onSaved }) {
  const { t } = useT();
  const [s, setS] = useState(null);
  useEffect(() => { api.get("/tax/settings").then(setS).catch(() => {}); }, []);
  const save = async () => {
    try { await api.put("/tax/settings", s); toast.success(t("Saved")); onSaved(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open onClose={onClose} title={t("Your tax deadlines")} footer={<><Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button><Button onClick={save}>{t("Save")}</Button></>}>
      {!s ? <PageLoader /> : (
        <div className="space-y-4">
          <Field label={t("VAT returns")}><Select value={s.vat_period} onChange={(e) => setS({ ...s, vat_period: e.target.value })}>
            <option value="quarterly">{t("Quarterly")}</option><option value="monthly">{t("Monthly")}</option><option value="none">{t("Not VAT registered")}</option></Select></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={s.efka_monthly} onChange={(e) => setS({ ...s, efka_monthly: e.target.checked })} />{t("I pay monthly e-ΕΦΚΑ contributions (self-employed)")}</label>
          <Field label={t("Income tax return deadline (MM-DD)")} hint={t("The date changes some years — update it when it's announced.")}><Input value={s.income_tax_month_day} onChange={(e) => setS({ ...s, income_tax_month_day: e.target.value })} className="w-32" /></Field>
          <div>
            <p className="label">{t("Your own deadlines")}</p>
            <div className="space-y-2">
              {s.custom.map((c, i) => (
                <div key={c.id || i} className="flex gap-2">
                  <Input value={c.title} onChange={(e) => setS({ ...s, custom: s.custom.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder={t("e.g. ENFIA installment")} />
                  <Input type="date" className="w-40" value={c.date} onChange={(e) => setS({ ...s, custom: s.custom.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                  <IconBtn icon={Trash2} label={t("Remove")} tone="danger" onClick={() => setS({ ...s, custom: s.custom.filter((_, j) => j !== i) })} />
                </div>
              ))}
            </div>
            <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={() => setS({ ...s, custom: [...s.custom, { title: "", date: todayISO() }] })}><Plus className="h-4 w-4" />{t("Add deadline")}</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Calendar() {
  const { t, lang } = useT();
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => setData(await api.get("/tax/calendar?months=6")), []);
  useEffect(() => { load().catch(() => setData({ items: [] })); }, [load]);
  const toggle = async (it) => { await api.post("/tax/done", { key: it.key, done: !it.done }); load(); };
  if (!data) return <PageLoader />;
  const upcoming = data.items.filter((i) => !i.done);
  const next = upcoming[0];
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title={t("Tax calendar")} subtitle={t("What's due and roughly how much — so nothing sneaks up on you.")}
        actions={<Button variant="secondary" onClick={() => setEditing(true)}><Settings2 className="h-4 w-4" />{t("Settings")}</Button>} />
      {next && (
        <Card className="p-5 sm:p-6 mb-5 bg-gradient-to-br from-brand-soft to-surface" data-testid="next-deadline">
          <p className="text-xs font-semibold text-brand uppercase tracking-wider">{t("Next up")}</p>
          <p className="text-xl font-bold mt-1">{lang === "el" ? next.title : next.title_en}</p>
          <p className="text-sm text-muted">{date(next.date)} · {next.days_left === 0 ? t("today") : t("in {n} days", { n: next.days_left })}</p>
          {next.estimate != null && <p className="mt-3 text-sm">{t("Estimated VAT")}: <b className="num text-lg">{money(next.estimate)}</b></p>}
        </Card>
      )}
      <Card className="divide-y divide-line">
        {data.items.length === 0 && <p className="p-8 text-center text-sm text-muted">{t("No deadlines in the next months.")}</p>}
        {data.items.map((it) => {
          const [k, tone] = KIND[it.kind];
          const overdue = it.days_left < 0 && !it.done;
          return (
            <div key={it.key} className={`flex items-center gap-4 px-4 sm:px-5 py-4 ${it.done ? "opacity-55" : ""}`} data-testid={`deadline-${it.key}`}>
              <div className="w-14 text-center shrink-0">
                <p className="text-[10px] uppercase text-muted">{new Date(it.date + "T00:00:00").toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { month: "short" })}</p>
                <p className={`text-2xl font-bold num ${overdue ? "text-danger" : ""}`}>{it.date.slice(8)}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`font-semibold ${it.done ? "line-through" : ""}`}>{lang === "el" ? it.title : it.title_en}</p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5"><Badge tone={tone}>{t(k)}</Badge>
                  {it.estimate != null && <span className="text-xs text-muted">{t("est.")} <b className="num text-ink">{money(it.estimate)}</b></span>}
                  {overdue && <span className="text-xs text-danger font-semibold">{t("overdue")}</span>}</div>
              </div>
              <button onClick={() => toggle(it)} className={`h-9 w-9 rounded-xl border flex items-center justify-center ${it.done ? "bg-success text-white border-success" : "border-line text-muted hover:border-success hover:text-success"}`}
                aria-label={it.done ? t("Mark as not done") : t("Mark as done")}><Check className="h-4 w-4" /></button>
            </div>
          );
        })}
      </Card>
      <p className="text-[11px] text-muted mt-4 flex gap-1.5"><CalendarClock className="h-3.5 w-3.5 shrink-0" />{t("Typical Greek deadlines — confirm dates with your accountant. The VAT figure is an estimate from what's recorded here.")}</p>
      {editing && <SettingsDialog onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
}
