import { Link } from "react-router-dom";
import { LangToggle, useT } from "@/lib/i18n";
import { Logo, APP_NAME } from "@/components/Logo";

// Template privacy notice. Fill in the [bracketed] items and have it reviewed before launch.
const SECTIONS = [
  ["Who we are", `${APP_NAME} is operated by [company legal name, address, ΑΦΜ]. Contact: [privacy@yourdomain.gr].`],
  ["What we store", "Your account (name, email, hashed password), your business details, and the documents you create or upload: invoices, quotes, orders, expenses, receipts, supplier documents and bank statement lines."],
  ["Why", "To provide the service you signed up for (contract), to report invoices to AADE myDATA when you ask us to (legal obligation of your business), and to keep the service secure (legitimate interest)."],
  ["AI processing", "When you scan a receipt or ask for category suggestions, the document is sent to our AI provider (Anthropic) to read it. It is not used to train their models under our commercial terms. Nothing is saved until you confirm."],
  ["Who else sees it", "People you invite (team members, your accountant), AADE when you send documents to myDATA, Viva Wallet when your clients pay by card, and our hosting and email providers acting on our instructions."],
  ["Where it's stored", "[Hosting provider and region, e.g. EU (Frankfurt)]. Backups are kept for [30] days."],
  ["How long", "As long as your account exists, and afterwards only as long as Greek tax law requires you to keep business records. You can download everything and delete your business at any time from Settings → Security & data."],
  ["Your rights", "Access, correction, deletion, restriction, portability and objection under the GDPR. You can also complain to the Hellenic Data Protection Authority (www.dpa.gr)."],
  ["Security", "Encrypted connections, hashed passwords, optional two-step sign-in, encrypted storage of your AADE and payment credentials, and per-business access control."],
];

export default function Privacy() {
  const { t } = useT();
  return (
    <div className="min-h-screen bg-bg">
      <header className="max-w-3xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between"><Link to="/"><Logo /></Link><LangToggle /></header>
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
        <h1 className="text-3xl sm:text-4xl font-extrabold">{t("Privacy policy")}</h1>
        <p className="text-sm text-muted mt-2">{t("Last updated")}: [date]</p>
        <div className="mt-8 space-y-7">
          {SECTIONS.map(([h, p]) => (
            <section key={h}><h2 className="text-lg font-bold">{t(h)}</h2><p className="mt-1.5 text-muted leading-relaxed">{t(p)}</p></section>
          ))}
        </div>
      </main>
    </div>
  );
}
