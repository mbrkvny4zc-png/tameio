/* Shared pieces of the public website: menu, footer, photo/screenshot frames and page furniture. */
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowRight, Check, Menu, X } from "lucide-react";
import { LogoMark, APP_NAME } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { getLang, LangToggle, translate as tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { getRef } from "@/lib/referral";

export const NAV = [["/features", "Features"], ["/accountants", "For accountants"], ["/pricing", "Pricing"], ["/faq", "FAQ"]];

// Placeholder pricing — set real prices before launch.
export const PLANS = [
  { name: "Free", price: 0, blurb: "Try everything, no card", features: ["10 invoices / month", "15 AI receipt scans / month", "myDATA reporting", "Your accountant, free"] },
  { name: "Solo", price: 9, blurb: "Freelancers and one-person trades", features: ["Unlimited invoices & quotes", "30 AI receipt scans / month", "Card payments & reminders", "Bank matching & tax calendar"] },
  { name: "Business", price: 19, popular: true, blurb: "Shops, studios and small teams", features: ["Everything in Solo", "200 AI scans / month", "Up to 5 team members", "Supplier onboarding & compliance", "Purchase invoices from myDATA"] },
  { name: "Team", price: 39, blurb: "Growing companies with many suppliers", features: ["Everything in Business", "Unlimited AI scans", "Unlimited team & suppliers", "Priority support"] },
];

/** Page title for the browser tab and search results. */
export function useTitle(title) {
  useEffect(() => { document.title = title ? `${tr(title)} — ${APP_NAME}` : `${APP_NAME} — ${tr("invoicing & books for Greek small businesses")}`; }, [title]);
}

/** Thin strip at the top when a visitor arrived through an accounting firm's link. */
function RefBanner() {
  const [firm, setFirm] = useState("");
  useEffect(() => { const c = getRef(); if (c) api.get(`/public/ref/${c}`).then((r) => setFirm(r.firm)).catch(() => {}); }, []);
  if (!firm) return null;
  return (
    <div className="bg-[var(--p-ink)] text-[var(--p-bg)] text-[13px] text-center px-4 py-2.5" data-testid="ref-banner">
      {tr("Recommended by {firm}", { firm })} · <Link to="/signup" className="underline underline-offset-4 font-semibold">{tr("Start free")}</Link>
    </div>
  );
}

function Nav() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    h(); window.addEventListener("scroll", h, { passive: true }); return () => window.removeEventListener("scroll", h);
  }, []);
  const link = ({ isActive }) => `transition-colors ${isActive ? "text-[var(--p-ink)] font-semibold" : "hover:text-[var(--p-ink)]"}`;
  return (
    <header className={`sticky top-0 z-30 transition-colors ${scrolled || open ? "bg-[var(--p-bg)]/95 backdrop-blur-md border-b border-[var(--p-line)]" : "bg-transparent"}`}>
      <div className="max-w-[1200px] mx-auto px-5 sm:px-8 h-16 flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2"><LogoMark className="h-7 w-7" /><span className="font-serif text-[22px] tracking-tight">{APP_NAME}</span></Link>
        <nav className="hidden md:flex items-center gap-7 text-[14px] text-[var(--p-muted)]" data-testid="site-nav">
          {NAV.map(([to, l]) => <NavLink key={to} to={to} className={link}>{tr(l)}</NavLink>)}
        </nav>
        <div className="ml-auto hidden sm:flex items-center gap-3">
          <LangToggle />
          {user ? <Link to="/app" className="btn-ink">{tr("Open app")}</Link> : <>
            <Link to="/login" className="text-[14px] px-2 hover:underline underline-offset-4">{tr("Sign in")}</Link>
            <Link to="/signup" className="btn-ink" data-testid="nav-signup">{tr("Try Tameio free")}</Link>
          </>}
        </div>
        <LangToggle className="sm:hidden ml-auto" />
        <button className="md:hidden p-2 -mr-2 sm:ml-0" onClick={() => setOpen(!open)} aria-label={tr("Menu")} aria-expanded={open} data-testid="site-menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <div className="md:hidden border-t border-[var(--p-line)] bg-[var(--p-bg)] px-5 py-3 space-y-1">
          {[["/", "Home"], ...NAV].map(([to, l]) => (
            <NavLink key={to} to={to} end className={({ isActive }) => `block py-2.5 text-[17px] font-serif ${isActive ? "text-[var(--p-accent)]" : ""}`}>{tr(l)}</NavLink>
          ))}
          <div className="flex gap-2 pt-3">
            {user ? <Link to="/app" className="btn-ink flex-1 justify-center">{tr("Open app")}</Link> : <>
              <Link to="/login" className="btn-line flex-1 justify-center whitespace-nowrap">{tr("Sign in")}</Link>
              <Link to="/signup" className="btn-ink flex-[1.4] justify-center whitespace-nowrap">{tr("Start free")}</Link>
            </>}
          </div>
        </div>
      )}
    </header>
  );
}

function Footer() {
  const el = getLang() === "el";
  const cols = [
    ["Product", [["/features", "Features"], ["/features#calendar", "Calendar & reminders"], ["/features#ask", "Ask Tameio"], ["/pricing", "Pricing"]]],
    ["For accountants", [["/accountants", "Free accountant account"], ["/accountants#partners", "Partner programme"]]],
    ["Help", [["/faq", "FAQ"], ["/privacy", "Privacy"], ["/login", "Sign in"]]],
  ];
  return (
    <footer className="border-t border-[var(--p-line)]">
      <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-12 grid sm:grid-cols-[1.2fr_repeat(3,1fr)] gap-8 text-[14px]">
        <div>
          <div className="flex items-center gap-2"><LogoMark className="h-6 w-6" /><span className="font-serif text-[20px]">{APP_NAME}</span></div>
          <p className="text-[var(--p-muted)] mt-3 max-w-[260px]">{tr("Invoicing, myDATA and books for Greek small businesses — and free for their accountants.")}</p>
        </div>
        {cols.map(([h, links]) => (
          <div key={h}>
            <p className="eyebrow">{tr(h)}</p>
            <ul className="mt-3 space-y-2 text-[var(--p-muted)]">{links.map(([to, l]) => <li key={to}><Link to={to} className="hover:text-[var(--p-ink)]">{tr(l)}</Link></li>)}</ul>
          </div>
        ))}
      </div>
      <div className="border-t border-[var(--p-line)]">
        <p className="max-w-[1200px] mx-auto px-5 sm:px-8 py-5 text-[13px] text-[var(--p-muted)]">© {new Date().getFullYear()} {APP_NAME}{el ? " · Φτιαγμένο στην Ελλάδα" : " · Made in Greece"}</p>
      </div>
    </footer>
  );
}

/** Every public page: menu on top, footer at the bottom; scrolls to the top (or to #section) when the page changes. */
export function SiteLayout({ children }) {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) {
      const id = decodeURIComponent(hash.slice(1));
      const go = () => document.getElementById(id)?.scrollIntoView({ block: "start" });
      requestAnimationFrame(go); const t = setTimeout(go, 250); return () => clearTimeout(t);
    }
    window.scrollTo(0, 0);
    return undefined;
  }, [pathname, hash]);
  return (
    <div className="paper min-h-screen overflow-x-hidden">
      <RefBanner />
      <Nav />
      <main>{children}</main>
      <Footer />
    </div>
  );
}

/** Big page heading used at the top of each inner page. */
export function PageHero({ eyebrow, title, lede, children }) {
  return (
    <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-10 sm:pt-16 pb-6">
      <p className="eyebrow">{tr(eyebrow)}</p>
      <h1 className="font-serif text-[40px] leading-[1.04] sm:text-[60px] lg:text-[72px] tracking-[-0.02em] mt-4 max-w-[900px]">{tr(title)}</h1>
      {lede && <p className="lede mt-5 max-w-[680px]">{tr(lede)}</p>}
      {children}
    </section>
  );
}

/* Photos live in /public/photos. Until a file is there, a warm, grainy plate stands in so the layout never breaks. */
export function Photo({ src, alt, caption, className = "", imgClass = "", priority }) {
  const [ok, setOk] = useState(true);
  return (
    <figure className={`relative ${className}`}>
      <div className={`photo grain relative overflow-hidden bg-[#d9c7a7] ${imgClass}`}>
        {ok ? <img src={src} alt={alt} loading={priority ? "eager" : "lazy"} decoding="async" onError={() => setOk(false)} className="h-full w-full object-cover" />
          : <div className="h-full w-full bg-[radial-gradient(120%_90%_at_30%_20%,#ecdcbc,#c9a97b_55%,#8a6a45)]" role="img" aria-label={alt} />}
      </div>
      {caption && <figcaption className="mt-2.5 text-[12px] tracking-wide text-[var(--p-muted)] font-mono">{caption}</figcaption>}
    </figure>
  );
}

/** Real screenshots of the app (public/screens), in Greek when the page is in Greek. */
const screen = (name) => `/screens/${name}${getLang() === "el" ? "-el" : ""}.jpg`;

/** A desktop screenshot in a light browser frame. */
export function Screen({ name, alt, className = "", imgClass = "aspect-[16/10]" }) {
  return (
    <figure className={`rounded-[18px] overflow-hidden border border-[var(--p-line)] bg-white shadow-[0_24px_60px_-28px_rgb(40_28_12/0.45)] ${className}`}>
      <div className="h-7 flex items-center gap-1.5 px-3 bg-[#f1ece2] border-b border-[var(--p-line)]" aria-hidden="true">
        <span className="h-2.5 w-2.5 rounded-full bg-[#e2a08f]" /><span className="h-2.5 w-2.5 rounded-full bg-[#e7c98a]" /><span className="h-2.5 w-2.5 rounded-full bg-[#a9c48f]" />
      </div>
      <img src={screen(name)} alt={alt} loading="lazy" decoding="async" className={`w-full object-cover object-left-top ${imgClass}`} />
    </figure>
  );
}

/** A phone screenshot in a simple phone frame. */
export function Phone({ name, alt, className = "" }) {
  return (
    <figure className={`rounded-[38px] bg-[#1f1a14] p-2.5 shadow-[0_30px_70px_-30px_rgb(40_28_12/0.6)] ${className}`}>
      <img src={screen(name)} alt={alt} loading="lazy" decoding="async" className="w-full rounded-[30px] aspect-[390/664] object-cover object-top" />
    </figure>
  );
}

/** A small scanned-receipt card that floats over the hero photo. */
export function ReceiptCard() {
  return (
    <div className="w-[250px] shrink-0 rounded-[14px] bg-[#fffdf8] text-[#1f1a14] shadow-[0_24px_60px_-20px_rgb(40_28_10/0.45)] p-4 rotate-[-2deg] border border-[#eadfca]">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.16em] text-[#6b6257]">{tr("Read by AI")}</span>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#e6eedb] text-[#3f5a24] font-semibold">{tr("Ready to save")}</span>
      </div>
      <p className="font-serif text-[19px] mt-2 leading-tight">Αλευρόμυλοι Αττικής</p>
      <dl className="mt-3 space-y-1.5 text-[12px]">
        {[["ΑΦΜ", "094019245"], [tr("Net"), "€182,26"], [tr("VAT 13%"), "€23,69"], [tr("Category"), tr("Goods & materials")]].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3"><dt className="text-[#6b6257]">{k}</dt><dd className="font-semibold tabular-nums text-right">{v}</dd></div>
        ))}
      </dl>
      <div className="mt-3 pt-3 border-t border-dashed border-[#e2d6bf] flex justify-between items-baseline">
        <span className="text-[12px] text-[#6b6257]">{tr("Total")}</span><span className="font-serif text-[22px] tabular-nums">€205,95</span>
      </div>
    </div>
  );
}

export function MarkCard() {
  return (
    <div className="w-[230px] shrink-0 rounded-[14px] bg-[#1f1a14] text-[#f6f1e7] shadow-[0_24px_60px_-20px_rgb(20_14_6/0.6)] p-4 rotate-[1.5deg]">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[#bfb29c]">myDATA · ΑΑΔΕ</p>
      <p className="mt-2 text-[13px]">{tr("Receipt")} REC-0412 · €4,80</p>
      <p className="mt-1 font-mono text-[12px] text-[#e9c99a]">ΜΑΡΚ 400001284719356</p>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#b8d4a0]"><Check className="h-3.5 w-3.5" />{tr("Reported in 1.2 seconds")}</p>
    </div>
  );
}

/** A tick list. */
export function Ticks({ items, className = "" }) {
  return (
    <ul className={`space-y-2.5 text-[16px] ${className}`}>
      {items.map((x) => <li key={x} className="flex gap-3"><Check className="h-5 w-5 mt-0.5 text-[var(--p-olive)] shrink-0" /><span>{tr(x)}</span></li>)}
    </ul>
  );
}

/** Dark closing band with the phone screenshot. */
export function CtaBand({ title = "Open the shop. We'll keep the books.", text = "Set up in five minutes. Bring your clients and products from Excel, or start with sample data to look around." }) {
  return (
    <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pb-24 pt-8">
      <div className="grid lg:grid-cols-[1.1fr_0.9fr] rounded-[26px] overflow-hidden bg-[#1f1a14] text-[#f6f1e7]">
        <div className="p-8 sm:p-14 flex flex-col justify-center">
          <h2 className="font-serif text-[36px] sm:text-[52px] leading-[1.05] tracking-tight">{tr(title)}</h2>
          <p className="mt-5 text-[16px] opacity-75 max-w-[440px]">{tr(text)}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/signup" className="h-12 px-6 rounded-full bg-[#f6f1e7] text-[#1f1a14] inline-flex items-center gap-2 font-semibold text-[15px]">{tr("Create your free account")}<ArrowRight className="h-4 w-4" /></Link>
            <Link to="/pricing" className="h-12 px-6 rounded-full border border-[#f6f1e7]/40 inline-flex items-center gap-2 font-semibold text-[15px] hover:bg-white/5">{tr("See pricing")}</Link>
          </div>
        </div>
        <div className="relative min-h-[320px] bg-[radial-gradient(120%_90%_at_70%_20%,#4a3b2a,#1f1a14_70%)] flex items-end justify-center pt-10 px-8 overflow-hidden">
          <Phone name="phone-expenses" alt={tr("Expenses in the Tameio app on a phone, sorted by category")} className="w-[230px] sm:w-[260px] translate-y-16" />
        </div>
      </div>
    </section>
  );
}
