import { useState } from "react";
import { Link } from "react-router-dom";
import { Minus, Plus } from "lucide-react";
import { translate as tr } from "@/lib/i18n";
import { CtaBand, PageHero, SiteLayout, useTitle } from "./kit";

export const FAQ_GROUPS = [
  ["Invoices & myDATA", [
    ["Does it send my invoices to myDATA?", "Yes. Every invoice is checked against AADE's rules before sending (ΑΦΜ checksum, VAT rates, document type), then transmitted with your own myDATA API credentials. You get the ΜΑΡΚ, and the QR code is printed on the invoice. There's a simulation mode so you can try everything first."],
    ["Can I issue retail receipts and delivery notes?", "Yes. Counter sales become a receipt (ΑΛΠ / ΑΠΥ) in two taps and are reported to myDATA straight away. Digital delivery notes get their ΜΑΡΚ and a QR code that travels with the goods."],
    ["I'm switching from another program. Can I bring my data?", "Yes. Upload an Excel or CSV export of your clients, products and past invoices. Columns are recognised automatically, in Greek or English, and you see a preview before anything is saved."],
    ["Can clients pay by card?", "Yes, with Viva Wallet. Connect your Viva account and invoices get a “Pay by card” button; paid invoices mark themselves as paid."],
  ]],
  ["AI & tax questions", [
    ["How does receipt scanning work?", "Take a photo or upload a PDF. AI reads the vendor, ΑΦΜ, date, net, VAT and total, suggests a category, and spots possible duplicates. Nothing is saved until you review it — and it warns you when the numbers don't add up."],
    ["What can I ask Tameio?", "Anything about your own books, in plain Greek or English: “how much did I spend on fuel this quarter?”, “who owes me money?”, “was October better than September?”. Answers come only from your data — it never guesses figures."],
    ["Can it answer tax questions?", "Yes. Switch to “Tax question” and ask, for example, which VAT rate applies or when stamp duty is due. Tameio searches Taxheaven, ΑΑΔΕ, gov.gr and the official laws live, explains the answer in plain words and links to every source. It's general information, not advice — one tap sends the question to your accountant to confirm."],
  ]],
  ["Calendar & reminders", [
    ["What goes on the calendar?", "Every date your business has: VAT and e-ΕΦΚΑ deadlines, invoices due to you, bills to pay, invoices not yet sent to myDATA, quotes about to expire, supplier certificates, deliveries to confirm, recurring invoices and your own reminders. Things leave the calendar by themselves when they're done."],
    ["Does it work with Google Calendar?", "Yes. One tap adds your Tameio calendar to Google Calendar, Apple Calendar or Outlook through a private link. Google refreshes it every few hours; Tameio's own reminders, in the app and by email, arrive straight away."],
  ]],
  ["Teams & accountants", [
    ["Can my team and my accountant work in Tameio too?", "Yes. Invite staff and your accountant with their own roles. Anyone can leave a comment on an invoice, expense or client and @mention someone — they're told straight away and the conversation stays with the record."],
    ["Do I still need an accountant?", "Probably — and they'll love it. Invite them for free: they see your books live, classify purchase invoices for myDATA, ask for missing receipts and download a monthly pack."],
    ["I'm an accountant. What does it cost?", "Nothing. Accountant accounts are free, with every client on one screen. Your clients pay for their own plan — and the free plan is enough for many micro-businesses."],
  ]],
  ["Plans & your data", [
    ["Is there really a free plan?", "Yes — no card needed. It includes myDATA reporting, 10 invoices and 15 AI receipt scans a month, and a free account for your accountant. Upgrade only when you need more."],
    ["Can I change or cancel my plan?", "Any time. Send us a message from Help & feedback inside the app and we'll move you to the plan you want. Your data stays yours either way."],
    ["Is my data safe, and can I take it with me?", "Your myDATA keys are stored encrypted, you can turn on two-step sign-in, and you can download a full export of your data whenever you like. Delete your account and your data goes with it."],
    ["Can I use it on my phone?", "Yes. Tameio works in any phone browser and can be installed on the home screen like an app — no app store needed."],
  ]],
];

export function FaqList({ items }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="mt-8 border-t border-[var(--p-line)]">
      {items.map(([q, a], n) => (
        <div key={q} className="border-b border-[var(--p-line)]">
          <button onClick={() => setOpen(open === n ? -1 : n)} className="w-full flex items-center justify-between gap-6 py-5 text-left" aria-expanded={open === n}>
            <span className="font-serif text-[20px] sm:text-[22px] leading-snug">{tr(q)}</span>
            {open === n ? <Minus className="h-5 w-5 shrink-0" /> : <Plus className="h-5 w-5 shrink-0" />}
          </button>
          {open === n && <p className="pb-6 -mt-1 text-[16px] leading-relaxed text-[var(--p-muted)] max-w-[720px]">{tr(a)}</p>}
        </div>
      ))}
    </div>
  );
}

export default function Faq() {
  useTitle("FAQ");
  return (
    <SiteLayout>
      <PageHero eyebrow="FAQ" title="Questions, answered" lede="Can't find what you're looking for? Sign up and use Help & feedback inside the app — we answer every message." />
      <div className="max-w-[1200px] mx-auto px-5 sm:px-8 pb-20 grid lg:grid-cols-[220px_1fr] gap-10">
        <nav className="hidden lg:block sticky top-24 self-start space-y-1.5 text-[14px]">
          {FAQ_GROUPS.map(([g], n) => <a key={g} href={`#faq-${n}`} className="block text-[var(--p-muted)] hover:text-[var(--p-ink)]">{tr(g)}</a>)}
        </nav>
        <div className="space-y-14 max-w-[820px]">
          {FAQ_GROUPS.map(([g, items], n) => (
            <section key={g} id={`faq-${n}`} className="scroll-mt-24">
              <h2 className="font-serif text-[30px] sm:text-[36px] tracking-tight">{tr(g)}</h2>
              <FaqList items={items} />
            </section>
          ))}
          <p className="text-[15px] text-[var(--p-muted)]">{tr("Still curious?")} <Link to="/features" className="underline underline-offset-4 text-[var(--p-ink)]">{tr("See every feature")}</Link></p>
        </div>
      </div>
      <CtaBand />
    </SiteLayout>
  );
}
