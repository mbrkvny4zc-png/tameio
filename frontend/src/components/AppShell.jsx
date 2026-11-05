import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileText, FileSignature, ClipboardList, Users, Receipt, ShoppingCart, Truck, BarChart3, Settings, ScanLine, Bell, LogOut,
  Menu, X, ShieldCheck, Inbox, Landmark, CalendarClock, Calculator, ChevronsUpDown, Check, Building2, ArrowLeft, Sparkles,
  ChevronDown, MessageSquareText, Package, PackageCheck, Search, Smartphone, Handshake, Gauge, LifeBuoy, Pin, PinOff, Bookmark, ChevronUp, Eye, EyeOff, SlidersHorizontal, FileBarChart, AtSign,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relative } from "@/lib/format";
import { LangToggle, useT } from "@/lib/i18n";
import { useOrg } from "@/lib/org";
import { Logo } from "@/components/Logo";
import { Button, Modal, cx } from "@/components/ui";
import { toast } from "sonner";
import { CommandPalette, NewMenu } from "@/components/CommandPalette";
import { AiDraft } from "@/components/AiDraft";
import { CommentsPanel } from "@/components/Comments";
import { ErrorBoundary } from "@/lib/crash";
import { ICONS, LayoutProvider, PIN_TYPE_ICON, applyNav, iconName, useLayout } from "@/lib/layout";

function buildNav(t, { kind, isAccountant, admin }) {
  const adminGroup = admin ? [{ key: "owner", group: t("Owner"), items: [{ to: "/app/admin", label: t("Management"), icon: Gauge }] }] : [];
  if (kind === "practice") {
    return [
      { key: "top", group: null, items: [{ to: "/app/practice", label: t("My clients"), icon: Calculator, end: true },
        { to: "/app/partner", label: t("Partner programme"), icon: Handshake }] },
      ...adminGroup,
    ];
  }
  // Each group shows its everyday pages; the rest sit behind "more" so the menu stays short.
  return [
    { key: "top", group: null, items: [{ to: "/app", label: t("Dashboard"), icon: LayoutDashboard, end: true },
      { to: "/app/ask", label: t("Ask Tameio"), icon: MessageSquareText },
      { to: "/app/mentions", label: t("Mentions"), icon: AtSign },
      ...(isAccountant ? [{ to: "/app/practice", label: t("All clients"), icon: Calculator }] : [])] },
    { key: "sales", group: t("Sales"), items: [
      { to: "/app/invoices", label: t("Invoices & receipts"), icon: FileText },
      { to: "/app/clients", label: t("Clients"), icon: Users },
      { to: "/app/quotes", label: t("Quotes"), icon: FileSignature },
    ], more: [
      { to: "/app/products", label: t("Products & services"), icon: Package },
      { to: "/app/delivery-notes", label: t("Delivery notes"), icon: PackageCheck },
      { to: "/app/sales-orders", label: t("Sales orders"), icon: ClipboardList },
    ] },
    { key: "purchases", group: t("Purchases"), items: [
      { to: "/app/expenses", label: t("Expenses"), icon: Receipt },
      { to: "/app/received", label: t("Purchase invoices"), icon: Inbox },
    ], more: [
      { to: "/app/suppliers", label: t("Suppliers"), icon: Truck },
      { to: "/app/purchase-orders", label: t("Purchase orders"), icon: ShoppingCart },
    ] },
    { key: "money", group: t("Bank & tax"), items: [
      { to: "/app/bank", label: t("Bank"), icon: Landmark },
      { to: "/app/reports", label: t("Reports"), icon: BarChart3 },
      { to: "/app/mydata", label: "myDATA", icon: ShieldCheck },
    ], more: [
      { to: "/app/calendar", label: t("Tax calendar"), icon: CalendarClock },
      { to: "/app/reports/custom", label: t("Custom reports"), icon: FileBarChart },
    ] },
    ...adminGroup,
  ];
}

/** "Install app" — Android/desktop get the native prompt; iPhone gets the two-step hint. */
function InstallApp() {
  const { t } = useT();
  const [can, setCan] = useState(!!window.__tameioInstall);
  const [ios, setIos] = useState(false);
  const standalone = window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => { const h = () => setCan(true); window.addEventListener("tameio:installable", h); return () => window.removeEventListener("tameio:installable", h); }, []);
  if (standalone || (!can && !isIos)) return null;
  const install = async () => {
    if (window.__tameioInstall) { window.__tameioInstall.prompt(); await window.__tameioInstall.userChoice.catch(() => {}); window.__tameioInstall = null; setCan(false); }
    else setIos(true);
  };
  return (
    <>
      <button onClick={install} className="flex items-center gap-3 px-3 h-9 w-full rounded-lg text-sm font-medium text-muted hover:text-ink hover:bg-surface-2" data-testid="install-app">
        <Smartphone className="h-[18px] w-[18px]" strokeWidth={1.9} />{t("Install the app")}
      </button>
      <Modal open={ios} onClose={() => setIos(false)} title={t("Add Tameio to your Home Screen")}>
        <ol className="list-decimal pl-5 space-y-2 text-sm"><li>{t("Tap the Share button in Safari.")}</li><li>{t("Choose “Add to Home Screen”.")}</li></ol>
        <p className="text-xs text-muted mt-3">{t("It opens full-screen like an app, with shortcuts to scan a receipt or issue one.")}</p>
      </Modal>
    </>
  );
}

const readOpen = () => { try { return JSON.parse(localStorage.getItem("tameio_nav_more") || "{}"); } catch { return {}; } };

function NavItem({ to, label, icon: Icon, end, badge }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx("flex items-center gap-3 px-3 h-9 rounded-lg text-sm font-medium transition-colors",
      isActive ? "bg-brand-soft text-brand" : "text-muted hover:text-ink hover:bg-surface-2")}>
      <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} /><span className="flex-1 truncate">{label}</span>
      {badge > 0 && <span className="min-w-5 h-5 px-1.5 rounded-full bg-brand text-white text-[11px] font-bold flex items-center justify-center" data-testid={`badge-${to}`}>{badge}</span>}
    </NavLink>
  );
}

/** Live count of unanswered @mentions for the menu badge. */
function useMentionCount() {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => api.get("/mentions/count").then((r) => setN(r.open)).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    ["tameio:mentions-changed", "tameio:comments-changed"].forEach((e) => window.addEventListener(e, load));
    return () => { clearInterval(id); ["tameio:mentions-changed", "tameio:comments-changed"].forEach((e) => window.removeEventListener(e, load)); };
  }, []);
  return n;
}

function NavGroups({ nav, badges }) {
  const { t } = useT();
  const loc = useLocation();
  const [open, setOpen] = useState(readOpen);
  const toggle = (k) => {
    const next = { ...open, [k]: !open[k] };
    setOpen(next);
    try { localStorage.setItem("tameio_nav_more", JSON.stringify(next)); } catch { /* ignore */ }
  };
  return nav.map((g, gi) => {
    const activeInMore = (g.more || []).some((i) => loc.pathname.startsWith(i.to));
    const showMore = open[g.key] || activeInMore;
    return (
      <div key={gi} className="mb-4">
        {g.group && <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80">{g.group}</p>}
        {g.items.map((it) => <NavItem key={it.to} {...it} badge={badges?.[it.to]} />)}
        {showMore && g.more.map((it) => <NavItem key={it.to} {...it} />)}
        {g.more?.length > 0 && !activeInMore && (
          <button onClick={() => toggle(g.key)} className="flex items-center gap-3 px-3 h-8 w-full rounded-lg text-xs font-medium text-muted/80 hover:text-ink">
            <ChevronDown className={cx("h-4 w-4 transition-transform", showMore && "rotate-180")} />
            {showMore ? t("Show less") : t("{n} more", { n: g.more.length })}
          </button>
        )}
      </div>
    );
  });
}

const ROLE = { owner: "Owner", admin: "Admin", staff: "Staff", accountant: "Accountant" };

function OrgSwitcher() {
  const { orgs, current, switchTo } = useOrg();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  if (!current) return null;
  const many = (orgs || []).length > 1;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => many && setOpen(!open)} className={cx("w-full flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-left", many && "hover:bg-surface-2")} data-testid="org-switcher">
        <span className="h-8 w-8 shrink-0 rounded-lg bg-surface-2 flex items-center justify-center">{current.kind === "practice" ? <Calculator className="h-4 w-4 text-brand" /> : <Building2 className="h-4 w-4 text-brand" />}</span>
        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold truncate">{current.name}</span><span className="block text-[11px] text-muted">{t(current.kind === "practice" ? "Accounting firm" : ROLE[current.role] || current.role)}</span></span>
        {many && <ChevronsUpDown className="h-4 w-4 text-muted shrink-0" />}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full card shadow-lift p-1.5 max-h-80 overflow-y-auto animate-in">
          {orgs.map((o) => (
            <button key={o.id} onClick={() => switchTo(o.id, o.kind === "practice" ? "/app/practice" : "/app")} className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-surface-2 text-left">
              <span className="flex-1 min-w-0 truncate">{o.name}</span>
              <span className="text-[10px] text-muted">{t(o.kind === "practice" ? "Firm" : ROLE[o.role] || o.role)}</span>
              {o.id === current.id && <Check className="h-4 w-4 text-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);
  const nav = useNavigate();
  const load = () => api.get("/notifications").then(setData).catch(() => {});
  useEffect(() => { load(); const i = setInterval(load, 60_000); return () => clearInterval(i); }, []);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, []);
  const toggle = async () => {
    setOpen(!open);
    if (!open && data.unread) { await api.post("/notifications/read").catch(() => {}); setData((d) => ({ ...d, unread: 0 })); }
  };
  return (
    <div className="relative" ref={ref}>
      <button onClick={toggle} className="relative p-2 rounded-xl text-muted hover:text-ink hover:bg-surface-2" aria-label={t("Notifications")}>
        <Bell className="h-5 w-5" />
        {data.unread > 0 && <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] card shadow-lift p-2 z-30 animate-in">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted">{t("Notifications")}</p>
          {data.items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">{t("You're all caught up.")}</p>}
          <div className="max-h-96 overflow-y-auto">
            {data.items.map((n) => (
              <button key={n.id} onClick={() => { setOpen(false); if (n.link) nav(n.link); }} className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2">
                <p className="text-sm leading-snug">{n.message}</p><p className="text-[11px] text-muted mt-0.5">{relative(n.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UpgradeDialog() {
  const { t } = useT();
  const [info, setInfo] = useState(null);
  const [plan, setPlan] = useState(null);
  useEffect(() => {
    const h = (e) => { setInfo(e.detail || {}); api.get("/plan").then(setPlan).catch(() => {}); };
    window.addEventListener("tameio:upgrade", h); return () => window.removeEventListener("tameio:upgrade", h);
  }, []);
  return (
    <Modal open={!!info} onClose={() => setInfo(null)} title={t("Time to upgrade")} description={info?.message ? t(info.message) : ""}>
      {plan && (
        <div className="grid sm:grid-cols-3 gap-2" data-testid="upgrade-dialog">
          {Object.entries(plan.plans).filter(([k]) => k !== "free").map(([k, p]) => (
            <div key={k} className={cx("rounded-xl border p-3", plan.plan === k ? "border-brand bg-brand-soft" : "border-line")}>
              <p className="font-bold">{p.name}</p><p className="text-sm"><b className="num">€{p.price}</b> / {t("month")}</p>
              <p className="text-[11px] text-muted mt-1">{p.scans_month < 0 ? t("Unlimited scans") : t("{n} scans / month", { n: p.scans_month })}</p>
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-muted mt-4">{t("Online plan changes are coming soon — contact us to upgrade today.")}</p>
      <div className="flex justify-end gap-2 mt-4"><Button variant="secondary" onClick={() => setInfo(null)}>{t("Close")}</Button><Link to="/app/settings?tab=plan" onClick={() => setInfo(null)} className="h-10 px-4 inline-flex items-center rounded-xl bg-brand text-white text-sm font-semibold"><Sparkles className="h-4 w-4 mr-2" />{t("See my plan")}</Link></div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- pins & menu editing */

function PinnedNav() {
  const { t } = useT();
  const { layout, removePin } = useLayout();
  if (!layout.pins.length) return null;
  return (
    <div className="mb-4" data-testid="pinned-nav">
      <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80 flex items-center gap-1"><Pin className="h-3 w-3" />{t("Pinned")}</p>
      {layout.pins.map((p) => {
        const Icon = ICONS[p.icon] || ICONS[PIN_TYPE_ICON[p.type]] || Bookmark;
        return (
          <div key={p.id} className="group relative">
            <Link to={p.to} className="flex items-center gap-3 px-3 h-9 rounded-lg text-sm font-medium text-muted hover:text-ink hover:bg-surface-2 pr-8">
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} /><span className="truncate">{p.label}</span>
            </Link>
            <button onClick={() => removePin(p.id)} className="absolute right-1.5 top-1.5 p-1 rounded-md text-muted opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger" aria-label={t("Unpin {name}", { name: p.label })}><X className="h-3.5 w-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}

/** Owners and admins rearrange the menu for everyone in the business: order, show/hide, main list or "more". */
function NavEditor({ base, onDone }) {
  const { t } = useT();
  const { layout, saveOrg, resetOrg } = useLayout();
  const [groups, setGroups] = useState(() => {
    const applied = applyNav(base, { ...layout.nav, hidden: [] });
    const hidden = new Set(layout.nav.hidden || []);
    return applied.map((g) => ({ key: g.key, group: g.group, rows: [...g.items.map((i) => ({ ...i, more: false })), ...g.more.map((i) => ({ ...i, more: true }))].map((i) => ({ ...i, hidden: hidden.has(i.to) })) }));
  });
  const [busy, setBusy] = useState(false);
  const locked = (to) => to === "/app";
  const move = (gi, i, dir) => setGroups((gs) => gs.map((g, k) => {
    if (k !== gi) return g;
    const rows = [...g.rows]; const j = i + dir;
    if (j < 0 || j >= rows.length) return g;
    [rows[i], rows[j]] = [rows[j], rows[i]];
    return { ...g, rows };
  }));
  const flip = (gi, i, key) => setGroups((gs) => gs.map((g, k) => (k !== gi ? g : { ...g, rows: g.rows.map((r, j) => (j === i ? { ...r, [key]: !r[key] } : r)) })));
  const save = async () => {
    setBusy(true);
    const defaultsMore = new Set(base.flatMap((g) => (g.more || []).map((i) => i.to)));
    const rows = groups.flatMap((g) => g.rows);
    try {
      await saveOrg({ nav: {
        hidden: rows.filter((r) => r.hidden).map((r) => r.to),
        order: Object.fromEntries(groups.map((g) => [g.key || "top", g.rows.map((r) => r.to)])),
        main: rows.filter((r) => !r.more && defaultsMore.has(r.to)).map((r) => r.to),
        more: rows.filter((r) => r.more && !defaultsMore.has(r.to)).map((r) => r.to),
      } });
      toast.success(t("Menu saved for everyone in this business")); onDone();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="pb-3" data-testid="nav-editor">
      <div className="rounded-xl bg-brand-soft text-brand text-xs px-3 py-2 mb-3">{t("Reorder with the arrows, hide what your team doesn't use, and choose what sits under “more”.")}</div>
      {groups.map((g, gi) => (
        <div key={g.key || gi} className="mb-3">
          {g.group && <p className="px-1 mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80">{g.group}</p>}
          {g.rows.map((r, i) => {
            const Icon = r.icon;
            return (
              <div key={r.to} className={cx("flex items-center gap-1.5 h-9 px-1.5 rounded-lg text-sm", r.hidden ? "opacity-45" : "hover:bg-surface-2")} data-testid={`nav-edit-${r.to}`}>
                <Icon className="h-4 w-4 text-muted shrink-0" /><span className={cx("flex-1 truncate", r.hidden && "line-through")}>{r.label}</span>
                {g.key !== "top" && g.key !== "owner" && <button onClick={() => flip(gi, i, "more")} className={cx("text-[10px] font-semibold px-1.5 rounded", r.more ? "bg-surface-2 text-muted" : "text-brand")} title={t("Show in the main list or under “more”")}>{r.more ? t("more") : t("main")}</button>}
                <button onClick={() => move(gi, i, -1)} disabled={i === 0} className="p-0.5 text-muted hover:text-ink disabled:opacity-20" aria-label={t("Move up")}><ChevronUp className="h-4 w-4" /></button>
                <button onClick={() => move(gi, i, 1)} disabled={i === g.rows.length - 1} className="p-0.5 text-muted hover:text-ink disabled:opacity-20" aria-label={t("Move down")}><ChevronDown className="h-4 w-4" /></button>
                <button onClick={() => flip(gi, i, "hidden")} disabled={locked(r.to)} className="p-0.5 text-muted hover:text-ink disabled:opacity-20" aria-label={r.hidden ? t("Show") : t("Hide")} data-testid={`nav-hide-${r.to}`}>{r.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button>
              </div>
            );
          })}
        </div>
      ))}
      <div className="flex gap-2 mt-2">
        <Button size="sm" className="flex-1" onClick={save} loading={busy} data-testid="nav-save">{t("Save menu")}</Button>
        <Button size="sm" variant="secondary" onClick={onDone}>{t("Cancel")}</Button>
      </div>
      <button className="text-xs text-muted hover:text-ink mt-2 px-1" onClick={async () => { await resetOrg("nav"); toast.success(t("Menu back to default")); onDone(); }}>{t("Reset to default")}</button>
    </div>
  );
}

/** Top-bar pin: pins the page you're on — including its search and filters. */
function PinThisPage({ nav }) {
  const { t } = useT();
  const loc = useLocation();
  const { layout, addPin, removePin } = useLayout();
  const to = loc.pathname + loc.search;
  const existing = layout.pins.find((p) => p.to === to);
  const page = nav.flatMap((g) => [...g.items, ...(g.more || [])]).filter((i) => loc.pathname === i.to || (i.to !== "/app" && loc.pathname.startsWith(i.to))).sort((a, b) => b.to.length - a.to.length)[0];
  if (!page || loc.pathname === "/app") return null;
  const params = new URLSearchParams(loc.search);
  const extra = [params.get("q") && `“${params.get("q")}”`, params.get("filter") && t(params.get("filter"))].filter(Boolean).join(" · ");
  const label = extra ? `${page.label}: ${extra}` : page.label;
  return (
    <button onClick={() => (existing ? removePin(existing.id) : addPin({ type: extra ? "search" : "page", label, to, icon: iconName(page.icon) }))}
      className={cx("p-2 rounded-xl hover:bg-surface-2", existing ? "text-brand" : "text-muted hover:text-ink")} title={existing ? t("Unpin this page") : t("Pin this page (with its search and filters)")}
      aria-label={existing ? t("Unpin this page") : t("Pin this page")} aria-pressed={!!existing} data-testid="pin-page">
      {existing ? <PinOff className="h-5 w-5" /> : <Pin className="h-5 w-5" />}
    </button>
  );
}

export default function AppShell() {
  return <LayoutProvider><Shell /></LayoutProvider>;
}

function Shell() {
  const { user, logout } = useAuth();
  const { current, isAccountant, orgs } = useOrg();
  const { t } = useT();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setDrawer(false);
    // Remember where the user was, so a bug report can say which page it's about.
    if (!loc.pathname.startsWith("/app/feedback")) { try { sessionStorage.setItem("tameio_last_page", loc.pathname + loc.search); } catch { /* ignore */ } }
  }, [loc.pathname, loc.search]);
  const kind = current?.kind || "business";
  const baseNav = buildNav(t, { kind, isAccountant, admin: !!user?.platform_admin });
  const { layout } = useLayout();
  const nav = applyNav(baseNav, layout.nav);
  const [editing, setEditing] = useState(false);
  const mentionCount = useMentionCount();
  const practiceOrg = orgs?.find((o) => o.kind === "practice");

  const Sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 h-16 flex items-center justify-between"><Link to={kind === "practice" ? "/app/practice" : "/app"}><Logo /></Link><LangToggle /></div>
      <div className="px-3 pb-3 space-y-2"><OrgSwitcher />
        {kind !== "practice" && (
          <Link to="/app/scan" className="flex items-center justify-center gap-2 h-11 rounded-xl bg-brand text-white font-semibold text-sm shadow-[0_8px_20px_-8px_hsl(var(--brand)/0.7)] hover:brightness-110 transition" data-testid="sidebar-scan">
            <ScanLine className="h-[18px] w-[18px]" />{t("Scan receipt or invoice")}
          </Link>
        )}
        {kind !== "practice" && current?.role === "accountant" && practiceOrg && (
          <Link to="/app/practice" className="flex items-center gap-2 text-xs font-semibold text-muted hover:text-ink px-1"><ArrowLeft className="h-3.5 w-3.5" />{t("Back to all clients")}</Link>
        )}
      </div>
      <nav className="flex-1 overflow-y-auto px-3">
        {editing ? <NavEditor base={baseNav} onDone={() => setEditing(false)} /> : <><PinnedNav /><NavGroups nav={nav} badges={{ "/app/mentions": mentionCount }} /></>}
        {!editing && layout.can_edit && (
          <button onClick={() => setEditing(true)} className="flex items-center gap-2 px-3 h-8 text-xs font-medium text-muted/80 hover:text-ink mb-3" data-testid="nav-edit"><SlidersHorizontal className="h-3.5 w-3.5" />{t("Edit menu")}</button>
        )}
      </nav>
      <div className="p-3 border-t border-line">
        <InstallApp />
        <NavItem to="/app/feedback" label={t("Help & feedback")} icon={LifeBuoy} />
        <NavItem to="/app/settings" label={t("Settings")} icon={Settings} />
        <div className="flex items-center gap-3 px-2 py-2 mt-1">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand to-violet text-white font-semibold text-sm flex items-center justify-center">{(user?.name || "?")[0]}</div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{user?.name}</p><p className="text-[11px] text-muted truncate">{user?.email}</p></div>
          <button onClick={logout} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface-2" title={t("Sign out")} aria-label={t("Sign out")}><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );

  const bottom = kind === "practice"
    ? [["/app/practice", t("Clients"), Calculator], ["/app/partner", t("Partner"), Handshake], ["/app/settings", t("Settings"), Settings]]
    : [["/app", t("Home"), LayoutDashboard], ["/app/invoices", t("Invoices"), FileText], null, ["/app/expenses", t("Expenses"), Receipt], ["/app/reports", t("Reports"), BarChart3]];

  return (
    <div className="min-h-screen bg-bg">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[260px] bg-surface border-r border-line z-20">{Sidebar}</aside>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-[rgb(10_15_30/0.4)]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[290px] bg-surface shadow-lift animate-in">
            <button onClick={() => setDrawer(false)} className="absolute right-2 top-16 p-2 rounded-lg text-muted" aria-label={t("Close menu")}><X className="h-5 w-5" /></button>
            {Sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-10 h-16 bg-bg/80 backdrop-blur-md border-b border-line/70 flex items-center gap-3 px-4 sm:px-6 lg:px-10">
          <button className="lg:hidden p-2 -ml-2 rounded-lg text-muted" onClick={() => setDrawer(true)} aria-label={t("Open menu")}><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden"><Logo /></div>
          {current && kind !== "practice" && (orgs || []).length > 1 && <span className="hidden lg:inline text-sm text-muted">{current.name}</span>}
          {kind !== "practice" && (
            <button onClick={() => window.dispatchEvent(new Event("tameio:palette"))} className="hidden sm:flex items-center gap-2 h-9 w-72 max-w-[40vw] rounded-xl border border-line bg-surface px-3 text-sm text-muted hover:border-ink/20" data-testid="open-palette">
              <Search className="h-4 w-4" /><span className="flex-1 text-left">{t("Search or jump to…")}</span><kbd className="text-[10px] font-semibold border border-line rounded px-1.5 py-0.5">Ctrl K</kbd>
            </button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {kind !== "practice" && <button onClick={() => window.dispatchEvent(new Event("tameio:palette"))} className="sm:hidden p-2 rounded-xl text-muted hover:text-ink" aria-label={t("Search")}><Search className="h-5 w-5" /></button>}
            <PinThisPage nav={nav} />
            <Notifications />
            {kind !== "practice" && <NewMenu />}
          </div>
        </header>
        <main className="px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 lg:pb-12 max-w-[1400px]"><ErrorBoundary key={loc.pathname}><Outlet /></ErrorBoundary></main>
      </div>
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] no-print">
        <div className={cx("grid h-16 items-center", bottom.length === 5 ? "grid-cols-5" : "grid-cols-3")}>
          {bottom.map((it) => it ? (() => {
            const [to, label, Icon] = it;
            return <NavLink key={to} to={to} end={to === "/app"} className={({ isActive }) => cx("flex flex-col items-center gap-1 text-[10px] font-semibold", isActive ? "text-brand" : "text-muted")}><Icon className="h-5 w-5" />{label}</NavLink>;
          })() : (
            <Link key="scan" to="/app/scan" className="justify-self-center -mt-7 h-14 w-14 rounded-2xl bg-brand text-white shadow-lift flex items-center justify-center" aria-label={t("Scan receipt")} data-testid="mobile-scan"><ScanLine className="h-6 w-6" /></Link>
          ))}
        </div>
      </nav>
      <UpgradeDialog />
      {kind !== "practice" && <CommandPalette nav={nav} />}
      {kind !== "practice" && <AiDraft />}
      <CommentsPanel />
    </div>
  );
}
