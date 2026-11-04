import { useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight, Check, ScanLine, ShieldCheck, Truck, FileSignature, ClipboardList, RotateCcw, BarChart3, Download, Link2,
  Languages, BellRing, Sparkles, ChevronDown, Menu, X, Camera, FileCheck2, Wallet,
} from "lucide-react";
import { Logo, APP_NAME } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

// Placeholder pricing — set real prices before launch.
const PLANS = [
  { name: "Solo", price: 9, blurb: "Freelancers and one-person trades", features: ["Unlimited invoices & quotes", "myDATA reporting", "30 AI receipt scans / month", "Income vs expenses reports"] },
  { name: "Business", price: 19, popular: true, blurb: "Shops, studios and small teams", features: ["Everything in Solo", "200 AI scans / month", "Sales & purchase orders", "Supplier onboarding & compliance", "Accountant CSV export"] },
  { name: "Team", price: 39, blurb: "Growing companies with many suppliers", features: ["Everything in Business", "Unlimited AI scans", "Unlimited suppliers", "Priority support"] },
];

const FAQ = [
  ["Does it send my invoices to myDATA?", "Yes. Every invoice is checked against AADE's rules before sending (ΑΦΜ checksum, VAT rates, document type), then transmitted with your own myDATA API credentials. You get the ΜΑΡΚ, and the QR code is printed on the invoice. There's a simulation mode so you can try everything first."],
  ["How does receipt scanning work?", "Take a photo or upload a PDF. AI reads the vendor, ΑΦΜ, date, net, VAT and total, suggests a category, and spots possible duplicates. Nothing is saved until you review it — and it warns you when the numbers don't add up."],
  ["Can I fix an invoice after it's reported?", "Reported invoices are locked, as the law expects. You correct them with a credit note linked to the original ΜΑΡΚ, or cancel them — both are built in."],
  ["What do suppliers have to do?", "Nothing complicated: you send a private link, they fill in their details and upload their tax and social security clearances, ΓΕΜΗ certificate and contract — in Greek or English, no account needed. You get reminders before anything expires."],
  ["Do I still need an accountant?", `Probably — ${APP_NAME} keeps your books tidy and exports everything your accountant asks for (invoices, credit notes and expenses as Excel-ready CSV).`],
];

function Nav() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const links = [["#features", "Features"], ["#how", "How it works"], ["#pricing", "Pricing"], ["#faq", "FAQ"]];
  return (
    <header className="sticky top-0 z-30 bg-bg/75 backdrop-blur-xl border-b border-line/60">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-6">
        <Link to="/"><Logo /></Link>
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-muted">
          {links.map(([h, l]) => <a key={h} href={h} className="hover:text-ink transition-colors">{l}</a>)}
        </nav>
        <div className="ml-auto hidden sm:flex items-center gap-2">
          {user ? <Link to="/app" className="h-10 px-4 inline-flex items-center rounded-xl bg-brand text-white text-sm font-semibold">Open app</Link> : <>
            <Link to="/login" className="h-10 px-4 inline-flex items-center rounded-xl text-sm font-semibold text-ink hover:bg-surface-2">Sign in</Link>
            <Link to="/signup" className="h-10 px-4 inline-flex items-center gap-1.5 rounded-xl bg-ink text-bg text-sm font-semibold hover:opacity-90" data-testid="nav-signup">Start free <ArrowRight className="h-4 w-4" /></Link>
          </>}
        </div>
        <button className="sm:hidden ml-auto p-2 -mr-2 text-muted" onClick={() => setOpen(!open)} aria-label="Menu">{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <div className="sm:hidden border-t border-line bg-surface px-4 py-3 space-y-1">
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="block py-2 text-sm font-medium">{l}</a>)}
          <div className="flex gap-2 pt-2">
            <Link to="/login" className="flex-1 h-10 inline-flex items-center justify-center rounded-xl border border-line text-sm font-semibold">Sign in</Link>
            <Link to="/signup" className="flex-1 h-10 inline-flex items-center justify-center rounded-xl bg-brand text-white text-sm font-semibold">Start free</Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* ---------- product visuals (HTML, so they stay crisp at any resolution) ---------- */

function HeroVisual() {
  const bars = [38, 52, 45, 61, 58, 74, 69, 83];
  return (
    <div className="relative mx-auto max-w-[560px] lg:max-w-none">
      <div className="absolute -inset-10 bg-[radial-gradient(closest-side,hsl(var(--brand)/0.22),transparent)] blur-2xl" aria-hidden />
      <div className="relative card shadow-lift rounded-3xl p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div><p className="text-xs text-muted font-medium">Profit · October</p><p className="num text-3xl font-bold tracking-tight mt-1">€6.240,50</p></div>
          <span className="chip bg-success/10 text-success">+18% vs Sep</span>
        </div>
        <div className="mt-5 flex items-end gap-2 h-24">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 h-full flex flex-col justify-end gap-1">
              <div className="rounded-md bg-brand/90" style={{ height: `${h}%` }} />
              <div className="rounded-md bg-danger/25" style={{ height: `${h * 0.42}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3 text-center">
          {[["Income", "€9.870", "text-ink"], ["Expenses", "€3.629", "text-ink"], ["VAT due", "€1.497", "text-warn"]].map(([l, v, c]) => (
            <div key={l} className="rounded-xl bg-surface-2 py-2.5"><p className="text-[11px] text-muted">{l}</p><p className={`num font-bold ${c}`}>{v}</p></div>
          ))}
        </div>
      </div>
      {/* floating receipt scan card */}
      <div className="absolute -left-4 sm:-left-12 -bottom-40 w-[230px] card shadow-lift rounded-2xl p-3.5 rotate-[-3deg] hidden sm:block">
        <div className="flex items-center gap-2 text-xs font-semibold"><span className="h-6 w-6 rounded-lg bg-brand-soft text-brand flex items-center justify-center"><Sparkles className="h-3.5 w-3.5" /></span>Receipt read</div>
        <div className="mt-2.5 space-y-1.5 text-[11px]">
          {[["Vendor", "Shell Kifisias"], ["Category", "Fuel & vehicle"], ["VAT 24%", "€12,00"], ["Total", "€62,00"]].map(([k, v]) => (
            <div key={k} className="flex justify-between"><span className="text-muted">{k}</span><span className="font-semibold num">{v}</span></div>
          ))}
        </div>
      </div>
      {/* floating myDATA card */}
      <div className="absolute -right-3 sm:-right-8 -top-8 card shadow-lift rounded-2xl px-3.5 py-2.5 rotate-[2deg] hidden sm:flex items-center gap-2.5">
        <span className="h-8 w-8 rounded-xl bg-success/10 text-success flex items-center justify-center"><ShieldCheck className="h-4 w-4" /></span>
        <div><p className="text-xs font-semibold">INV-0142 reported</p><p className="text-[10px] text-muted num">ΜΑΡΚ 400001927364551</p></div>
      </div>
    </div>
  );
}

function PillarVisual({ kind }) {
  if (kind === "invoice") return (
    <div className="card p-4 rounded-2xl space-y-2.5">
      {[["INV-0142", "Kafeneio Plaka", "€849,40", "ΜΑΡΚ ✓", "success"], ["INV-0141", "Stavrou Bakery", "€572,88", "ΜΑΡΚ ✓", "success"], ["CN-0003", "→ INV-0139", "−€55,80", "Credit", "violet"]].map(([n, c, a, s, t]) => (
        <div key={n} className="flex items-center gap-3 text-xs">
          <span className="font-semibold w-16">{n}</span><span className="text-muted flex-1 truncate">{c}</span><span className="num font-semibold">{a}</span>
          <span className={`chip ${t === "success" ? "bg-success/10 text-success" : "bg-violet/10 text-violet"}`}>{s}</span>
        </div>
      ))}
    </div>
  );
  if (kind === "scan") return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0 h-32 rounded-xl bg-[repeating-linear-gradient(0deg,hsl(var(--line)),hsl(var(--line))_1px,transparent_1px,transparent_9px)] bg-surface border border-line relative overflow-hidden">
        <div className="absolute inset-x-0 top-1/3 h-0.5 bg-brand shadow-[0_0_12px_hsl(var(--brand))]" />
      </div>
      <ArrowRight className="h-4 w-4 text-muted shrink-0" />
      <div className="card p-3 rounded-xl flex-1 space-y-1.5 text-[11px]">
        {[["ΑΦΜ", "094019245"], ["Net", "€50,00"], ["ΦΠΑ", "€12,00"], ["Category", "Fuel"]].map(([k, v]) => <div key={k} className="flex justify-between"><span className="text-muted">{k}</span><span className="font-semibold num">{v}</span></div>)}
      </div>
    </div>
  );
  return (
    <div className="card p-4 rounded-2xl space-y-2">
      {[["Φορολογική ενημερότητα", "6 days left", "warn"], ["Ασφαλιστική ενημερότητα", "Valid", "success"], ["ΓΕΜΗ", "Valid", "success"], ["Supplier agreement", "Awaiting review", "brand"]].map(([d, s, t]) => (
        <div key={d} className="flex items-center justify-between text-xs gap-2"><span className="truncate">{d}</span>
          <span className={`chip ${{ warn: "bg-warn/10 text-warn", success: "bg-success/10 text-success", brand: "bg-brand-soft text-brand" }[t]}`}>{s}</span></div>
      ))}
    </div>
  );
}

export default function Landing() {
  const [faq, setFaq] = useState(0);
  return (
    <div className="min-h-screen bg-bg overflow-x-hidden">
      <Nav />

      {/* Hero */}
      <section className="relative">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,hsl(var(--brand-soft)),hsl(var(--bg))_70%)]" aria-hidden />
        <div className="absolute inset-0 -z-10 opacity-[0.35] [background-image:radial-gradient(hsl(var(--line))_1px,transparent_1px)] [background-size:22px_22px] [mask-image:linear-gradient(to_bottom,black,transparent_75%)]" aria-hidden />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-14 sm:pt-20 pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-14 lg:gap-10 items-center">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-muted shadow-card">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />Built for AADE myDATA · Ελληνικά & English
            </span>
            <h1 className="mt-6 text-[40px] leading-[1.05] sm:text-6xl font-extrabold">
              Invoices, receipts and suppliers — <span className="bg-gradient-to-r from-brand to-violet bg-clip-text text-transparent">sorted.</span>
            </h1>
            <p className="mt-5 text-lg text-muted max-w-xl leading-relaxed">
              Send myDATA-ready invoices, snap a receipt and let AI file it, and keep every supplier's paperwork current. One simple app for Greek freelancers, shops and trades.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="h-12 px-6 inline-flex items-center gap-2 rounded-xl bg-brand text-white font-semibold shadow-[0_12px_28px_-12px_hsl(var(--brand))] hover:brightness-110 transition" data-testid="hero-signup">
                Start free <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how" className="h-12 px-6 inline-flex items-center rounded-xl border border-line bg-surface font-semibold hover:bg-surface-2">See how it works</a>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
              {["No card needed", "Try myDATA in simulation", "Works on your phone"].map((t) => <li key={t} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-success" />{t}</li>)}
            </ul>
          </div>
          <HeroVisual />
        </div>
      </section>

      {/* Who it's for */}
      <section className="border-y border-line bg-surface">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium text-muted">
          <span className="text-xs uppercase tracking-[0.14em]">Made for</span>
          {["Electricians & plumbers", "Cafés & shops", "Designers & developers", "Consultants", "Workshops", "Small agencies"].map((t) => <span key={t}>{t}</span>)}
        </div>
      </section>

      {/* Three pillars */}
      <section id="features" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold text-brand">Everything in one place</p>
          <h2 className="mt-2 text-3xl sm:text-[42px] font-extrabold leading-tight">Three jobs that eat your evenings. Done in minutes.</h2>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {[
            { icon: ShieldCheck, title: "Invoices that pass myDATA", text: "Every check AADE runs, before you hit send. Get the ΜΑΡΚ and QR on the invoice, gap-free numbering, and credit notes linked to the original.", v: "invoice" },
            { icon: ScanLine, title: "Snap a receipt, AI files it", text: "Photo or PDF in; vendor, ΑΦΜ, VAT and category out. Duplicates and wrong totals are flagged, so your expenses are right the first time.", v: "scan" },
            { icon: Truck, title: "Suppliers that stay compliant", text: "Send one link. Suppliers upload their clearances and contracts themselves, and you're reminded before anything expires — or a payment goes to the wrong IBAN.", v: "supplier" },
          ].map(({ icon: Icon, title, text, v }) => (
            <div key={title} className="card rounded-3xl p-6 flex flex-col">
              <div className="h-11 w-11 rounded-2xl bg-brand-soft text-brand flex items-center justify-center"><Icon className="h-5 w-5" /></div>
              <h3 className="mt-5 text-xl font-bold">{title}</h3>
              <p className="mt-2 text-sm text-muted leading-relaxed flex-1">{text}</p>
              <div className="mt-6"><PillarVisual kind={v} /></div>
            </div>
          ))}
        </div>

        <div className="mt-16 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-10">
          {[
            [FileSignature, "Quotes clients accept online", "Send a link; they accept or decline, and you're notified instantly."],
            [ClipboardList, "Sales & purchase orders", "Quote → order → invoice in two clicks. Purchase orders become expenses."],
            [RotateCcw, "Credit notes, done right", "Full or partial, linked to the original ΜΑΡΚ, never more than was invoiced."],
            [BarChart3, "Profit & VAT at a glance", "Income vs expenses by month and category, and the VAT you'll owe."],
            [Download, "Accountant-ready exports", "Invoices, credit notes and expenses as CSV that opens cleanly in Excel."],
            [Link2, "Client invoice links", "Clients view and print invoices online with your IBAN and payment details."],
            [Languages, "Greek & English portal", "Suppliers onboard in their language — no account, no password."],
            [BellRing, "Reminders that matter", "Overdue invoices, expiring certificates and quote responses."],
          ].map(([Icon, t, d]) => (
            <div key={t}>
              <Icon className="h-5 w-5 text-brand" />
              <p className="mt-3 font-semibold">{t}</p>
              <p className="mt-1 text-sm text-muted leading-relaxed">{d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="bg-ink text-bg">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
          <p className="text-sm font-semibold text-[#8FB0FF]">How it works</p>
          <h2 className="mt-2 text-3xl sm:text-[42px] font-extrabold leading-tight max-w-2xl">Set up in five minutes. Save hours every month.</h2>
          <div className="mt-12 grid md:grid-cols-3 gap-6">
            {[
              [Wallet, "1. Add your business", "Your ΑΦΜ, logo and IBAN. Connect myDATA when you're ready — try it in simulation first."],
              [Camera, "2. Invoice and snap", "Create invoices from quotes or from scratch. Photograph receipts as they happen; AI does the typing."],
              [FileCheck2, "3. Stay on top", "See profit and VAT live, chase overdue invoices, and keep suppliers compliant without email ping-pong."],
            ].map(([Icon, t, d]) => (
              <div key={t} className="rounded-3xl border border-white/10 bg-white/[0.04] p-6">
                <Icon className="h-6 w-6 text-[#8FB0FF]" />
                <p className="mt-4 text-lg font-bold">{t}</p>
                <p className="mt-2 text-sm text-white/70 leading-relaxed">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
        <div className="text-center max-w-xl mx-auto">
          <p className="text-sm font-semibold text-brand">Pricing</p>
          <h2 className="mt-2 text-3xl sm:text-[42px] font-extrabold">Simple monthly plans</h2>
          <p className="mt-3 text-muted">Prices exclude VAT. Cancel any time.</p>
        </div>
        <div className="mt-12 grid md:grid-cols-3 gap-5 items-start">
          {PLANS.map((p) => (
            <div key={p.name} className={`rounded-3xl p-6 sm:p-7 ${p.popular ? "bg-ink text-bg shadow-lift md:-mt-3" : "card"}`}>
              <div className="flex items-center justify-between"><p className="font-bold text-lg">{p.name}</p>{p.popular && <span className="chip bg-[#8FB0FF] text-ink">Most popular</span>}</div>
              <p className={`text-sm mt-1 ${p.popular ? "text-white/70" : "text-muted"}`}>{p.blurb}</p>
              <p className="mt-6"><span className="text-4xl font-extrabold font-display num">€{p.price}</span><span className={p.popular ? "text-white/70" : "text-muted"}> / month</span></p>
              <Link to="/signup" className={`mt-6 h-11 w-full inline-flex items-center justify-center rounded-xl font-semibold text-sm ${p.popular ? "bg-white text-ink" : "bg-brand text-white"}`}>Start free</Link>
              <ul className="mt-6 space-y-2.5 text-sm">
                {p.features.map((f) => <li key={f} className="flex gap-2"><Check className={`h-4 w-4 mt-0.5 shrink-0 ${p.popular ? "text-[#8FB0FF]" : "text-success"}`} />{f}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-3xl mx-auto px-4 sm:px-6 pb-24">
        <h2 className="text-3xl sm:text-4xl font-extrabold text-center">Questions</h2>
        <div className="mt-10 card divide-y divide-line">
          {FAQ.map(([q, a], i) => (
            <div key={q}>
              <button className="w-full flex items-center justify-between gap-4 text-left px-5 sm:px-6 py-5 font-semibold" onClick={() => setFaq(faq === i ? -1 : i)} aria-expanded={faq === i}>
                {q}<ChevronDown className={`h-5 w-5 text-muted shrink-0 transition-transform ${faq === i ? "rotate-180" : ""}`} />
              </button>
              {faq === i && <p className="px-5 sm:px-6 pb-5 -mt-1 text-sm text-muted leading-relaxed animate-in">{a}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-20">
        <div className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-[#2F6BFF] to-[#1A3FB8] px-6 sm:px-12 py-14 text-white">
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <h2 className="relative text-3xl sm:text-4xl font-extrabold max-w-xl">Spend your evenings on something better than paperwork.</h2>
          <Link to="/signup" className="relative mt-8 h-12 px-6 inline-flex items-center gap-2 rounded-xl bg-white text-ink font-semibold">Create your free account <ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>

      <footer className="border-t border-line">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted">
          <Logo />
          <p>© {new Date().getFullYear()} {APP_NAME}</p>
        </div>
      </footer>
    </div>
  );
}
