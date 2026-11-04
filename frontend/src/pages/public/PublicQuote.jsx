import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import { Button, Input, PageLoader } from "@/components/ui";
import { DocTable, PublicFrame } from "@/pages/public/PublicInvoice";
import { translate as tr } from "@/lib/i18n";

export default function PublicQuote() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { api.get(`/public/quotes/${token}`).then(setD).catch(() => setD(false)); }, [token]);
  if (d === null) return <PageLoader />; if (d === false) return <div className="min-h-screen flex items-center justify-center text-muted p-6">{tr("This quote link isn't valid.")}</div>;
  const { quote: q, business: b } = d;
  const decided = ["accepted", "declined"].includes(q.status);
  const expired = q.valid_until && q.valid_until < new Date().toISOString().slice(0, 10);
  const respond = async (action) => {
    setBusy(true); setErr("");
    try { const r = await api.post(`/public/quotes/${token}/respond`, { action, name }); setD({ ...d, quote: { ...q, status: r.status, responded_by: name } }); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <PublicFrame>
      <div className="card shadow-lift rounded-3xl p-6 sm:p-9" data-testid="public-quote">
        <div className="flex flex-wrap justify-between gap-6">
          <div>{b.logo && <img src={b.logo} alt="" className="h-11 max-w-[160px] object-contain mb-3" />}<p className="font-bold text-lg">{b.business_name}</p><p className="text-sm text-muted">{[b.address, b.city].filter(Boolean).join(", ")}</p></div>
          <div className="text-right"><p className="text-xs uppercase tracking-widest text-muted">{tr("Quote")}</p><p className="text-2xl font-extrabold font-display">{q.number}</p>
            <p className="text-sm text-muted">{date(q.issue_date)}{q.valid_until && ` · valid until ${date(q.valid_until)}`}</p></div>
        </div>
        <p className="mt-6 text-sm">{tr("For")} <b>{q.client_name}</b></p>
        <div className="mt-4"><DocTable doc={q} /></div>
        {q.notes && <p className="mt-6 text-sm text-muted whitespace-pre-line">{q.notes}</p>}
        <div className="mt-8">
          {decided ? (
            <div className={`rounded-2xl p-5 flex items-center gap-3 ${q.status === "accepted" ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`} data-testid="quote-result">
              {q.status === "accepted" ? <CheckCircle2 className="h-6 w-6" /> : <XCircle className="h-6 w-6" />}
              <div><p className="font-bold">Quote {q.status}</p><p className="text-sm opacity-80">{q.status === "accepted" ? `Thank you${q.responded_by ? `, ${q.responded_by}` : ""}! ${b.business_name} has been notified.` : `${b.business_name} has been notified.`}</p></div>
            </div>) : expired ? <p className="text-sm text-warn">This quote has expired — please ask {b.business_name} for an updated one.</p> : (
            <div className="rounded-2xl border border-line p-5">
              <p className="font-semibold">{tr("Happy with this quote?")}</p>
              <Input className="mt-3" placeholder={tr("Your name (optional)")} value={name} onChange={(e) => setName(e.target.value)} />
              {err && <p className="text-sm text-danger mt-2">{err}</p>}
              <div className="mt-4 flex flex-wrap gap-3">
                <Button size="lg" onClick={() => respond("accept")} loading={busy} data-testid="quote-accept"><CheckCircle2 className="h-5 w-5" />{tr("Accept quote")}</Button>
                <Button size="lg" variant="secondary" onClick={() => window.confirm(tr("Decline this quote?")) && respond("decline")} disabled={busy}>{tr("Decline")}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </PublicFrame>
  );
}
