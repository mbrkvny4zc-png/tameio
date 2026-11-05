import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { translate as tr } from "@/lib/i18n";
import { CtaBand, PageHero, PLANS, SiteLayout, Ticks, useTitle } from "./kit";
import { FaqList, FAQ_GROUPS } from "./Faq";

const EVERY_PLAN = ["myDATA reporting for every document type", "ΑΦΜ auto-fill", "Calendar with reminders and Google Calendar", "Ask Tameio and tax questions with sources",
  "Comments and @mentions", "Your accountant, free", "Greek and English", "Export all your data, any time"];

export default function Pricing() {
  useTitle("Pricing");
  return (
    <SiteLayout>
      <PageHero eyebrow="Pricing" title="Fair prices. Start free, stay as long as it fits." lede="No card to sign up. Move up or down a plan whenever you like — your accountant never pays." />
      <section className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-6 pb-16">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4" data-testid="plans">
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
      </section>

      <section className="bg-[var(--p-band)] py-16 sm:py-20">
        <div className="max-w-[1200px] mx-auto px-5 sm:px-8 grid lg:grid-cols-[0.8fr_1.2fr] gap-10">
          <h2 className="h-section">{tr("Included in every plan")}</h2>
          <Ticks className="grid sm:grid-cols-2 gap-x-8 !space-y-0 [&>li]:py-1.5" items={EVERY_PLAN} />
        </div>
      </section>

      <section className="max-w-[880px] mx-auto px-5 sm:px-8 py-20">
        <h2 className="h-section">{tr("Questions about plans")}</h2>
        <FaqList items={FAQ_GROUPS.find((g) => g[0] === "Plans & your data")[1]} />
      </section>

      <CtaBand />
    </SiteLayout>
  );
}
