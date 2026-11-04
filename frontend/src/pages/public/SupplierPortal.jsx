import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { AlertTriangle, CheckCircle2, FileText, Loader2, ShieldCheck, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Field, Input, PageLoader } from "@/components/ui";
import { LogoMark, APP_NAME } from "@/components/Logo";

const T = {
  el: {
    title: "Ένταξη προμηθευτή", intro: (b) => `Η ${b || "εταιρεία"} χρειάζεται τα παρακάτω στοιχεία και έγγραφα για να σας καταχωρίσει ως προμηθευτή.`,
    details: "Στοιχεία εταιρείας", contact: "Υπεύθυνος επικοινωνίας", email: "Email", phone: "Τηλέφωνο", afm: "ΑΦΜ", doy: "ΔΟΥ", country: "Χώρα",
    address: "Διεύθυνση", iban: "IBAN", save: "Αποθήκευση στοιχείων", saved: "Τα στοιχεία αποθηκεύτηκαν", docs: "Έγγραφα", optional: "προαιρετικό",
    expiry: "Ημερομηνία λήξης", upload: "Μεταφόρτωση", replace: "Αντικατάσταση", submit: "Υποβολή για έλεγχο", submitted: "Ευχαριστούμε! Τα στοιχεία σας υποβλήθηκαν για έλεγχο.",
    approved: "Είστε εγκεκριμένος προμηθευτής. Ανεβάστε εδώ τα ανανεωμένα έγγραφα όταν λήγουν.", missing: "Εκκρεμούν:",
    states: { valid: "Εγκρίθηκε", expiring: "Λήγει σύντομα", expired: "Έληξε", pending_review: "Υπό έλεγχο", rejected: "Απορρίφθηκε", missing: "Λείπει" },
    rejectedNote: "Λόγος απόρριψης:", notFound: "Ο σύνδεσμος δεν βρέθηκε ή έχει λήξει.", files: "PDF, εικόνα, Word ή Excel έως 10 MB", progress: "ολοκληρώθηκαν",
    privacy: "Τα έγγραφά σας είναι ορατά μόνο στην εταιρεία που σας προσκάλεσε.",
  },
  en: {
    title: "Supplier onboarding", intro: (b) => `${b || "Your customer"} needs the details and documents below to set you up as a supplier.`,
    details: "Company details", contact: "Contact person", email: "Email", phone: "Phone", afm: "Tax number (ΑΦΜ)", doy: "Tax office (ΔΟΥ)", country: "Country",
    address: "Address", iban: "IBAN", save: "Save details", saved: "Details saved", docs: "Documents", optional: "optional",
    expiry: "Expiry date", upload: "Upload", replace: "Replace", submit: "Submit for review", submitted: "Thank you! Your onboarding was submitted for review.",
    approved: "You are an approved supplier. Upload renewed documents here when they expire.", missing: "Still missing:",
    states: { valid: "Approved", expiring: "Expiring soon", expired: "Expired", pending_review: "Under review", rejected: "Rejected", missing: "Missing" },
    rejectedNote: "Reason:", notFound: "This link was not found or has expired.", files: "PDF, image, Word or Excel up to 10 MB", progress: "complete",
    privacy: "Your documents are only visible to the company that invited you.",
  },
};
const TONE = { valid: "success", expiring: "warn", expired: "danger", pending_review: "brand", rejected: "danger", missing: "neutral" };
const errText = (e) => [e.message, ...(e.details || [])].join(" — ");

function DocRow({ req, token, latest, t, onUpdated }) {
  const [file, setFile] = useState(null);
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [key, setKey] = useState(0);
  const upload = async () => {
    const fd = new FormData();
    fd.append("requirement_key", req.key); fd.append("file", file);
    if (req.has_expiry) fd.append("expiry_date", expiry);
    setBusy(true); setError("");
    try { onUpdated(await api.upload(`/public/suppliers/${token}/documents`, fd)); setFile(null); setExpiry(""); setKey((k) => k + 1); }
    catch (e) { setError(errText(e)); }
    setBusy(false);
  };
  const needs = ["missing", "rejected", "expired", "expiring"].includes(req.state);
  return (
    <div className="rounded-2xl border border-line p-4" data-testid={`portal-req-${req.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">{req.label}{!req.required && <span className="text-xs text-muted font-normal"> ({t.optional})</span>}</p>
          {req.help && <p className="text-xs text-muted mt-0.5">{req.help}</p>}
          {latest && <p className="text-xs text-muted mt-1.5 flex items-center gap-1"><FileText className="h-3 w-3" />{latest.filename}{latest.expiry_date ? ` · ${latest.expiry_date}` : ""}</p>}
          {latest?.status === "rejected" && latest.review_note && <p className="text-xs text-danger mt-1">{t.rejectedNote} {latest.review_note}</p>}
        </div>
        <Badge tone={TONE[req.state]}>{t.states[req.state]}</Badge>
      </div>
      <div className="flex flex-wrap items-end gap-2 mt-3">
        <Input key={key} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" className="flex-1 min-w-[180px] h-10 py-2 text-xs" onChange={(e) => setFile(e.target.files?.[0] || null)} data-testid={`portal-file-${req.key}`} />
        {req.has_expiry && <div><label className="text-[10px] text-muted block mb-0.5">{t.expiry}</label><Input type="date" className="w-40 text-xs" value={expiry} onChange={(e) => setExpiry(e.target.value)} data-testid={`portal-expiry-${req.key}`} /></div>}
        <Button variant={needs ? "primary" : "secondary"} disabled={!file || (req.has_expiry && !expiry)} loading={busy} onClick={upload} data-testid={`portal-upload-${req.key}`}>
          {!busy && <Upload className="h-4 w-4" />}{latest ? t.replace : t.upload}
        </Button>
      </div>
      {error && <p className="text-xs text-danger mt-2">{error}</p>}
    </div>
  );
}

export default function SupplierPortal() {
  const { token } = useParams();
  const [lang, setLang] = useState(() => ((navigator.language || "").startsWith("en") ? "en" : "el"));
  const t = T[lang];
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [profile, setProfile] = useState(null);
  const [msg, setMsg] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get(`/public/suppliers/${token}`).then((d) => { setData(d); setProfile(d.supplier); }).catch(() => setError(true)); }, [token]);

  const saveProfile = async (e) => {
    e.preventDefault(); setBusy(true); setMsg({});
    try { const d = await api.put(`/public/suppliers/${token}/profile`, profile); setData(d); setProfile(d.supplier); setMsg({ ok: true, text: t.saved }); }
    catch (e2) { setMsg({ ok: false, text: errText(e2) }); }
    setBusy(false);
  };
  const submit = async () => {
    setBusy(true); setMsg({});
    try { setData(await api.post(`/public/suppliers/${token}/submit`)); setMsg({ ok: true, text: t.submitted }); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e) { setMsg({ ok: false, text: errText(e) }); }
    setBusy(false);
  };

  if (error) return <div className="min-h-screen flex items-center justify-center p-6 text-center text-sm text-muted" data-testid="portal-error">{T.el.notFound}<br />{T.en.notFound}</div>;
  if (!data || !profile) return <PageLoader />;
  const latest = (k) => data.documents.filter((d) => d.requirement_key === k).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at))[0];
  const missing = data.requirements.filter((r) => r.required && ["missing", "rejected", "expired"].includes(r.state)).map((r) => r.label);
  const pct = data.progress.total ? Math.round((data.progress.done / data.progress.total) * 100) : 0;
  const P = (k, label, p = {}) => <Field label={label}><Input value={profile[k] || ""} onChange={(e) => setProfile({ ...profile, [k]: e.target.value })} {...p} /></Field>;

  return (
    <div className="min-h-screen bg-bg py-6 sm:py-12 px-4" data-testid="supplier-portal">
      <div className="max-w-2xl mx-auto space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {data.business.logo ? <img src={data.business.logo} alt="" className="h-10 max-w-[140px] object-contain" /> : <LogoMark className="h-10 w-10" />}
            <div className="min-w-0"><p className="font-bold truncate">{data.business.name}</p><p className="text-xs text-muted">{t.title} · {data.supplier.name}</p></div>
          </div>
          <div className="inline-flex p-1 rounded-xl bg-surface-2 border border-line text-xs font-semibold">
            {["el", "en"].map((l) => <button key={l} onClick={() => setLang(l)} className={`px-2.5 h-7 rounded-lg ${lang === l ? "bg-surface shadow-card" : "text-muted"}`}>{l.toUpperCase()}</button>)}
          </div>
        </div>
        <Card className="p-5 sm:p-6">
          <p className="text-sm">{data.supplier.status === "approved" ? t.approved : t.intro(data.business.name)}</p>
          <div className="mt-4 h-2 rounded-full bg-surface-2 overflow-hidden"><div className="h-full bg-gradient-to-r from-brand to-success transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="text-[11px] text-muted mt-1.5">{data.progress.done}/{data.progress.total} {t.progress}</p>
          {msg.text && <p className={`mt-3 text-sm flex gap-2 ${msg.ok ? "text-success" : "text-danger"}`} data-testid="portal-message">{msg.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />}{msg.text}</p>}
        </Card>
        <Card className="p-5 sm:p-6">
          <form onSubmit={saveProfile} className="space-y-3">
            <p className="font-bold">{t.details}</p>
            <div className="grid sm:grid-cols-2 gap-3">{P("contact_name", t.contact)}{P("email", t.email, { type: "email" })}</div>
            <div className="grid sm:grid-cols-3 gap-3">{P("afm", t.afm, { "data-testid": "portal-afm" })}{P("doy", t.doy)}{P("country", t.country, { maxLength: 2 })}</div>
            <div className="grid sm:grid-cols-2 gap-3">{P("phone", t.phone)}{P("iban", t.iban, { placeholder: "GR..", "data-testid": "portal-iban" })}</div>
            {P("address", t.address)}
            {data.profile_issues.length > 0 && <ul className="text-xs text-warn space-y-0.5">{data.profile_issues.map((x) => <li key={x}>• {x}</li>)}</ul>}
            <div className="flex justify-end"><Button loading={busy} data-testid="portal-save">{t.save}</Button></div>
          </form>
        </Card>
        <Card className="p-5 sm:p-6 space-y-3">
          <div className="flex items-baseline justify-between gap-2"><p className="font-bold">{t.docs}</p><p className="text-[11px] text-muted">{t.files}</p></div>
          {data.requirements.map((r) => <DocRow key={r.key} req={r} token={token} latest={latest(r.key)} t={t} onUpdated={setData} />)}
        </Card>
        {data.supplier.status !== "approved" && (
          <Card className="p-5 sm:p-6">
            {missing.length > 0 && <p className="text-xs text-muted mb-3">{t.missing} {missing.join(", ")}</p>}
            <Button size="lg" className="w-full" disabled={busy || missing.length > 0 || data.profile_issues.length > 0} onClick={submit} data-testid="portal-submit">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{t.submit}
            </Button>
          </Card>
        )}
        <p className="text-[11px] text-muted text-center flex items-center justify-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" />{t.privacy} · {APP_NAME}</p>
      </div>
    </div>
  );
}
