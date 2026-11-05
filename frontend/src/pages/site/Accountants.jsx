import { Link } from "react-router-dom";
import { ArrowRight, Calculator, FileArchive, Inbox, Landmark, MessageSquareText, ReceiptText } from "lucide-react";
import { translate as tr } from "@/lib/i18n";
import { CtaBand, PageHero, Photo, Screen, SiteLayout, Ticks, useTitle } from "./kit";

const BENEFITS = [
  [Calculator, "All your clients on one screen", "See who is ready to close the month and who is still missing receipts."],
  [ReceiptText, "Ask for missing receipts", "One click sends your client a list; what they upload lands straight in their books."],
  [Inbox, "Purchase invoices, classified", "Invoices suppliers report to myDATA arrive by themselves; AI suggests the E3 category, you confirm and send."],
  [FileArchive, "Month close in one file", "A tidy ZIP with every invoice, receipt and summary, ready for your own software."],
  [MessageSquareText, "Answer on the invoice", "Clients @mention you on the exact invoice they mean. No more “which one?” phone calls."],
  [Landmark, "Tax rules with sources", "Clients can check a rule themselves — with links to Taxheaven and ΑΑΔΕ — and send it to you to confirm."],
];

const STEPS = [
  ["Open your free accountant account", "Sign up as an accounting firm. You get your own referral link and code straight away."],
  ["Bring your clients", "Share the link, or set a client up yourself. Each business you bring is linked to your firm."],
  ["Earn every month", "You receive a share of each referred client's subscription, for as long as they stay. A monthly report shows every euro."],
];

export default function Accountants() {
  useTitle("For accountants");
  return (
    <SiteLayout>
      <PageHero eyebrow="For accountants — free" title="Every client's month on one desk."
        lede="See which clients are ready to close and which are missing receipts. Ask for what's missing in one click, classify purchase invoices for myDATA and download a tidy monthly pack.">
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/signup?type=accountant" className="btn-ink h-12 px-6 text-[15px]" data-testid="accountant-signup">{tr("Open a free accountant account")}<ArrowRight className="h-4 w-4" /></Link>
          <a href="#partners" className="btn-line h-12 px-6 text-[15px]">{tr("Partner programme")}</a>
        </div>
      </PageHero>

      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-8 pb-20">
        <div className="grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-16 items-start">
          <Photo src="/photos/accountant.jpg" alt={tr("An accountant at her desk with ledgers and a calculator")} caption={tr("Accounting office, Thessaloniki")} imgClass="rounded-[18px] aspect-[4/5]" />
          <div className="grid sm:grid-cols-2 gap-x-8">
            {BENEFITS.map(([Icon, t, d]) => (
              <div key={t} className="py-6 border-t border-[var(--p-line)]">
                <Icon className="h-5 w-5 text-[var(--p-accent)]" />
                <p className="font-serif text-[21px] leading-snug mt-3">{tr(t)}</p>
                <p className="text-[15px] text-[var(--p-muted)] mt-2 leading-relaxed">{tr(d)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[var(--p-band)] py-20 sm:py-24">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div>
            <p className="eyebrow">{tr("Work with your clients")}</p>
            <h2 className="h-section mt-4">{tr("The question arrives on the invoice it's about.")}</h2>
            <p className="lede mt-5">{tr("Your clients @mention you on an invoice or expense. You answer there, they get an email, and the conversation stays with the record for next year.")}</p>
            <Ticks className="mt-7" items={["Free, with unlimited clients", "Clients invite you — or you set them up", "Your own Mentions inbox across every client"]} />
          </div>
          <Screen name="comments" alt={tr("A conversation on an invoice between the owner and the accountant")} />
        </div>
      </section>

      <section id="partners" className="scroll-mt-24 max-w-[1200px] mx-auto px-5 sm:px-8 py-20 sm:py-28">
        <div className="max-w-[760px]">
          <p className="eyebrow">{tr("Partner programme")}</p>
          <h2 className="h-section mt-4">{tr("Recommend Tameio. Earn with every client.")}</h2>
          <p className="lede mt-5">{tr("Accounting firms that bring their clients to Tameio receive a share of every subscription — every month, for as long as the client stays.")}</p>
        </div>
        <ol className="mt-12 grid md:grid-cols-3 gap-4">
          {STEPS.map(([t, d], n) => (
            <li key={t} className="rounded-[20px] bg-[var(--p-card)] border border-[var(--p-line)] p-6">
              <p className="font-serif text-[40px] leading-none text-[var(--p-accent)]">{n + 1}</p>
              <p className="font-serif text-[22px] leading-snug mt-4">{tr(t)}</p>
              <p className="text-[15px] text-[var(--p-muted)] mt-2 leading-relaxed">{tr(d)}</p>
            </li>
          ))}
        </ol>
        <p className="text-[13px] text-[var(--p-muted)] mt-6">{tr("The share and payout terms are in your partner agreement. Clients pay the same price either way.")}</p>
      </section>

      <CtaBand title="Bring your clients. Keep your evenings." text="A free accountant account takes two minutes. Add your first client today, or let them invite you." />
    </SiteLayout>
  );
}
