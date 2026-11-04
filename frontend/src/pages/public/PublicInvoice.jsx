import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CreditCard, Printer, ShieldCheck, Copy } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { printDocument } from "@/lib/print";
import { Badge, Button, PageLoader } from "@/components/ui";
import { LogoMark, APP_NAME } from "@/components/Logo";
import { translate as tr } from "@/lib/i18n";

export function PublicFrame({ biz, children }) {
  return (
    <div className="min-h-screen bg-bg py-8 sm:py-14 px-4">
      <div className="max-w-2xl mx-auto">
        {children}
        <p className="text-center text-[11px] text-muted mt-8 flex items-center justify-center gap-1.5"><LogoMark className="h-4 w-4" />Sent with {APP_NAME}</p>
      </div>
    </div>
  );
}

export function DocTable({ doc }) {
  const cur = doc.currency || "EUR";
  return (
    <>
      <div className="divide-y divide-line border-y border-line">
        {doc.items.map((i, k) => (
          <div key={k} className="flex justify-between gap-4 py-3 text-sm">
            <div><p>{i.description}</p><p className="text-xs text-muted num">{i.qty} × {money(i.unit_price, cur)}</p></div>
            <p className="num font-medium">{money(i.qty * i.unit_price, cur)}</p>
          </div>
        ))}
      </div>
      <dl className="mt-4 ml-auto max-w-[260px] space-y-1 text-sm">
        <div className="flex justify-between text-muted"><dt>{tr("Net")}</dt><dd className="num">{money(doc.subtotal, cur)}</dd></div>
        <div className="flex justify-between text-muted"><dt>VAT {doc.tax_rate}%</dt><dd className="num">{money(doc.tax, cur)}</dd></div>
        <div className="flex justify-between font-bold text-lg pt-1 border-t border-line"><dt>{tr("Total")}</dt><dd className="num">{money(doc.total, cur)}</dd></div>
      </dl>
    </>
  );
}

export default function PublicInvoice() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [card, setCard] = useState(false);
  const [paying, setPaying] = useState(false);
  useEffect(() => {
    api.get(`/public/invoices/${token}`).then(setD).catch(() => setD(false));
    api.get(`/public/invoices/${token}/payment-options`).then((o) => setCard(o.card)).catch(() => {});
  }, [token]);
  const payByCard = async () => {
    setPaying(true);
    try { const r = await api.post(`/public/invoices/${token}/pay`); window.location.assign(r.redirect_url); }
    catch (e) { toast.error(e.message); setPaying(false); }
  };
  if (d === null) return <PageLoader />; if (d === false) return <div className="min-h-screen flex items-center justify-center text-muted p-6 text-center">{tr("This invoice link isn't valid or the invoice was withdrawn.")}</div>;
  const { invoice: inv, business: b, mydata: md } = d;
  const isCredit = inv.kind === "credit_note";
  return (
    <PublicFrame>
      <div className="card shadow-lift rounded-3xl p-6 sm:p-9" data-testid="public-invoice">
        <div className="flex flex-wrap justify-between gap-6">
          <div>
            {b.logo && <img src={b.logo} alt="" className="h-11 max-w-[160px] object-contain mb-3" />}
            <p className="font-bold text-lg">{b.business_name}</p>
            <p className="text-sm text-muted">{[b.address, b.city].filter(Boolean).join(", ")}</p>
            {b.afm && <p className="text-xs text-muted">ΑΦΜ {b.afm}{b.doy ? ` · ΔΟΥ ${b.doy}` : ""}</p>}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-widest text-muted">{isCredit ? "Credit note" : "Invoice"}</p>
            <p className="text-2xl font-extrabold font-display">{inv.number}</p>
            <p className="text-sm text-muted">{date(inv.issue_date)}{inv.due_date && ` · due ${date(inv.due_date)}`}</p>
            <div className="mt-2">{inv.status === "paid" ? <Badge tone="success">{tr("Paid")}</Badge> : inv.status === "overdue" ? <Badge tone="danger">{tr("Overdue")}</Badge> : isCredit ? <Badge tone="violet">Credits {inv.credit_of_number}</Badge> : <Badge tone="brand">{tr("Awaiting payment")}</Badge>}</div>
          </div>
        </div>
        <div className="mt-7 rounded-2xl bg-surface-2 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-muted">{tr("Billed to")}</p>
          <p className="font-semibold">{inv.client_name}</p>{inv.client_afm && <p className="text-xs text-muted">ΑΦΜ {inv.client_afm}</p>}
        </div>
        <div className="mt-6"><DocTable doc={inv} /></div>
        {inv.notes && <p className="mt-6 text-sm text-muted whitespace-pre-line">{inv.notes}</p>}
        {card && !isCredit && inv.status !== "paid" && (
          <Button size="lg" className="w-full mt-7" onClick={payByCard} loading={paying} data-testid="pay-card"><CreditCard className="h-5 w-5" />Pay {money(inv.total, inv.currency)} by card</Button>
        )}
        {!isCredit && inv.status !== "paid" && (b.iban || b.payment_instructions) && (
          <div className="mt-7 rounded-2xl bg-brand-soft p-5">
            <p className="font-semibold">{tr("How to pay")}</p>
            {b.iban && <div className="mt-2 flex items-center gap-2"><span className="font-mono text-sm">{b.iban}</span>
              <button onClick={() => navigator.clipboard?.writeText(b.iban).then(() => toast.success(tr("IBAN copied")))} className="p-1.5 rounded-lg hover:bg-surface/60" aria-label={tr("Copy IBAN")}><Copy className="h-4 w-4" /></button></div>}
            <p className="text-sm mt-1">{tr("Reference:")} <b>{inv.number}</b></p>
            {b.payment_instructions && <p className="text-sm text-muted mt-2 whitespace-pre-line">{b.payment_instructions}</p>}
          </div>
        )}
        {md && (
          <p className="mt-6 text-xs text-muted flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-success" />{tr("Reported to AADE myDATA · ΜΑΡΚ")} <span className="font-mono">{md.mark}</span>{md.simulated && " (simulation)"}</p>
        )}
        <div className="mt-7 flex justify-end"><Button variant="secondary" onClick={() => printDocument({ ...inv, mydata: md }, b, isCredit ? "credit_note" : "invoice")}><Printer className="h-4 w-4" />{tr("Download PDF")}</Button></div>
      </div>
    </PublicFrame>
  );
}
