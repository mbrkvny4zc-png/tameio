import { Fragment, useEffect, useState } from "react";
import { Link, NavLink, Navigate, useParams } from "react-router-dom";
import { Printer } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { openConsent } from "@/lib/consent";
import { SiteLayout, useTitle } from "./kit";
import EN from "./legal/en";
import EL from "./legal/el";

export const LEGAL_DOCS = [["terms", "Terms of Service"], ["privacy", "Privacy Policy"], ["cookies", "Cookie Policy"], ["dpa", "Data Processing Agreement"], ["notice", "Legal notice"]];

let cached = null;
/** The operator's details (set by the owner in the hosting environment). */
export function useCompany() {
  const [c, setC] = useState(cached);
  useEffect(() => { if (!cached) api.get("/auth/legal/company").then((r) => { cached = r; setC(r); }).catch(() => setC({})); }, []);
  return c;
}

/** Replace {placeholders}; anything not filled in yet is shown highlighted, so it's obvious before launch. */
function fill(text, c, el) {
  const parts = text.split(/(\{[a-z_]+\})/g);
  return parts.map((p, i) => {
    const m = p.match(/^\{([a-z_]+)\}$/);
    if (!m) return <Fragment key={i}>{p}</Fragment>;
    const key = m[1] === "trade" ? "trade_name" : m[1] === "privacy" ? (c?.privacy_email ? "privacy_email" : "email") : m[1];
    const v = c?.[key];
    if (v) return <Fragment key={i}>{v}</Fragment>;
    return <mark key={i} className="bg-[#f6e3b4] text-[#7a4b00] px-1 rounded" data-testid="legal-missing">[{el ? "συμπληρώνεται" : "to be completed"}: {m[1]}]</mark>;
  });
}

export default function Legal() {
  const { doc } = useParams();
  const { t, lang } = useT();
  const el = lang === "el";
  const c = useCompany();
  const d = (el ? EL : EN)[doc];
  useTitle(d ? (el ? d.title : d.title) : "Legal");
  if (!d) return <Navigate to="/legal/terms" replace />;
  return (
    <SiteLayout>
      <div className="max-w-[1200px] mx-auto px-5 sm:px-8 pt-10 sm:pt-14 pb-20 grid lg:grid-cols-[240px_1fr] gap-10">
        <nav className="lg:sticky lg:top-24 self-start print:hidden" aria-label={t("Legal")} data-testid="legal-nav">
          <p className="eyebrow">{t("Legal")}</p>
          <ul className="mt-3 flex lg:flex-col gap-1.5 overflow-x-auto no-scrollbar">
            {LEGAL_DOCS.map(([k, l]) => (
              <li key={k}><NavLink to={`/legal/${k}`} className={({ isActive }) => `block whitespace-nowrap rounded-lg px-3 py-2 text-[14px] ${isActive ? "bg-[var(--p-ink)] text-[var(--p-bg)]" : "text-[var(--p-muted)] hover:text-[var(--p-ink)]"}`}>{t(l)}</NavLink></li>
            ))}
            <li><button onClick={openConsent} className="block whitespace-nowrap rounded-lg px-3 py-2 text-[14px] text-[var(--p-muted)] hover:text-[var(--p-ink)] text-left">{t("Cookie settings")}</button></li>
          </ul>
        </nav>
        <article className="max-w-[760px]" data-testid={`legal-${doc}`}>
          <h1 className="font-serif text-[38px] sm:text-[52px] leading-[1.05] tracking-tight">{d.title}</h1>
          <p className="text-[13px] text-[var(--p-muted)] mt-3">
            {t("Last updated")}: {c?.version || "—"} · <button onClick={() => window.print()} className="inline-flex items-center gap-1 underline underline-offset-2 print:hidden"><Printer className="h-3.5 w-3.5" />{t("Print or save as PDF")}</button>
          </p>
          <p className="lede mt-6">{fill(d.summary, c, el)}</p>
          <div className="mt-10 space-y-9">
            {d.sections.map(([h, blocks]) => (
              <section key={h}>
                <h2 className="font-serif text-[24px] leading-snug">{h}</h2>
                <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-[#3d362e]">
                  {blocks.map((b, i) => Array.isArray(b)
                    ? <ul key={i} className="list-disc pl-5 space-y-1.5">{b.map((x) => <li key={x}>{fill(x, c, el)}</li>)}</ul>
                    : <p key={i}>{fill(b, c, el)}</p>)}
                </div>
              </section>
            ))}
          </div>
          {doc === "cookies" && <button onClick={openConsent} className="btn-ink h-11 px-5 mt-10" data-testid="legal-cookie-settings">{t("Change cookie settings")}</button>}
          <p className="mt-12 text-[13px] text-[var(--p-muted)] border-t border-[var(--p-line)] pt-5">
            {t("Questions about these documents?")} <Link to="/legal/notice" className="underline underline-offset-2">{t("Contact details")}</Link>
          </p>
        </article>
      </div>
    </SiteLayout>
  );
}
