import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, FileText, FileSignature, ClipboardList, Users, Receipt, ShoppingCart, Truck, BarChart3, Settings,
  ScanLine, Bell, LogOut, Menu, X, ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { relative } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { cx } from "@/components/ui";

export const NAV = [
  { group: null, items: [{ to: "/app", label: "Dashboard", icon: LayoutDashboard, end: true }] },
  { group: "Sales", items: [
    { to: "/app/invoices", label: "Invoices", icon: FileText },
    { to: "/app/quotes", label: "Quotes", icon: FileSignature },
    { to: "/app/sales-orders", label: "Sales orders", icon: ClipboardList },
    { to: "/app/clients", label: "Clients", icon: Users },
  ] },
  { group: "Spending", items: [
    { to: "/app/expenses", label: "Expenses", icon: Receipt },
    { to: "/app/purchase-orders", label: "Purchase orders", icon: ShoppingCart },
    { to: "/app/suppliers", label: "Suppliers", icon: Truck },
  ] },
  { group: "Insights", items: [
    { to: "/app/reports", label: "Reports", icon: BarChart3 },
    { to: "/app/mydata", label: "myDATA", icon: ShieldCheck },
    { to: "/app/settings", label: "Settings", icon: Settings },
  ] },
];

function NavItems({ onNavigate }) {
  return NAV.map((g) => (
    <div key={g.group || "top"} className="mb-4">
      {g.group && <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80">{g.group}</p>}
      {g.items.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={onNavigate}
          className={({ isActive }) => cx("flex items-center gap-3 px-3 h-9 rounded-lg text-sm font-medium transition-colors",
            isActive ? "bg-brand-soft text-brand" : "text-muted hover:text-ink hover:bg-surface-2")}>
          <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />{label}
        </NavLink>
      ))}
    </div>
  ));
}

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);
  const nav = useNavigate();
  const load = () => api.get("/notifications").then(setData).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60_000); return () => clearInterval(t); }, []);
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
      <button onClick={toggle} className="relative p-2 rounded-xl text-muted hover:text-ink hover:bg-surface-2" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {data.unread > 0 && <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-danger text-white text-[10px] font-bold flex items-center justify-center">{data.unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-24px)] card shadow-lift p-2 z-30 animate-in">
          <p className="px-2 py-1.5 text-xs font-semibold text-muted">Notifications</p>
          {data.items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted">You're all caught up.</p>}
          <div className="max-h-96 overflow-y-auto">
            {data.items.map((n) => (
              <button key={n.id} onClick={() => { setOpen(false); if (n.link) nav(n.link); }}
                className="w-full text-left px-2 py-2 rounded-lg hover:bg-surface-2">
                <p className="text-sm leading-snug">{n.message}</p>
                <p className="text-[11px] text-muted mt-0.5">{relative(n.created_at)}</p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const [drawer, setDrawer] = useState(false);
  const loc = useLocation();
  useEffect(() => setDrawer(false), [loc.pathname]);

  const Sidebar = (
    <div className="flex flex-col h-full">
      <div className="px-4 h-16 flex items-center"><Link to="/app"><Logo /></Link></div>
      <div className="px-3 pb-4">
        <Link to="/app/scan" className="flex items-center justify-center gap-2 h-11 rounded-xl bg-brand text-white font-semibold text-sm shadow-[0_8px_20px_-8px_hsl(var(--brand)/0.7)] hover:brightness-110 transition" data-testid="sidebar-scan">
          <ScanLine className="h-[18px] w-[18px]" />Scan receipt or invoice
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto px-3"><NavItems onNavigate={() => setDrawer(false)} /></nav>
      <div className="p-3 border-t border-line">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand to-violet text-white font-semibold text-sm flex items-center justify-center">{(user?.name || "?")[0]}</div>
          <div className="min-w-0 flex-1"><p className="text-sm font-semibold truncate">{user?.name}</p><p className="text-[11px] text-muted truncate">{user?.email}</p></div>
          <button onClick={logout} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface-2" title="Sign out" aria-label="Sign out"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg">
      <aside className="hidden lg:block fixed inset-y-0 left-0 w-[260px] bg-surface border-r border-line z-20">{Sidebar}</aside>
      {drawer && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-[rgb(10_15_30/0.4)]" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[280px] bg-surface shadow-lift animate-in">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 p-2 rounded-lg text-muted" aria-label="Close menu"><X className="h-5 w-5" /></button>
            {Sidebar}
          </aside>
        </div>
      )}
      <div className="lg:pl-[260px]">
        <header className="sticky top-0 z-10 h-16 bg-bg/80 backdrop-blur-md border-b border-line/70 flex items-center gap-3 px-4 sm:px-6 lg:px-10">
          <button className="lg:hidden p-2 -ml-2 rounded-lg text-muted" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <div className="lg:hidden"><Logo /></div>
          <div className="ml-auto flex items-center gap-1"><Notifications /></div>
        </header>
        <main className="px-4 sm:px-6 lg:px-10 py-6 sm:py-8 pb-28 lg:pb-12 max-w-[1400px]"><Outlet /></main>
      </div>
      {/* Phone bottom bar with a central scan button */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)] no-print">
        <div className="grid grid-cols-5 h-16 items-center">
          {[["/app", "Home", LayoutDashboard], ["/app/invoices", "Invoices", FileText], null, ["/app/expenses", "Expenses", Receipt], ["/app/reports", "Reports", BarChart3]].map((it) =>
            it ? (() => {
              const [to, label, Icon] = it;
              return (
                <NavLink key={to} to={to} end={to === "/app"} className={({ isActive }) => cx("flex flex-col items-center gap-1 text-[10px] font-semibold", isActive ? "text-brand" : "text-muted")}>
                  <Icon className="h-5 w-5" />{label}
                </NavLink>
              );
            })() : (
              <Link key="scan" to="/app/scan" className="justify-self-center -mt-7 h-14 w-14 rounded-2xl bg-brand text-white shadow-lift flex items-center justify-center" aria-label="Scan receipt" data-testid="mobile-scan">
                <ScanLine className="h-6 w-6" />
              </Link>
            ))}
        </div>
      </nav>
    </div>
  );
}
