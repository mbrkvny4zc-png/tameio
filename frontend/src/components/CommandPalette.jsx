import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight, FilePlus2, Sparkles, FileSignature, FileText, MessageSquareText, PackageCheck, Plus, ReceiptText, ScanLine, Search, UserPlus, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cx } from "@/components/ui";

const actions = (t) => [
  { id: "ai-draft", label: t("Write an invoice with AI"), icon: Sparkles, event: "tameio:ai-draft", keys: "ai write draft γράψε τιμολόγιο" },
  { id: "new-invoice", label: t("New invoice"), icon: FilePlus2, to: "/app/invoices?new=1", keys: "invoice τιμολογιο" },
  { id: "new-receipt", label: t("Quick receipt (counter sale)"), icon: ReceiptText, to: "/app/invoices?receipt=1", keys: "receipt αποδειξη λιανικη" },
  { id: "scan", label: t("Scan a receipt or invoice"), icon: ScanLine, to: "/app/scan", keys: "scan expense photo εξοδο" },
  { id: "new-quote", label: t("New quote"), icon: FileSignature, to: "/app/quotes?new=1", keys: "quote προσφορα" },
  { id: "new-dn", label: t("New delivery note"), icon: PackageCheck, to: "/app/delivery-notes?new=1", keys: "delivery note δελτιο αποστολης" },
  { id: "new-client", label: t("New client"), icon: UserPlus, to: "/app/clients?new=1", keys: "client customer πελατης" },
  { id: "ask", label: t("Ask a question about your numbers"), icon: MessageSquareText, to: "/app/ask", keys: "ask ai question ρωτα" },
];

/** The "+ New" button in the top bar. */
export function NewMenu() {
  const { t } = useT();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const items = actions(t).filter((a) => a.id !== "ask");
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="h-9 pl-2.5 pr-3 rounded-xl bg-ink text-bg text-sm font-semibold inline-flex items-center gap-1.5 hover:opacity-90" data-testid="new-menu" aria-expanded={open}>
        <Plus className="h-4 w-4" /><span className="hidden sm:inline">{t("New")}</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 card shadow-lift p-1.5 z-30 animate-in">
          {items.map(({ id, label, icon: Icon, to }) => (
            <button key={id} onClick={() => { setOpen(false); const a = items.find((x) => x.id === id); a.event ? window.dispatchEvent(new Event(a.event)) : nav(to); }} className="w-full flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm hover:bg-surface-2 text-left" data-testid={`new-${id}`}>
              <Icon className="h-4 w-4 text-muted" />{label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const norm = (s) => (s || "").toString().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Ctrl/Cmd+K: jump to any page, start any action, or find a client / invoice by name or number. */
export function CommandPalette({ nav }) {
  const { t } = useT();
  const go = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const [data, setData] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      if (e.key === "Escape") setOpen(false);
    };
    const ev = () => setOpen(true);
    window.addEventListener("keydown", key); window.addEventListener("tameio:palette", ev);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("tameio:palette", ev); };
  }, []);
  useEffect(() => {
    if (!open) return;
    setQ(""); setSel(0);
    setTimeout(() => input.current?.focus(), 10);
    Promise.all([api.get("/clients").catch(() => []), api.get("/invoices").catch(() => [])]).then(([clients, invoices]) => setData({ clients, invoices }));
  }, [open]);

  const results = useMemo(() => {
    const n = norm(q.trim());
    const pages = nav.flatMap((g) => [...g.items, ...(g.more || [])]).concat([{ to: "/app/settings", label: t("Settings") }])
      .map((p) => ({ id: p.to, label: p.label, hint: t("Go to"), icon: p.icon || ArrowRight, to: p.to, keys: "" }));
    const acts = actions(t).map((a) => ({ ...a, hint: t("Action") }));
    const match = (x) => !n || norm(`${x.label} ${x.keys || ""}`).includes(n);
    const out = [...acts.filter(match), ...pages.filter(match)];
    if (n && data) {
      out.push(...data.clients.filter((c) => norm(`${c.name} ${c.company} ${c.afm} ${c.email}`).includes(n)).slice(0, 5)
        .map((c) => ({ id: `c-${c.id}`, label: c.name, hint: c.afm ? `ΑΦΜ ${c.afm}` : t("Client"), icon: Users, to: `/app/clients?open=${c.id}` })));
      out.push(...data.invoices.filter((i) => norm(`${i.number} ${i.client_name}`).includes(n)).slice(0, 6)
        .map((i) => ({ id: `i-${i.id}`, label: `${i.number} · ${i.client_name}`, hint: money(i.total), icon: FileText, to: `/app/invoices?q=${encodeURIComponent(i.number)}` })));
    }
    return out.slice(0, 14);
  }, [q, data, nav, t]);

  if (!open) return null;
  const pick = (r) => { setOpen(false); if (r?.event) window.dispatchEvent(new Event(r.event)); else if (r) go(r.to); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter") pick(results[sel]);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-label={t("Search")}>
      <div className="absolute inset-0 bg-[rgb(20_16_10/0.35)] backdrop-blur-[2px]" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl card shadow-lift overflow-hidden animate-in" data-testid="palette">
        <div className="flex items-center gap-3 px-4 border-b border-line">
          <Search className="h-4 w-4 text-muted" />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey}
            placeholder={t("Search clients, invoices, pages — or type an action")} className="flex-1 h-14 bg-transparent outline-none text-[15px]" data-testid="palette-input" />
          <kbd className="text-[10px] font-semibold text-muted border border-line rounded px-1.5 py-0.5">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <p className="text-sm text-muted text-center py-8">{t("Nothing found")}</p>}
          {results.map((r, i) => {
            const Icon = r.icon;
            return (
              <button key={r.id} onMouseEnter={() => setSel(i)} onClick={() => pick(r)}
                className={cx("w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm", i === sel && "bg-surface-2")}>
                <Icon className="h-4 w-4 text-muted shrink-0" /><span className="flex-1 truncate">{r.label}</span><span className="text-xs text-muted">{r.hint}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
