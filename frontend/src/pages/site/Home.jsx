import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, CalendarDays, FileText, HandCoins, MessageSquareText, ScanLine, Users } from "lucide-react";
import { translate as tr } from "@/lib/i18n";
import { CtaBand, MarkCard, Phone, Photo, ReceiptCard, Screen, SiteLayout, Ticks, useTitle } from "./kit";

// The six things people come for — each opens its section on the Features page.
const TILES = [
  [FileText, "Invoices & myDATA", "Every Greek document type, checked and reported to myDATA with its ΜΑΡΚ and QR.", "invoices"],
  [ScanLine, "Receipts & expenses", "Snap a receipt; AI reads the ΑΦΜ, VAT and total and files it for you.", "expenses"],
  [HandCoins, "Getting paid", "“Pay by card” on every invoice, polite reminders and bank matching.", "paid"],
  [CalendarDays, "Calendar & reminders", "Every deadline in one place — and in your Google Calendar.", "calendar", true],
  [MessageSquareText, "Ask Tameio", "Ask your books anything, or check a tax rule with sources from Taxheaven.", "ask", true],
  [Users, "Team & accountant", "Comment on any invoice and @mention a teammate or your accountant.", "team", true],
];

export default function Home() {
  useTitle(null);
  return (
    <SiteLayout>
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
            <Link to="/features" className="btn-line h-12 px-6 text-[15px]">{tr("See all features")}</Link>
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

      {/* What it does */}
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-24 sm:pt-32">
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6 items-end">
          <div><p className="eyebrow">{tr("What Tameio does")}</p><h2 className="h-section mt-4">{tr("Built around the way small businesses actually work.")}</h2></div>
          <p className="lede lg:pl-10">{tr("Between customers, on the phone, at the end of a long day. Every task takes a minute — and the legal parts take care of themselves.")}</p>
        </div>
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="home-tiles">
          {TILES.map(([Icon, title, text, id, isNew]) => (
            <Link key={id} to={`/features#${id}`} className="group rounded-[20px] bg-[var(--p-card)] border border-[var(--p-line)] p-6 hover:border-[var(--p-ink)]/40 transition-colors flex flex-col">
              <div className="flex items-center justify-between">
                <span className="h-11 w-11 rounded-2xl bg-[var(--p-band)] flex items-center justify-center"><Icon className="h-5 w-5" /></span>
                {isNew && <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-[var(--p-accent)]">{tr("New")}</span>}
              </div>
              <h3 className="font-serif text-[24px] leading-tight mt-5">{tr(title)}</h3>
              <p className="text-[15px] text-[var(--p-muted)] mt-2 leading-relaxed flex-1">{tr(text)}</p>
              <span className="mt-5 text-[14px] font-semibold inline-flex items-center gap-1.5 group-hover:gap-2.5 transition-all">{tr("Learn more")}<ArrowRight className="h-4 w-4" /></span>
            </Link>
          ))}
        </div>
      </section>

      {/* The real app */}
      <section className="mt-24 sm:mt-32 bg-[#1f1a14] text-[#f6f1e7] overflow-hidden" data-testid="real-app">
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

      {/* Accountants teaser */}
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 py-24 sm:py-32">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center">
          <Photo src="/photos/accountant.jpg" alt={tr("An accountant at her desk with ledgers and a calculator")} caption={tr("Accounting office, Thessaloniki")} imgClass="rounded-[18px] aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5]" />
          <div>
            <p className="eyebrow">{tr("For accountants — free")}</p>
            <h2 className="h-section mt-4">{tr("Every client's month on one desk.")}</h2>
            <p className="lede mt-5">{tr("See which clients are ready to close and which are missing receipts. Ask for what's missing in one click, classify purchase invoices for myDATA and download a tidy monthly pack.")}</p>
            <Ticks className="mt-8" items={["Free accountant account, unlimited clients", "Answer clients' questions right on the invoice", "Earn from every client you bring with our partner programme"]} />
            <Link to="/accountants" className="btn-line h-12 px-6 text-[15px] mt-9">{tr("More for accountants")}<ArrowUpRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>

      {/* Pricing teaser */}
      <section className="bg-[var(--p-band)] py-16 sm:py-20">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 flex flex-col md:flex-row md:items-center gap-6 justify-between">
          <div>
            <p className="eyebrow">{tr("Pricing")}</p>
            <p className="font-serif text-[30px] sm:text-[40px] leading-tight mt-3">{tr("Free to start. Plans from €9 a month.")}</p>
            <p className="text-[var(--p-muted)] mt-2">{tr("No card to sign up. Your accountant never pays.")}</p>
          </div>
          <Link to="/pricing" className="btn-ink h-12 px-6 text-[15px] self-start md:self-auto">{tr("See plans")}<ArrowRight className="h-4 w-4" /></Link>
        </div>
      </section>

      <CtaBand />
    </SiteLayout>
  );
}
