import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { BellRing, CalendarClock, CalendarPlus, Check, ChevronLeft, ChevronRight, Copy, ExternalLink, LayoutList, CalendarDays, Plus, RefreshCw, Settings2, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { date, money, todayISO } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Segmented, Select, cx } from "@/components/ui";
import { AskTax } from "@/components/TaxHelp";

// kind -> [badge tone, dot colour]
const TONE = {
  tax: ["brand", "bg-brand"], get_paid: ["success", "bg-success"], pay: ["danger", "bg-danger"], mydata: ["violet", "bg-violet"],
  quote: ["warn", "bg-warn"], supplier: ["warn", "bg-warn"], delivery: ["neutral", "bg-muted"], recurring: ["brand", "bg-brand/60"],
  receipts: ["violet", "bg-violet/60"], reminder: ["neutral", "bg-ink"],
};

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (s, n) => { const d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return iso(d); };
const monthStart = (s) => s.slice(0, 8) + "01";
const addMonths = (s, n) => { const d = new Date(monthStart(s) + "T00:00:00"); d.setMonth(d.getMonth() + n); return iso(d); };
const gcalDate = (s) => s.replaceAll("-", "");

/** One-off "add this to Google Calendar" link (no account connection needed). */
const googleLink = (it, title) =>
  `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${gcalDate(it.date)}/${gcalDate(addDays(it.date, 1))}&details=${encodeURIComponent(window.location.origin + it.link)}`;

function Row({ it, kinds, onToggle }) {
  const { t, lang } = useT();
  const title = lang === "el" ? it.title_el : it.title;
  const [tone] = TONE[it.kind] || TONE.reminder;
  return (
    <div className={cx("flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5", it.done && "opacity-55")} data-testid={`agenda-${it.key}`}>
      <div className="w-12 text-center shrink-0">
        <p className="text-[10px] uppercase text-muted">{new Date(it.date + "T00:00:00").toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { month: "short" })}</p>
        <p className={cx("text-xl font-bold num", it.overdue && "text-danger")}>{it.date.slice(8)}</p>
      </div>
      <div className="flex-1 min-w-0">
        <Link to={it.link} className={cx("font-semibold text-[15px] hover:underline block truncate", it.done && "line-through")}>{title}</Link>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
          <Badge tone={tone}>{kinds[it.kind]?.[lang === "el" ? "el" : "en"] || it.kind}</Badge>
          {it.kind === "tax" && it.amount != null && it.amount > 0 && <span className="text-xs text-muted">{t("est.")} <b className="num text-ink">{money(it.amount)}</b></span>}
          {it.overdue && <span className="text-xs text-danger font-semibold">{t("overdue")}</span>}
          {it.kind === "tax" && <AskTax className="text-xs" label="Explain" q={`${t("What is this Greek tax deadline and what do I need to do?")} ${it.title_el}`} />}
          <a href={googleLink(it, title)} target="_blank" rel="noopener noreferrer" className="text-xs text-muted hover:text-ink inline-flex items-center gap-1" title={t("Add this one to Google Calendar")}>
            <CalendarPlus className="h-3 w-3" />Google</a>
        </div>
      </div>
      <button onClick={() => onToggle(it)} className={cx("h-9 w-9 rounded-xl border flex items-center justify-center shrink-0", it.done ? "bg-success text-white border-success" : "border-line text-muted hover:border-success hover:text-success")}
        aria-label={it.done ? t("Mark as not done") : t("Mark as done")} data-testid={`agenda-done-${it.key}`}><Check className="h-4 w-4" /></button>
    </div>
  );
}

function Month({ start, items, selected, onSelect }) {
  const { lang } = useT();
  const first = new Date(start + "T00:00:00");
  const lead = (first.getDay() + 6) % 7; // weeks start on Monday
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const byDay = useMemo(() => items.reduce((m, it) => ((m[it.date] = m[it.date] || []).push(it), m), {}), [items]);
  const today = todayISO();
  const names = [...Array(7)].map((_, i) => new Date(2024, 0, 1 + i).toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { weekday: "short" }));
  return (
    <div className="grid grid-cols-7 text-center" data-testid="agenda-month">
      {names.map((n) => <p key={n} className="text-[11px] uppercase text-muted py-2">{n}</p>)}
      {[...Array(lead)].map((_, i) => <div key={`l${i}`} />)}
      {[...Array(days)].map((_, i) => {
        const day = `${start.slice(0, 8)}${String(i + 1).padStart(2, "0")}`;
        const list = byDay[day] || [];
        const open = list.filter((x) => !x.done);
        return (
          <button key={day} onClick={() => onSelect(day)} className={cx("min-h-[68px] sm:min-h-[84px] border border-line -ml-px -mt-px p-1.5 text-left align-top hover:bg-surface-2",
            selected === day && "ring-2 ring-brand relative z-10", day === today && "bg-brand-soft/50")}>
            <span className={cx("text-xs num font-semibold", day === today && "text-brand", open.some((x) => x.overdue) && "text-danger")}>{i + 1}</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {open.slice(0, 6).map((x) => <span key={x.key} className={cx("h-1.5 w-1.5 rounded-full", (TONE[x.kind] || TONE.reminder)[1])} />)}
            </div>
            {open.length > 0 && <p className="hidden sm:block text-[10px] text-muted mt-1 truncate">{lang === "el" ? open[0].title_el : open[0].title}</p>}
            {open.length > 1 && <p className="hidden sm:block text-[10px] text-muted">+{open.length - 1}</p>}
          </button>
        );
      })}
    </div>
  );
}

function ConnectDialog({ onClose }) {
  const { t, lang } = useT();
  const [url, setUrl] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get("/agenda/settings").then((s) => setUrl(s.feed_url || null)).catch(() => setUrl(null)); }, []);
  const create = async () => { setBusy(true); try { setUrl((await api.post("/agenda/feed", { lang })).feed_url); } catch (e) { toast.error(e.message); } setBusy(false); };
  const off = async () => { if (!window.confirm(t("Turn off the calendar link? Calendars that use it will stop updating."))) return; await api.del("/agenda/feed"); setUrl(null); };
  const webcal = url ? url.replace(/^https?:/, "webcal:") : "";
  const copy = async () => { try { await navigator.clipboard.writeText(url); toast.success(t("Link copied")); } catch { toast.error(t("Couldn't copy — select the link and copy it")); } };
  return (
    <Modal open onClose={onClose} title={t("Connect your calendar")} description={t("See every Tameio deadline in Google Calendar, Apple Calendar or Outlook — it keeps itself up to date.")}
      footer={<Button variant="secondary" onClick={onClose}>{t("Done")}</Button>}>
      {url === undefined ? <PageLoader /> : !url ? (
        <div className="text-sm space-y-3">
          <p>{t("We'll make a private link for your calendar app. Anyone with the link can see your deadlines, client names and amounts — so keep it to yourself.")}</p>
          <Button onClick={create} loading={busy} data-testid="feed-create"><CalendarPlus className="h-4 w-4" />{t("Create my calendar link")}</Button>
        </div>
      ) : (
        <div className="space-y-4 text-sm" data-testid="feed-ready">
          <div className="grid sm:grid-cols-2 gap-2">
            <a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`} target="_blank" rel="noopener noreferrer"
              className="h-11 rounded-xl bg-brand text-white font-semibold inline-flex items-center justify-center gap-2" data-testid="feed-google"><ExternalLink className="h-4 w-4" />{t("Add to Google Calendar")}</a>
            <a href={webcal} className="h-11 rounded-xl border border-line font-semibold inline-flex items-center justify-center gap-2 hover:bg-surface-2"><CalendarDays className="h-4 w-4" />{t("Apple / Outlook")}</a>
          </div>
          <Field label={t("Or copy the link")} hint={t("In Google Calendar on a computer: Settings → Add calendar → From URL, then paste it.")}>
            <div className="flex gap-2"><Input readOnly value={url} onFocus={(e) => e.target.select()} className="font-mono text-xs" data-testid="feed-url" /><IconBtn icon={Copy} label={t("Copy")} onClick={copy} /></div>
          </Field>
          <p className="text-xs text-muted">{t("Google refreshes subscribed calendars every few hours (sometimes up to a day), so a change in Tameio can take a while to show there. Reminders inside Tameio and by email are immediate.")}</p>
          <div className="flex flex-wrap gap-2 pt-1 border-t border-line">
            <Button size="sm" variant="ghost" onClick={create} loading={busy}><RefreshCw className="h-3.5 w-3.5" />{t("Make a new link")}</Button>
            <Button size="sm" variant="ghost" className="text-danger" onClick={off}><Trash2 className="h-3.5 w-3.5" />{t("Turn off")}</Button>
          </div>
          <p className="text-[11px] text-muted">{t("Made a new link? The old one stops working — add the new one to your calendar app.")}</p>
        </div>
      )}
    </Modal>
  );
}

function SettingsDialog({ kinds, onClose, onSaved }) {
  const { t, lang } = useT();
  const [tab, setTab] = useState("reminders");
  const [a, setA] = useState(null);
  const [s, setS] = useState(null);
  useEffect(() => {
    api.get("/agenda/settings").then(setA).catch(() => {});
    api.get("/tax/settings").then(setS).catch(() => {});
  }, []);
  const save = async () => {
    try {
      await api.put("/agenda/settings", { remind_days: Number(a.remind_days), email: a.email, kinds: a.kinds, lang });
      await api.put("/tax/settings", s);
      toast.success(t("Saved")); onSaved();
    } catch (e) { toast.error(e.message); }
  };
  const toggleKind = (k) => setA({ ...a, kinds: a.kinds.includes(k) ? a.kinds.filter((x) => x !== k) : [...a.kinds, k] });
  return (
    <Modal open onClose={onClose} title={t("Calendar settings")} footer={<><Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button><Button onClick={save} data-testid="agenda-settings-save">{t("Save")}</Button></>}>
      {!a || !s ? <PageLoader /> : (
        <div className="space-y-4">
          <Segmented value={tab} onChange={setTab} options={[["reminders", "Reminders"], ["tax", "Tax & your own dates"]]} />
          {tab === "reminders" ? (
            <div className="space-y-4">
              <Field label={t("Remind me")}>
                <Select value={a.remind_days} onChange={(e) => setA({ ...a, remind_days: Number(e.target.value) })} data-testid="remind-days">
                  <option value={0}>{t("Never")}</option><option value={1}>{t("1 day before")}</option><option value={3}>{t("3 days before")}</option><option value={7}>{t("A week before")}</option>
                </Select>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={a.email} onChange={(e) => setA({ ...a, email: e.target.checked })} />{t("Also email me a short daily list")}</label>
              <div>
                <p className="label">{t("Show in my calendar and reminders")}</p>
                <div className="grid sm:grid-cols-2 gap-1.5">
                  {Object.entries(kinds).map(([k, v]) => (
                    <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={a.kinds.includes(k)} onChange={() => toggleKind(k)} />
                      <span className={cx("h-2 w-2 rounded-full", TONE[k][1])} />{lang === "el" ? v.el : v.en}</label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Field label={t("VAT returns")}><Select value={s.vat_period} onChange={(e) => setS({ ...s, vat_period: e.target.value })}>
                <option value="quarterly">{t("Quarterly")}</option><option value="monthly">{t("Monthly")}</option><option value="none">{t("Not VAT registered")}</option></Select></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" checked={s.efka_monthly} onChange={(e) => setS({ ...s, efka_monthly: e.target.checked })} />{t("I pay monthly e-ΕΦΚΑ contributions (self-employed)")}</label>
              <Field label={t("Income tax return deadline (MM-DD)")} hint={t("The date changes some years — update it when it's announced.")}><Input value={s.income_tax_month_day} onChange={(e) => setS({ ...s, income_tax_month_day: e.target.value })} className="w-32" /></Field>
              <div>
                <p className="label">{t("Your own reminders")}</p>
                <div className="space-y-2">
                  {s.custom.map((c, i) => (
                    <div key={c.id || i} className="flex gap-2">
                      <Input value={c.title} onChange={(e) => setS({ ...s, custom: s.custom.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} placeholder={t("e.g. ENFIA installment")} />
                      <Input type="date" className="w-40" value={c.date} onChange={(e) => setS({ ...s, custom: s.custom.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                      <IconBtn icon={Trash2} label={t("Remove")} tone="danger" onClick={() => setS({ ...s, custom: s.custom.filter((_, j) => j !== i) })} />
                    </div>
                  ))}
                </div>
                <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={() => setS({ ...s, custom: [...s.custom, { title: "", date: todayISO() }] })}><Plus className="h-4 w-4" />{t("Add reminder")}</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Everything the business has to do, by date: taxes, money in and out, myDATA, quotes, suppliers, deliveries… */
export default function Calendar() {
  const { t, lang } = useT();
  const today = todayISO();
  const [view, setView] = useState(() => { try { return localStorage.getItem("tameio_cal_view") || "list"; } catch { return "list"; } });
  const [month, setMonth] = useState(monthStart(today));
  const [selected, setSelected] = useState(today);
  const [filter, setFilter] = useState("all");
  const [data, setData] = useState(null);
  const [summary, setSummary] = useState(null); // the next 90 days + anything overdue, whatever month is on screen
  const [dialog, setDialog] = useState(null);
  const range = view === "month" ? [month, addDays(addMonths(month, 1), -1)] : [today, addDays(today, 90)];
  const load = useCallback(() => api.get(`/agenda?start=${range[0]}&end=${range[1]}`).then(setData).catch(() => setData({ items: [], kinds: {} })), [range[0], range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSummary = useCallback(() => api.get(`/agenda?start=${today}&end=${addDays(today, 90)}`).then((r) => setSummary(r.items)).catch(() => setSummary([])), [today]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadSummary(); }, [loadSummary]);
  const refresh = () => { load(); loadSummary(); window.dispatchEvent(new Event("tameio:agenda-changed")); };
  const pickView = (v) => { setView(v); try { localStorage.setItem("tameio_cal_view", v); } catch { /* private mode */ } };
  const toggle = async (it) => { await api.post("/agenda/done", { key: it.key, done: !it.done }); refresh(); };
  if (!data) return <PageLoader />;

  const all = data.items;
  const items = filter === "all" ? all : all.filter((i) => i.kind === filter);
  const open = (summary || all).filter((i) => !i.done);
  const week = addDays(today, 7);
  const stats = [
    ["Overdue", open.filter((i) => i.overdue).length, "text-danger"],
    ["Next 7 days", open.filter((i) => !i.overdue && i.date <= week).length, ""],
    ["Owed to you", money(open.filter((i) => i.kind === "get_paid").reduce((s, i) => s + (i.amount || 0), 0)), "text-success"],
    ["To pay", money(open.filter((i) => i.kind === "pay").reduce((s, i) => s + (i.amount || 0), 0)), ""],
  ];
  const counts = all.reduce((m, i) => ((m[i.kind] = (m[i.kind] || 0) + (i.done ? 0 : 1)), m), {});
  const groups = view === "list" ? [
    ["Overdue", items.filter((i) => i.overdue)],
    ["Today", items.filter((i) => !i.overdue && i.date === today)],
    ["This week", items.filter((i) => !i.overdue && i.date > today && i.date <= week)],
    ["Later", items.filter((i) => !i.overdue && i.date > week)],
    ["Done", items.filter((i) => i.done && !i.overdue && i.date < today)],
  ].filter(([, l]) => l.length) : [[date(selected), items.filter((i) => i.date === selected)]];
  const monthName = new Date(month + "T00:00:00").toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { month: "long", year: "numeric" });

  return (
    <div className="animate-in max-w-4xl">
      <PageHeader title={t("Calendar")} subtitle={t("Everything your business has to do, by date — taxes, payments in and out, myDATA, quotes, suppliers and deliveries.")}
        actions={<>
          <Button onClick={() => setDialog("connect")} data-testid="connect-calendar"><CalendarPlus className="h-4 w-4" />{t("Connect Google Calendar")}</Button>
          <Button variant="secondary" onClick={() => setDialog("settings")} data-testid="agenda-settings"><Settings2 className="h-4 w-4" />{t("Settings")}</Button>
        </>} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4" data-testid="agenda-stats">
        {stats.map(([label, v, cls]) => <Card key={label} className="px-4 py-3"><p className="text-[11px] text-muted">{t(label)}</p><p className={cx("text-lg font-bold num", cls)}>{v}</p></Card>)}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Segmented value={view} onChange={pickView} options={[["list", "List"], ["month", "Month"]]} />
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
          <button onClick={() => setFilter("all")} className={cx("chip whitespace-nowrap !text-xs !px-3 !py-1.5", filter === "all" ? "bg-ink text-bg" : "bg-surface-2 text-muted")}>{t("All")}</button>
          {Object.entries(data.kinds).filter(([k]) => counts[k] !== undefined).map(([k, v]) => (
            <button key={k} onClick={() => setFilter(filter === k ? "all" : k)} data-testid={`agenda-filter-${k}`}
              className={cx("chip whitespace-nowrap inline-flex items-center gap-1.5 !text-xs !px-3 !py-1.5", filter === k ? "bg-ink text-bg" : "bg-surface-2 text-muted")}>
              <span className={cx("h-2 w-2 rounded-full", (TONE[k] || TONE.reminder)[1])} />{lang === "el" ? v.el : v.en}{counts[k] ? ` · ${counts[k]}` : ""}</button>
          ))}
        </div>
      </div>

      {view === "month" && (
        <Card className="p-3 sm:p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <IconBtn icon={ChevronLeft} label={t("Previous month")} onClick={() => { const m = addMonths(month, -1); setMonth(m); setSelected(m); }} />
            <p className="font-semibold capitalize">{monthName}</p>
            <IconBtn icon={ChevronRight} label={t("Next month")} onClick={() => { const m = addMonths(month, 1); setMonth(m); setSelected(m); }} />
          </div>
          <Month start={month} items={items} selected={selected} onSelect={setSelected} />
        </Card>
      )}

      {groups.length === 0 ? (
        <Card className="p-10 text-center text-sm text-muted"><CalendarClock className="h-7 w-7 mx-auto mb-2 text-brand" />{t("Nothing due. Enjoy the quiet.")}</Card>
      ) : groups.map(([label, list]) => (
        <section key={label} className="mb-4">
          <h2 className={cx("text-xs font-semibold uppercase tracking-[0.12em] mb-2", label === "Overdue" ? "text-danger" : "text-muted")}>{t(label)} · {list.length}</h2>
          <Card className="divide-y divide-line">
            {list.length === 0 ? <p className="p-6 text-center text-sm text-muted">{t("Nothing on this day.")}</p>
              : list.map((it) => <Row key={it.key} it={it} kinds={data.kinds} onToggle={toggle} />)}
          </Card>
        </section>
      ))}

      <p className="text-[11px] text-muted mt-4 flex gap-1.5"><BellRing className="h-3.5 w-3.5 shrink-0" />{t("Items appear and disappear on their own as you work — a paid invoice leaves the list by itself. Tax dates are typical Greek deadlines; confirm them with your accountant.")}</p>
      {dialog === "connect" && <ConnectDialog onClose={() => setDialog(null)} />}
      {dialog === "settings" && <SettingsDialog kinds={data.kinds} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); refresh(); }} />}
    </div>
  );
}
