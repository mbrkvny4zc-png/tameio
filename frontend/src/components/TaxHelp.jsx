import { Link } from "react-router-dom";
import { ExternalLink, Landmark, Sparkles } from "lucide-react";
import { translate as tr } from "@/lib/i18n";

/** Trusted places to read the rules yourself. Top-level pages only, so the links don't break when articles move. */
export const TAX_LINKS = [
  ["https://www.taxheaven.gr/", "Taxheaven", "Tax news, laws, ΑΑΔΕ circulars and practical guides"],
  ["https://www.aade.gr/", "ΑΑΔΕ", "The tax authority: decisions, deadlines and myAADE services"],
  ["https://www.aade.gr/mydata", "myDATA", "Official myDATA guides, document types and FAQs"],
  ["https://www.efka.gov.gr/", "e-ΕΦΚΑ", "Social-security contributions and certificates"],
  ["https://www.gov.gr/", "gov.gr", "All government e-services in one place"],
];

/**
 * A small "Ask about this" link next to a tricky field. It opens a tax question in a new tab,
 * so a half-filled form is never lost.
 */
export function AskTax({ q, label = "Ask about this", className = "" }) {
  return (
    <a href={`/app/ask?mode=tax&q=${encodeURIComponent(tr(q))}`} target="_blank" rel="noopener"
      className={`inline-flex items-center gap-1 text-brand font-semibold hover:underline ${className}`} data-testid="ask-tax-link">
      <Sparkles className="h-3 w-3" />{tr(label)}
    </a>
  );
}

/** Card on the Help page: read the rules on Taxheaven and the official sites, or ask a tax question. */
export function TaxHelpCard() {
  return (
    <div className="card p-5 sm:p-6" data-testid="tax-help">
      <div className="flex items-start gap-3">
        <span className="h-10 w-10 rounded-xl bg-brand-soft text-brand flex items-center justify-center shrink-0"><Landmark className="h-5 w-5" /></span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{tr("Tax rules & official help")}</p>
          <p className="text-sm text-muted mt-0.5">{tr("Not sure about a VAT rate, a deadline or a myDATA rule? Ask Tameio — it searches Taxheaven and the official sites and shows you the sources.")}</p>
          <Link to="/app/ask?mode=tax" className="h-9 px-3.5 text-sm mt-3 inline-flex items-center gap-1.5 rounded-xl bg-brand text-white font-semibold"><Sparkles className="h-4 w-4" />{tr("Ask a tax question")}</Link>
        </div>
      </div>
      <ul className="mt-5 grid sm:grid-cols-2 gap-2">
        {TAX_LINKS.map(([href, name, desc]) => (
          <li key={href}>
            <a href={href} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2.5 rounded-xl border border-line px-3.5 py-3 hover:bg-surface-2 h-full">
              <ExternalLink className="h-4 w-4 mt-0.5 text-muted shrink-0" />
              <span><span className="block text-sm font-semibold">{name}</span><span className="block text-xs text-muted">{tr(desc)}</span></span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
