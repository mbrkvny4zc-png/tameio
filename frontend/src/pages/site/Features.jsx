import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { translate as tr } from "@/lib/i18n";
import { CtaBand, PageHero, Phone, Photo, Screen, SiteLayout, Ticks, useTitle } from "./kit";

const SECTIONS = [
  ["invoices", "Invoices & myDATA"], ["expenses", "Receipts & expenses"], ["paid", "Getting paid"], ["calendar", "Calendar"],
  ["ask", "Ask Tameio"], ["team", "Team & accountant"], ["reports", "Reports"], ["more", "Everything else"],
];

const ASK = [
  { q: "How much did I spend on fuel this quarter?", a: "€412,60 across 9 receipts — about 18% more than last quarter, mostly in October.", h: [["Fuel · Q4", "€412,60"], ["Q3", "€349,10"]] },
  { q: "Who owes me money right now?", a: "Three clients owe €2.184,00 in total. Studio Λευκό's invoice is 12 days overdue — it might be worth a reminder.", h: [["Unpaid", "€2.184,00"], ["Overdue", "€620,00"]] },
  { q: "Was October better than September?", a: "Yes. Profit was €6.240,50 in October against €5.288,90 in September, mainly from two larger design jobs.", h: [["October", "€6.240,50"], ["September", "€5.288,90"]] },
];

const MORE = [
  ["Supplier compliance", "Tax and social-security clearances collected, with reminders before they expire."],
  ["Quotes, orders, delivery notes", "From quote to invoice to delivery note without retyping a line."],
  ["Stock & online shops", "Stock that counts itself down, and orders from WooCommerce or Shopify that become receipts."],
  ["Card terminal (beta)", "Take card payments at the counter with Viva and issue the receipt in one go."],
  ["A menu that fits you", "Pin what you use most, hide what you don't, and arrange the dashboard your way."],
  ["Bring your data", "Clients, products and past invoices from Excel or CSV, in minutes."],
  ["On your phone", "Install Tameio on your phone's home screen — no app store needed."],
  ["Safe and yours", "Two-step sign-in, encrypted myDATA keys, and a full export of your data whenever you want."],
];

function AskDemo({ n }) {
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
        <p className="eyebrow">{String(n).padStart(2, "0")} · {tr("Ask Tameio")}</p>
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

/** One feature section: words on one side, a picture on the other (alternating). */
function Block({ id, n, tag, title, text, ticks, visual, flip, isNew, children }) {
  return (
    <section id={id} className="scroll-mt-32 max-w-[1200px] mx-auto px-5 sm:px-8 py-16 sm:py-24 border-t border-[var(--p-line)] first:border-t-0">
      <div className={`grid lg:grid-cols-2 gap-10 lg:gap-16 items-center ${flip ? "lg:[&>*:first-child]:order-2" : ""}`}>
        <div>
          <p className="eyebrow">{String(n).padStart(2, "0")} · {tr(tag)}{isNew && <span className="ml-2 text-[var(--p-accent)]">· {tr("New")}</span>}</p>
          <h2 className="h-section mt-4">{tr(title)}</h2>
          <p className="lede mt-5">{tr(text)}</p>
          {ticks && <Ticks className="mt-7" items={ticks} />}
          {children}
        </div>
        <div>{visual}</div>
      </div>
    </section>
  );
}

export default function Features() {
  useTitle("Features");
  const [active, setActive] = useState("invoices");
  useEffect(() => {
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setActive(e.target.id)), { rootMargin: "-40% 0px -55% 0px" });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    // Above the first section, highlight the first entry again.
    const top = () => { const first = document.getElementById(SECTIONS[0][0]); if (first && first.getBoundingClientRect().top > window.innerHeight * 0.4) setActive(SECTIONS[0][0]); };
    window.addEventListener("scroll", top, { passive: true });
    return () => { io.disconnect(); window.removeEventListener("scroll", top); };
  }, []);
  return (
    <SiteLayout>
      <PageHero eyebrow="Features" title="Everything a small business needs, in one place."
        lede="Invoices, receipts, payments, deadlines and your accountant — in plain Greek or English, on the computer and on the phone." />

      {/* Section menu */}
      <div className="sticky top-16 z-20 bg-[var(--p-bg)]/95 backdrop-blur-md border-y border-[var(--p-line)]">
        <nav className="max-w-[1200px] mx-auto px-5 sm:px-8 flex gap-1.5 overflow-x-auto no-scrollbar py-2.5" data-testid="features-menu">
          {SECTIONS.map(([id, l]) => (
            <a key={id} href={`#${id}`} className={`whitespace-nowrap text-[13px] px-3.5 py-1.5 rounded-full transition-colors ${active === id ? "bg-[var(--p-ink)] text-[var(--p-bg)]" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>{tr(l)}</a>
          ))}
        </nav>
      </div>

      <Block id="invoices" n={1} tag="Invoices & myDATA" title="Invoice from the workshop."
        text="Pick the client, pick the saved product, send. It's reported to myDATA with its ΜΑΡΚ and QR before the sawdust settles."
        ticks={["Invoices, receipts, credit notes and delivery notes — every Greek document type", "Type the ΑΦΜ; name, address and tax office fill themselves in", "Describe the job in a sentence and AI drafts the invoice", "Several series and branches, your own invoice design", "Withholding tax and stamp duty worked out for you"]}
        visual={<Photo src="/photos/carpenter.jpg" alt={tr("A carpenter writing an invoice at his workbench")} imgClass="rounded-[18px] aspect-[4/3] lg:aspect-[4/5]" />} />

      <Block id="expenses" n={2} tag="Receipts & expenses" title="The shoebox, retired." flip
        text="Snap every supplier receipt at the counter. AI reads the ΑΦΜ, VAT and total, files it under the right category and flags duplicates."
        ticks={["Photo, PDF or forward the email — it's read in seconds", "Purchase invoices your suppliers report to myDATA arrive by themselves, classified by AI", "Nothing is saved until you check it", "Ready for your accountant, month by month"]}
        visual={<div className="grid grid-cols-[1fr_0.75fr] gap-4 items-end"><Photo src="/photos/kafeneio.jpg" alt={tr("A kafeneio owner making Greek coffee behind a marble counter")} imgClass="rounded-[18px] aspect-[4/5]" /><Phone name="phone-scan" alt={tr("Scanning a receipt in the Tameio app on a phone")} /></div>} />

      <Block id="paid" n={3} tag="Getting paid" title="Paid before you close up."
        text="Every invoice carries a “Pay by card” link. Reminders go out on their own, and paid invoices mark themselves as paid."
        ticks={["Card payments with Viva Wallet", "Polite automatic reminders for overdue invoices", "Part payments and client statements", "Import a statement from any Greek bank and payments match themselves"]}
        visual={<Photo src="/photos/florist.jpg" alt={tr("A florist arranging flowers outside her shop")} imgClass="rounded-[18px] aspect-[4/3] lg:aspect-[4/5]" />} />

      <Block id="calendar" n={4} tag="Calendar & reminders" isNew flip title="Every deadline, in your Google Calendar."
        text="VAT, e-ΕΦΚΑ, invoices due, bills to pay, quotes expiring, supplier certificates, myDATA — Tameio puts every date your business has in one calendar, and reminds you before it's due."
        ticks={["Things appear and disappear by themselves — a paid invoice leaves the calendar on its own", "Reminders in the app and by email, 1, 3 or 7 days before", "One tap adds it to Google Calendar, Apple Calendar or Outlook", "Add your own dates too — rent, ΕΝΦΙΑ instalments, anything"]}
        visual={<Screen name="calendar" alt={tr("The Tameio calendar with tax deadlines, payments due and myDATA reminders")} />} />

      <section id="ask" className="scroll-mt-32 mt-4 bg-[var(--p-band)] py-20 sm:py-28">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
          <AskDemo n={5} />
          <div className="mt-20 grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
            <div>
              <p className="eyebrow">{tr("Tax questions")} · <span className="text-[var(--p-accent)]">{tr("New")}</span></p>
              <h3 className="font-serif text-[32px] sm:text-[40px] leading-tight mt-3">{tr("Not sure about a rule? Ask — with sources.")}</h3>
              <p className="lede mt-4">{tr("Which VAT rate applies? When is stamp duty due? Tameio searches Taxheaven, ΑΑΔΕ, gov.gr and the laws live, explains the answer in plain words and shows you where it found it.")}</p>
              <Ticks className="mt-6" items={["Links to every source, so you can check", "“Ask my accountant” sends the question to your accountant in one tap", "“Ask about this” next to tricky fields while you invoice"]} />
              <a href="https://www.taxheaven.gr/" target="_blank" rel="noopener noreferrer" className="mt-6 inline-flex items-center gap-1.5 text-[14px] text-[var(--p-muted)] hover:text-[var(--p-ink)]"><ExternalLink className="h-4 w-4" />taxheaven.gr</a>
            </div>
            <Screen name="ask-tax" alt={tr("A tax question answered in Tameio, with links to Taxheaven and ΑΑΔΕ")} />
          </div>
        </div>
      </section>

      <Block id="team" n={6} tag="Team & accountant" isNew title="Ask on the invoice, not in a dozen chats."
        text="Leave a note on any invoice, expense or client and @mention a teammate or your accountant. They're told straight away, and every answer stays with the record it's about."
        ticks={["@mentions with a Mentions inbox — mark things done when they're answered", "Your accountant joins for free and sees your books live", "Roles for owners, staff and accountants", "Emails when someone needs you"]}
        visual={<Screen name="comments" alt={tr("A conversation on an invoice between the owner and the accountant")} />} />

      <Block id="reports" n={7} tag="Reports" flip title="Numbers you can actually use."
        text="Profit, VAT, who owes you and where the money went — at a glance. Build your own reports and have them emailed to your team every week or month."
        ticks={["Ready-made reports and a simple report builder", "Scheduled emails to the people who need them", "Export to Excel for your accountant"]}
        visual={<Screen name="dashboard" alt={tr("The Tameio dashboard: income, expenses, profit, VAT and what needs attention")} />} />

      <section id="more" className="scroll-mt-32 max-w-[1200px] mx-auto px-5 sm:px-8 py-16 sm:py-24 border-t border-[var(--p-line)]">
        <p className="eyebrow">{tr("Everything else")}</p>
        <h2 className="h-section mt-4">{tr("The rest of the paperwork, handled.")}</h2>
        <dl className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-x-8">
          {MORE.map(([t, d]) => (
            <div key={t} className="py-6 border-t border-[var(--p-line)]">
              <dt className="font-serif text-[21px] leading-snug">{tr(t)}</dt><dd className="text-[15px] text-[var(--p-muted)] mt-2 leading-relaxed">{tr(d)}</dd>
            </div>
          ))}
        </dl>
        <Screen name="delivery-notes" alt={tr("Delivery notes in Tameio, with their ΜΑΡΚ and status")} className="mt-12" imgClass="aspect-[16/8]" />
      </section>

      <CtaBand />
    </SiteLayout>
  );
}
