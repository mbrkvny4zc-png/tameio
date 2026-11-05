import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, Check, Menu, Minus, Plus, X } from "lucide-react";
import { LogoMark, APP_NAME } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { getLang, LangToggle, translate as tr } from "@/lib/i18n";
import { api } from "@/lib/api";
import { getRef } from "@/lib/referral";

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

// Placeholder pricing — set real prices before launch.
const PLANS = [
  { name: "Free", price: 0, blurb: "Try everything, no card", features: ["10 invoices / month", "15 AI receipt scans / month", "myDATA reporting", "Your accountant, free"] },
  { name: "Solo", price: 9, blurb: "Freelancers and one-person trades", features: ["Unlimited invoices & quotes", "30 AI receipt scans / month", "Card payments & reminders", "Bank matching & tax calendar"] },
  { name: "Business", price: 19, popular: true, blurb: "Shops, studios and small teams", features: ["Everything in Solo", "200 AI scans / month", "Up to 5 team members", "Supplier onboarding & compliance", "Purchase invoices from myDATA"] },
  { name: "Team", price: 39, blurb: "Growing companies with many suppliers", features: ["Everything in Business", "Unlimited AI scans", "Unlimited team & suppliers", "Priority support"] },
];

const FAQ = [
  ["Does it send my invoices to myDATA?", "Yes. Every invoice is checked against AADE's rules before sending (ΑΦΜ checksum, VAT rates, document type), then transmitted with your own myDATA API credentials. You get the ΜΑΡΚ, and the QR code is printed on the invoice. There's a simulation mode so you can try everything first."],
  ["Can I issue retail receipts and delivery notes?", "Yes. Counter sales become a receipt (ΑΛΠ / ΑΠΥ) in two taps and are reported to myDATA straight away. Digital delivery notes get their ΜΑΡΚ and a QR code that travels with the goods."],
  ["How does receipt scanning work?", "Take a photo or upload a PDF. AI reads the vendor, ΑΦΜ, date, net, VAT and total, suggests a category, and spots possible duplicates. Nothing is saved until you review it — and it warns you when the numbers don't add up."],
  ["What can I ask Tameio?", "Anything about your own books, in plain Greek or English: “how much did I spend on fuel this quarter?”, “who owes me money?”, “was October better than September?”. Answers come only from your data — it never guesses figures."],
  ["I'm switching from another program. Can I bring my data?", "Yes. Upload an Excel or CSV export of your clients, products and past invoices. Columns are recognised automatically, in Greek or English, and you see a preview before anything is saved."],
  ["Do I still need an accountant?", "Probably — and they'll love it. Invite them for free: they see your books live, classify purchase invoices for myDATA, ask for missing receipts and download a monthly pack."],
  ["I'm an accountant. What does it cost?", "Nothing. Accountant accounts are free, with every client on one screen. Your clients pay for their own plan — and the free plan is enough for many micro-businesses."],
  ["Can clients pay by card?", "Yes, with Viva Wallet. Connect your Viva account and invoices get a “Pay by card” button; paid invoices mark themselves as paid."],
];

/* Photos live in /public/photos. Until a file is there, a warm, grainy plate stands in so the layout never breaks. */
function Photo({ src, alt, caption, className = "", imgClass = "", priority }) {
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
function Screen({ name, alt, className = "", imgClass = "aspect-[16/10]" }) {
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
function Phone({ name, alt, className = "" }) {
  return (
    <figure className={`rounded-[38px] bg-[#1f1a14] p-2.5 shadow-[0_30px_70px_-30px_rgb(40_28_12/0.6)] ${className}`}>
      <img src={screen(name)} alt={alt} loading="lazy" decoding="async" className="w-full rounded-[30px] aspect-[390/664] object-cover object-top" />
    </figure>
  );
}

function Nav() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 8);
    h(); window.addEventListener("scroll", h, { passive: true }); return () => window.removeEventListener("scroll", h);
  }, []);
  const links = [["#product", "Product"], ["#ask", "Ask Tameio"], ["#accountants", "For accountants"], ["#pricing", "Pricing"]];
  return (
    <header className={`sticky top-0 z-30 transition-colors ${scrolled ? "bg-[var(--p-bg)]/90 backdrop-blur-md border-b border-[var(--p-line)]" : "bg-transparent"}`}>
      <div className="max-w-[1200px] mx-auto px-5 sm:px-8 h-16 flex items-center gap-8">
        <Link to="/" className="flex items-center gap-2"><LogoMark className="h-7 w-7" /><span className="font-serif text-[22px] tracking-tight">{APP_NAME}</span></Link>
        <nav className="hidden md:flex items-center gap-7 text-[14px] text-[var(--p-muted)]">
          {links.map(([h, l]) => <a key={h} href={h} className="hover:text-[var(--p-ink)] transition-colors">{tr(l)}</a>)}
        </nav>
        <div className="ml-auto hidden sm:flex items-center gap-3">
          <LangToggle />
          {user ? <Link to="/app" className="btn-ink">{tr("Open app")}</Link> : <>
            <Link to="/login" className="text-[14px] px-2 hover:underline underline-offset-4">{tr("Sign in")}</Link>
            <Link to="/signup" className="btn-ink" data-testid="nav-signup">{tr("Try Tameio free")}</Link>
          </>}
        </div>
        <LangToggle className="sm:hidden ml-auto" />
        <button className="sm:hidden p-2 -mr-2" onClick={() => setOpen(!open)} aria-label={tr("Menu")}>{open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}</button>
      </div>
      {open && (
        <div className="sm:hidden border-t border-[var(--p-line)] bg-[var(--p-bg)] px-5 py-3 space-y-1">
          {links.map(([h, l]) => <a key={h} href={h} onClick={() => setOpen(false)} className="block py-2 text-[15px]">{tr(l)}</a>)}
          <div className="flex gap-2 pt-2">
            <Link to="/login" className="btn-line flex-1 justify-center">{tr("Sign in")}</Link>
            <Link to="/signup" className="btn-ink flex-1 justify-center">{tr("Try Tameio free")}</Link>
          </div>
        </div>
      )}
    </header>
  );
}

/* A small scanned-receipt card that floats over the hero photo. */
function ReceiptCard() {
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

function MarkCard() {
  return (
    <div className="w-[230px] shrink-0 rounded-[14px] bg-[#1f1a14] text-[#f6f1e7] shadow-[0_24px_60px_-20px_rgb(20_14_6/0.6)] p-4 rotate-[1.5deg]">
      <p className="text-[10px] uppercase tracking-[0.16em] text-[#bfb29c]">myDATA · ΑΑΔΕ</p>
      <p className="mt-2 text-[13px]">{tr("Receipt")} REC-0412 · €4,80</p>
      <p className="mt-1 font-mono text-[12px] text-[#e9c99a]">ΜΑΡΚ 400001284719356</p>
      <p className="mt-2 flex items-center gap-1.5 text-[12px] text-[#b8d4a0]"><Check className="h-3.5 w-3.5" />{tr("Reported in 1.2 seconds")}</p>
    </div>
  );
}

const STORIES = [
  { img: "/photos/kafeneio.jpg", tag: "Receipts", title: "The shoebox, retired.", text: "Snap every supplier receipt at the counter. AI reads the ΑΦΜ, VAT and total, files it under the right category and flags duplicates." },
  { img: "/photos/carpenter.jpg", tag: "Invoices", title: "Invoice from the workshop.", text: "Pick the client, pick the saved product, send. It's reported to myDATA with its ΜΑΡΚ and QR before the sawdust settles." },
  { img: "/photos/florist.jpg", tag: "Getting paid", title: "Paid before you close up.", text: "Every invoice carries a “Pay by card” link. Reminders go out on their own, and paid invoices mark themselves as paid." },
  { screen: "delivery-notes", tag: "Delivery notes", title: "Parts out the door, paperwork done.", text: "Digital delivery notes with ΜΑΡΚ and QR, filled in from the invoice in one tap. The driver carries the QR; you carry on." },
];

const FEATURES = [
  ["Invoices, receipts & credit notes", "Every Greek document type, checked against AADE's rules and reported to myDATA."],
  ["ΑΦΜ auto-fill", "Type the ΑΦΜ; name, address and tax office fill themselves in."],
  ["Purchase invoices from myDATA", "What suppliers report about you arrives on its own, classified by AI."],
  ["Bank matching", "Import a statement from any Greek bank; payments match to invoices and receipts."],
  ["Quotes, orders, delivery notes", "From quote to invoice to delivery note without retyping a line."],
  ["Supplier compliance", "Tax and social-security clearances collected, with reminders before they expire."],
  ["Calendar & reminders", "Every deadline in one place — taxes, money in and out, myDATA, quotes — with reminders, and in your Google Calendar too."],
  ["Bring your data", "Clients, products and past invoices from Excel or CSV, in minutes."],
];

const ASK = [
  { q: "How much did I spend on fuel this quarter?", a: "€412,60 across 9 receipts — about 18% more than last quarter, mostly in October.", h: [["Fuel · Q4", "€412,60"], ["Q3", "€349,10"]] },
  { q: "Who owes me money right now?", a: "Three clients owe €2.184,00 in total. Studio Λευκό's invoice is 12 days overdue — it might be worth a reminder.", h: [["Unpaid", "€2.184,00"], ["Overdue", "€620,00"]] },
  { q: "Was October better than September?", a: "Yes. Profit was €6.240,50 in October against €5.288,90 in September, mainly from two larger design jobs.", h: [["October", "€6.240,50"], ["September", "€5.288,90"]] },
];

function AskDemo() {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState("");
  const item = ASK[i];
  const answer = tr(item.a);
  useEffect(() => {
    setTyped("");
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setTyped(answer); return undefined; }
    let n = 0;
    const id = setInterval(() => { n += 3; setTyped(answer.slice(0, n)); if (n >= answer.length) clearInterval(id); }, 18);
    return () => clearInterval(id);
  }, [i, answer]);
  return (
    <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
      <div>
        <p className="eyebrow">{tr("Ask Tameio")}</p>
        <h2 className="h-section mt-4">{tr("Ask your books a question. Get a straight answer.")}</h2>
        <p className="lede mt-5">{tr("No reports to build, no spreadsheets. Ask in Greek or English — answers come only from your own invoices, receipts and bank, never from guesswork.")}</p>
        <div className="mt-8 space-y-2.5">
          {ASK.map((x, n) => (
            <button key={x.q} onClick={() => setI(n)} className={`w-full text-left px-4 py-3 rounded-xl border transition-colors text-[15px] ${n === i ? "border-[var(--p-ink)] bg-[var(--p-card)]" : "border-[var(--p-line)] hover:border-[var(--p-ink)]/40"}`} data-testid={`ask-demo-${n}`}>
              “{tr(x.q)}”
            </button>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-[var(--p-muted)]">{tr("Example answers from a sample business.")}</p>
      </div>
      <div className="rounded-[22px] bg-[var(--p-card)] border border-[var(--p-line)] shadow-[0_30px_80px_-40px_rgb(40_28_10/0.35)] p-5 sm:p-7 min-h-[360px]">
        <div className="flex items-center gap-2 text-[12px] text-[var(--p-muted)]"><span className="h-2 w-2 rounded-full bg-[var(--p-accent)]" />{tr("Ask Tameio")}</div>
        <div className="mt-5 flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--p-ink)] text-[var(--p-bg)] px-4 py-2.5 text-[15px]">{tr(item.q)}</p></div>
        <div className="mt-4 max-w-[92%]">
          <p className="font-serif text-[21px] leading-snug min-h-[96px]">{typed}<span className="inline-block w-[2px] h-[1em] align-[-2px] bg-[var(--p-accent)] ml-0.5 animate-pulse" /></p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {item.h.map(([l, v]) => (
              <div key={l} className="rounded-xl bg-[var(--p-bg)] border border-[var(--p-line)] px-4 py-3">
                <p className="text-[11px] uppercase tracking-[0.12em] text-[var(--p-muted)]">{tr(l)}</p><p className="font-serif text-[24px] tabular-nums mt-1">{v}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Landing() {
  const [faq, setFaq] = useState(0);
  const el = getLang() === "el";
  return (
    <div className="paper min-h-screen overflow-x-hidden">
      <RefBanner />
      <Nav />

      {/* Hero */}
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-10 sm:pt-16">
        <div className="max-w-[880px]">
          <p className="eyebrow">{tr("For Greek small businesses and their accountants")}</p>
          <h1 className="font-serif text-[44px] leading-[1.02] sm:text-[72px] lg:text-[88px] tracking-[-0.02em] mt-5">
            {tr("Your books, in order.")}<br /><span className="italic text-[var(--p-accent)]">{tr("Your evenings, back.")}</span>
          </h1>
          <p className="lede mt-6 max-w-[620px]">{tr("Invoices and receipts that report themselves to myDATA, expenses read from a photo, and a books assistant you can simply ask. Made for the bakery, the workshop and the studio — not for accountants' jargon.")}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link to="/signup" className="btn-ink h-12 px-6 text-[15px]" data-testid="hero-signup">{tr("Start free — no card")}<ArrowRight className="h-4 w-4" /></Link>
            <a href="#product" className="btn-line h-12 px-6 text-[15px]">{tr("See how it works")}</a>
          </div>
        </div>
        <div className="relative mt-12 sm:mt-16">
          <Photo src="/photos/hero.jpg" priority alt={tr("A baker writing in a receipt notebook at the counter of a small Athens bakery, early morning")}
            caption={tr("Neighbourhood bakery, Kypseli — 6:40 a.m.")} imgClass="rounded-[22px] aspect-[16/10] sm:aspect-[16/8]" />
          <div className="hidden md:block absolute right-8 lg:right-14 top-10"><ReceiptCard /></div>
          <div className="hidden md:block absolute left-8 lg:left-14 bottom-16"><MarkCard /></div>
        </div>
        <div className="md:hidden mt-6 flex gap-4 overflow-x-auto py-3 px-2 -mx-2"><ReceiptCard /><MarkCard /></div>
      </section>

      {/* Proof strip */}
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 mt-16 sm:mt-24">
        <div className="grid grid-cols-2 lg:grid-cols-4 border-y border-[var(--p-line)]">
          {[["myDATA", "Invoices, receipts, credit & delivery notes"], ["ΑΦΜ", "Auto-filled from the public registry"], ["30 s", "From photo to filed expense"], ["€0", "For your accountant, always"]].map(([k, v], n) => (
            <div key={k} className={`px-4 sm:px-6 py-6 ${n % 2 ? "border-l border-[var(--p-line)]" : ""} ${n === 2 ? "lg:border-l" : ""} ${n > 1 ? "border-t lg:border-t-0 border-[var(--p-line)]" : ""}`}>
              <p className="font-serif text-[30px] sm:text-[36px] tracking-tight">{k}</p><p className="text-[13px] text-[var(--p-muted)] mt-1">{tr(v)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Stories */}
      <section id="product" className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-24 sm:pt-32">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6 items-end">
          <div><p className="eyebrow">{tr("A day with Tameio")}</p><h2 className="h-section mt-4">{tr("Built around the way small businesses actually work.")}</h2></div>
          <p className="lede lg:pl-10">{tr("Between customers, on the phone, at the end of a long day. Every task takes a minute — and the legal parts take care of themselves.")}</p>
        </div>
        <div className="mt-14 grid sm:grid-cols-2 gap-x-8 gap-y-16">
          {STORIES.map((s, n) => (
            <article key={s.title} className={n % 2 ? "sm:mt-24" : ""}>
              {s.screen ? <Screen name={s.screen} alt={tr("Delivery notes in Tameio, with their ΜΑΡΚ and status")} imgClass="aspect-[4/3]" />
                : <Photo src={s.img} alt={tr(s.title)} imgClass="rounded-[18px] aspect-[4/3]" />}
              <p className="eyebrow mt-6">{String(n + 1).padStart(2, "0")} · {tr(s.tag)}</p>
              <h3 className="font-serif text-[30px] leading-tight mt-2">{tr(s.title)}</h3>
              <p className="text-[16px] leading-relaxed text-[var(--p-muted)] mt-3 max-w-[480px]">{tr(s.text)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Ask */}
      <section id="ask" className="mt-28 sm:mt-36 bg-[var(--p-band)] py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8"><AskDemo /></div>
      </section>

      {/* Everything else */}
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-12">
          <div>
            <p className="eyebrow">{tr("Everything in one place")}</p>
            <h2 className="h-section mt-4">{tr("The rest of the paperwork, handled.")}</h2>
            <Phone name="phone-scan" alt={tr("Scanning a receipt in the Tameio app on a phone")} className="mt-10 hidden lg:block max-w-[300px]" />
          </div>
          <dl className="grid sm:grid-cols-2 gap-x-10">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="py-6 border-t border-[var(--p-line)]">
                <dt className="font-serif text-[22px] leading-snug">{tr(t)}</dt><dd className="text-[15px] text-[var(--p-muted)] mt-2 leading-relaxed">{tr(d)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* The real app */}
      <section className="bg-[#1f1a14] text-[#f6f1e7] overflow-hidden" data-testid="real-app">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-20 sm:pt-28">
          <p className="eyebrow !text-[#e9c99a]">{tr("The real app — no mock-ups")}</p>
          <p className="font-serif text-[32px] sm:text-[52px] leading-[1.08] max-w-[820px] tracking-tight mt-4">{tr("More evenings at the table. Fewer with the paperwork.")}</p>
          <p className="mt-5 text-[16px] opacity-75 max-w-[560px]">{tr("This is what you see when you sign in: the month at a glance, what's owed to you, what needs your attention — on the computer and on the phone.")}</p>
          <div className="relative mt-12 sm:mt-16">
            <Screen name="dashboard" alt={tr("The Tameio dashboard: income, expenses, profit, VAT and what needs attention")} className="hidden sm:block !border-[#3a3128] sm:mr-24 lg:mr-40 translate-y-6" />
            <Phone name="phone-dashboard" alt={tr("The Tameio dashboard on a phone")} className="mx-auto w-[260px] translate-y-16 sm:translate-y-2 sm:absolute sm:right-0 sm:bottom-0 sm:w-[200px] lg:w-[250px]" />
          </div>
        </div>
      </section>

      {/* Accountants */}
      <section id="accountants" className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <Photo src="/photos/accountant.jpg" alt={tr("An accountant at her desk with ledgers and a calculator")} caption={tr("Accounting office, Thessaloniki")} imgClass="rounded-[18px] aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]" />
          <div>
            <p className="eyebrow">{tr("For accountants — free")}</p>
            <h2 className="h-section mt-4">{tr("Every client's month on one desk.")}</h2>
            <p className="lede mt-5">{tr("See which clients are ready to close and which are missing receipts. Ask for what's missing in one click, classify purchase invoices for myDATA and download a tidy monthly pack.")}</p>
            <ul className="mt-8 space-y-3 text-[16px]">
              {["Free accountant account, unlimited clients", "Clients invite you — or you set them up", "Missing receipts requested by email", "Month close with a ZIP export pack"].map((x) => (
                <li key={x} className="flex gap-3"><Check className="h-5 w-5 mt-0.5 text-[var(--p-olive)] shrink-0" />{tr(x)}</li>
              ))}
            </ul>
            <Link to="/signup?type=accountant" className="btn-line h-12 px-6 text-[15px] mt-9">{tr("Open a free accountant account")}<ArrowUpRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="bg-[var(--p-band)] py-24 sm:py-32">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
          <div className="max-w-[640px]"><p className="eyebrow">{tr("Pricing")}</p><h2 className="h-section mt-4">{tr("Fair prices. Start free, stay as long as it fits.")}</h2></div>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {PLANS.map((p) => (
              <div key={p.name} className={`rounded-[20px] p-6 flex flex-col ${p.popular ? "bg-[var(--p-ink)] text-[var(--p-bg)]" : "bg-[var(--p-card)] border border-[var(--p-line)]"}`}>
                <div className="flex items-center justify-between"><p className="font-serif text-[24px]">{tr(p.name)}</p>{p.popular && <span className="text-[11px] uppercase tracking-[0.14em] text-[#e9c99a]">{tr("Most popular")}</span>}</div>
                <p className={`text-[13px] mt-1 ${p.popular ? "opacity-75" : "text-[var(--p-muted)]"}`}>{tr(p.blurb)}</p>
                <p className="mt-6"><span className="font-serif text-[48px] tracking-tight tabular-nums">€{p.price}</span><span className={`text-[13px] ${p.popular ? "opacity-75" : "text-[var(--p-muted)]"}`}> / {tr("month")}</span></p>
                <ul className="mt-6 space-y-2.5 text-[14px] flex-1">
                  {p.features.map((f) => <li key={f} className="flex gap-2.5"><Check className={`h-4 w-4 mt-0.5 shrink-0 ${p.popular ? "text-[#e9c99a]" : "text-[var(--p-olive)]"}`} />{tr(f)}</li>)}
                </ul>
                <Link to="/signup" className={`mt-8 h-11 rounded-full inline-flex items-center justify-center text-[14px] font-semibold ${p.popular ? "bg-[var(--p-bg)] text-[var(--p-ink)]" : "border border-[var(--p-ink)] hover:bg-[var(--p-ink)] hover:text-[var(--p-bg)] transition-colors"}`}>
                  {p.price === 0 ? tr("Start free") : tr("Choose {plan}", { plan: tr(p.name) })}
                </Link>
              </div>
            ))}
          </div>
          <p className="text-[13px] text-[var(--p-muted)] mt-6">{tr("Prices exclude VAT. Change or cancel any time.")}</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="max-w-[880px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <h2 className="h-section">{tr("Questions, answered")}</h2>
        <div className="mt-10 border-t border-[var(--p-line)]">
          {FAQ.map(([q, a], n) => (
            <div key={q} className="border-b border-[var(--p-line)]">
              <button onClick={() => setFaq(faq === n ? -1 : n)} className="w-full flex items-center justify-between gap-6 py-5 text-left" aria-expanded={faq === n}>
                <span className="font-serif text-[20px] sm:text-[22px] leading-snug">{tr(q)}</span>
                {faq === n ? <Minus className="h-5 w-5 shrink-0" /> : <Plus className="h-5 w-5 shrink-0" />}
              </button>
              {faq === n && <p className="pb-6 -mt-1 text-[16px] leading-relaxed text-[var(--p-muted)] max-w-[720px]">{tr(a)}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pb-24">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr] rounded-[26px] overflow-hidden bg-[#1f1a14] text-[#f6f1e7]">
          <div className="p-8 sm:p-14 flex flex-col justify-center">
            <h2 className="font-serif text-[36px] sm:text-[52px] leading-[1.05] tracking-tight">{tr("Open the shop. We'll keep the books.")}</h2>
            <p className="mt-5 text-[16px] opacity-75 max-w-[440px]">{tr("Set up in five minutes. Bring your clients and products from Excel, or start with sample data to look around.")}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/signup" className="h-12 px-6 rounded-full bg-[#f6f1e7] text-[#1f1a14] inline-flex items-center gap-2 font-semibold text-[15px]">{tr("Create your free account")}<ArrowRight className="h-4 w-4" /></Link>
            </div>
          </div>
          <div className="relative min-h-[320px] bg-[radial-gradient(120%_90%_at_70%_20%,#4a3b2a,#1f1a14_70%)] flex items-end justify-center pt-10 px-8 overflow-hidden">
            <Phone name="phone-expenses" alt={tr("Expenses in the Tameio app on a phone, sorted by category")} className="w-[230px] sm:w-[260px] translate-y-16" />
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--p-line)]">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 py-10 flex flex-col sm:flex-row gap-6 sm:items-center justify-between text-[14px] text-[var(--p-muted)]">
          <div className="flex items-center gap-2 text-[var(--p-ink)]"><LogoMark className="h-6 w-6" /><span className="font-serif text-[20px]">{APP_NAME}</span></div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#product" className="hover:text-[var(--p-ink)]">{tr("Product")}</a><a href="#pricing" className="hover:text-[var(--p-ink)]">{tr("Pricing")}</a>
            <Link to="/privacy" className="hover:text-[var(--p-ink)]">{tr("Privacy")}</Link><Link to="/login" className="hover:text-[var(--p-ink)]">{tr("Sign in")}</Link>
          </div>
          <p>© {new Date().getFullYear()} {APP_NAME}{el ? " · Φτιαγμένο στην Ελλάδα" : " · Made in Greece"}</p>
        </div>
      </footer>
    </div>
  );
}
