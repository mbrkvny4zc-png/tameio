import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, CheckCircle2, FileCode2, FlaskConical, Radio, Send, XCircle } from "lucide-react";
import { api, download } from "@/lib/api";
import { money } from "@/lib/format";
import { Badge, Button, Field, Input, Modal, Select, Spinner } from "@/components/ui";
import { translate as tr } from "@/lib/i18n";

export const ENV_META = {
  simulation: { label: "Simulation", tone: "warn", icon: FlaskConical, hint: "Nothing is sent to AADE. MARKs are fake — use it to try the flow." },
  sandbox: { label: "AADE test", tone: "brand", icon: FlaskConical, hint: "Sent to AADE's test environment. Not legally valid." },
  production: { label: "Live", tone: "success", icon: Radio, hint: "Sent live to AADE myDATA. Invoices lock once they get a ΜΑΡΚ." },
};

export function MyDataBadge({ inv, onClick }) {
  const md = inv.mydata || {};
  let tone = "neutral", label = "Report";
  if (md.state === "transmitted") { tone = md.simulated ? "warn" : "success"; label = md.simulated ? "ΜΑΡΚ · sim" : "ΜΑΡΚ ✓"; }
  else if (md.state === "rejected") { tone = "danger"; label = "Rejected"; }
  else if (md.state === "cancelled") { tone = "neutral"; label = "Cancelled"; }
  else if (inv.status === "draft") return <span className="text-xs text-muted">—</span>; return (<button onClick={onClick} title={md.mark ? `ΜΑΡΚ ${md.mark}` : "Report to AADE myDATA"} data-testid={`mydata-badge-${inv.id}`}>
      <Badge tone={tone} className="hover:ring-2 hover:ring-brand/20 cursor-pointer">{label}</Badge>
    </button>
  );
}

export function MyDataDialog({ invoice, onClose, onChanged }) {
  const [codes, setCodes] = useState(null);
  const [settings, setSettings] = useState(null);
  const [form, setForm] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [serverErrors, setServerErrors] = useState([]);
  const [showXml, setShowXml] = useState(false);
  const md = invoice?.mydata || {};
  const isCredit = invoice?.kind === "credit_note";

  useEffect(() => {
    if (!invoice) return;
    setForm({
      invoice_type: md.invoice_type || (invoice.delivery ? "1.1" : "2.1"), payment_method: md.payment_method || 1, series: md.series || "",
      counterpart_vat: md.counterpart_vat || invoice.client_afm || "", counterpart_country: md.counterpart_country || invoice.client_country || "GR",
      counterpart_name: md.counterpart_name || invoice.client_company || invoice.client_name || "",
      counterpart_street: md.counterpart_street || invoice.client_address || "", counterpart_city: md.counterpart_city || invoice.client_city || "",
      counterpart_postal_code: md.counterpart_postal_code || invoice.client_postal_code || "", vat_exemption_category: md.vat_exemption_category || null,
      correlated_mark: md.correlated_mark || "",
    });
    setServerErrors([]); setShowXml(false); setPreview(null);
    Promise.all([api.get("/mydata/codes"), api.get("/mydata/settings")]).then(([c, s]) => { setCodes(c); setSettings(s); })
      .catch(() => toast.error(tr("Couldn't load myDATA settings")));
  }, [invoice?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const runPreview = useCallback(async () => {
    if (!form || !invoice || md.state === "transmitted") return;
    try { setPreview(await api.post(`/invoices/${invoice.id}/mydata/preview`, form)); } catch { setPreview(null); }
  }, [form, invoice, md.state]);
  useEffect(() => { const t = setTimeout(runPreview, 250); return () => clearTimeout(t); }, [runPreview]);

  if (!invoice) return null;
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const env = settings?.environment || "simulation";
  const E = ENV_META[env];
  const isRetail = codes?.retail_types?.includes(form?.invoice_type);
  const isForeign = codes?.foreign_types?.includes(form?.invoice_type);
  const transmitted = md.state === "transmitted";

  const submit = async () => {
    if (env === "production" && !window.confirm(`Send ${invoice.number} to AADE (live)? It will be locked once it gets a ΜΑΡΚ.`)) return;
    setBusy(true); setServerErrors([]);
    try {
      const r = await api.post(`/invoices/${invoice.id}/mydata/submit`, form);
      toast.success(`${r.mydata.simulated ? "Simulated " : ""}ΜΑΡΚ ${r.mydata.mark} received`);
      onChanged?.(r);
    } catch (e) {
      setServerErrors(e.details?.length ? e.details : [e.message]);
      onChanged?.();
    }
    setBusy(false);
  };
  const cancel = async () => {
    if (!window.confirm(`Cancel ΜΑΡΚ ${md.mark} at AADE? This can't be undone.`)) return;
    setBusy(true);
    try { onChanged?.(await api.post(`/invoices/${invoice.id}/mydata/cancel`)); toast.success(tr("Cancelled at AADE")); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Modal open={!!invoice} onClose={onClose} wide title={`myDATA · ${invoice.number}`}
      description={tr("Report this document to AADE and get its ΜΑΡΚ (Μοναδικός Αριθμός Καταχώρησης).")}>
      {!codes || !settings || !form ? <div className="py-10 flex justify-center"><Spinner /></div> : (
        <div className="space-y-4" data-testid="mydata-dialog">
          <div className={`flex items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-xs ${{ warn: "bg-warn/10 text-warn", brand: "bg-brand-soft text-brand", success: "bg-success/10 text-success" }[E.tone]}`}>
            <E.icon className="h-4 w-4 shrink-0 mt-px" /><div><b>{tr(E.label)}.</b> {tr(E.hint)}{!settings.vat_number_valid && <b className="block mt-1">{tr("Add your business ΑΦΜ in Settings first.")}</b>}</div>
          </div>

          {(transmitted || md.state === "cancelled") && (
            <div className="rounded-2xl border border-line p-4" data-testid="mydata-result">
              <p className="font-semibold flex items-center gap-2">
                {md.state === "cancelled" ? <Ban className="h-4 w-4 text-muted" /> : <CheckCircle2 className="h-4 w-4 text-success" />}
                {md.state === "cancelled" ? "Cancelled at AADE" : md.simulated ? "Simulated transmission" : "Reported to AADE"}
              </p>
              <dl className="mt-3 grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
                <dt className="text-muted">ΜΑΡΚ</dt><dd className="num font-mono" data-testid="mydata-mark">{md.mark}</dd>
                <dt className="text-muted">{tr("Series / No.")}</dt><dd className="font-mono">{md.series} / {md.aa}</dd>
                {md.uid && <><dt className="text-muted">{tr("UID")}</dt><dd className="font-mono truncate">{md.uid}</dd></>}
                {md.correlated_mark && <><dt className="text-muted">{tr("Corrects ΜΑΡΚ")}</dt><dd className="font-mono">{md.correlated_mark}</dd></>}
                {md.cancellation_mark && <><dt className="text-muted">{tr("Cancellation ΜΑΡΚ")}</dt><dd className="font-mono">{md.cancellation_mark}</dd></>}
              </dl>
              <div className="flex flex-wrap gap-2 mt-4">
                <Button size="sm" variant="secondary" onClick={() => download(`/invoices/${invoice.id}/mydata/xml`, `${invoice.number}-mydata.xml`).catch(() => toast.error(tr("No XML yet")))}><FileCode2 className="h-4 w-4" />{tr("XML")}</Button>
                {transmitted && <Button size="sm" variant="secondary" className="text-danger" onClick={cancel} loading={busy}><Ban className="h-4 w-4" />{tr("Cancel at AADE")}</Button>}
              </div>
            </div>
          )}

          {!transmitted && md.state !== "cancelled" && (
            <>
              {isCredit ? (
                <div className="rounded-xl bg-violet/10 text-violet px-3.5 py-2.5 text-xs" data-testid="mydata-credit-info">
                  <b>{tr("Credit note (type 5.1)")}</b> correcting {invoice.credit_of_number}, ΜΑΡΚ <span className="font-mono">{md.correlated_mark}</span>{tr(". Customer details come from that invoice.")}</div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-3">
                  <Field label={tr("Document type")}>
                    <Select value={form.invoice_type} onChange={(e) => set("invoice_type", e.target.value)} data-testid="mydata-type">
                      {codes.invoice_types.filter((t) => t.code !== "5.1").map((t) => <option key={t.code} value={t.code}>{t.code} · {t.label}</option>)}
                    </Select>
                  </Field>
                  {settings.series_list?.length > 1 && (
                    <Field label={tr("Series")}>
                      <Select value={form.series || settings.series} onChange={(e) => set("series", e.target.value)} data-testid="mydata-series">
                        {settings.series_list.map((x) => <option key={x.code} value={x.code}>{x.code}{x.label ? ` · ${x.label}` : ""}{x.branch ? ` · ${tr("branch")} ${x.branch}` : ""}</option>)}
                      </Select>
                    </Field>
                  )}
                  <Field label={tr("Payment method")}>
                    <Select value={form.payment_method} onChange={(e) => set("payment_method", parseInt(e.target.value, 10))}>
                      {codes.payment_methods.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
                    </Select>
                  </Field>
                </div>
              )}
              {!isRetail && !isCredit && (
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label={isForeign ? "Customer VAT no." : "Customer ΑΦΜ"}><Input value={form.counterpart_vat} onChange={(e) => set("counterpart_vat", e.target.value)} placeholder={isForeign ? "DE123456789" : "9 digits"} data-testid="mydata-vat" /></Field>
                  <Field label={tr("Country")}><Input value={form.counterpart_country} maxLength={2} onChange={(e) => set("counterpart_country", e.target.value.toUpperCase())} /></Field>
                  {isForeign && <>
                    <Field label={tr("Customer name")}><Input value={form.counterpart_name} onChange={(e) => set("counterpart_name", e.target.value)} /></Field>
                    <Field label={tr("Street")}><Input value={form.counterpart_street} onChange={(e) => set("counterpart_street", e.target.value)} /></Field>
                    <Field label={tr("City")}><Input value={form.counterpart_city} onChange={(e) => set("counterpart_city", e.target.value)} /></Field>
                    <Field label={tr("Postal code")}><Input value={form.counterpart_postal_code} onChange={(e) => set("counterpart_postal_code", e.target.value)} /></Field>
                  </>}
                </div>
              )}
              {Math.round(invoice.tax_rate || 0) === 0 && !isCredit && (
                <Field label={tr("VAT exemption category (AADE code)")} hint={tr("Required for 0% VAT — use the code for the legal basis of the exemption.")} className="max-w-xs">
                  <Input type="number" min={1} max={40} value={form.vat_exemption_category || ""} onChange={(e) => set("vat_exemption_category", e.target.value ? parseInt(e.target.value, 10) : null)} />
                </Field>
              )}

              {preview && (
                <div className="rounded-2xl border border-line p-4 text-sm" data-testid="mydata-preview">
                  <div className="flex justify-between text-muted"><span>{tr("Net")}</span><span className="num">{money(preview.totals.net)}</span></div>
                  <div className="flex justify-between text-muted"><span>VAT {invoice.tax_rate}%</span><span className="num">{money(preview.totals.vat)}</span></div>
                  <div className="flex justify-between font-bold mt-1"><span>{tr("Reported total")}</span><span className="num">{money(preview.totals.gross)}</span></div>
                  {preview.errors.length > 0 ? (
                    <ul className="mt-3 space-y-1.5" data-testid="mydata-errors">
                      {preview.errors.map((e) => <li key={e} className="flex gap-2 text-xs text-warn"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />{e}</li>)}
                    </ul>
                  ) : (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-xs text-success font-semibold"><CheckCircle2 className="h-3.5 w-3.5" />{tr("Passes all checks")}</span>
                      <button className="text-xs text-brand font-semibold" onClick={() => setShowXml(!showXml)}>{showXml ? "Hide" : "Show"} XML</button>
                    </div>
                  )}
                  {showXml && preview.xml && <pre className="mt-3 text-[10px] bg-surface-2 rounded-lg p-3 max-h-56 overflow-auto whitespace-pre-wrap break-all">{preview.xml.replace(/></g, ">\n<")}</pre>}
                </div>
              )}
              {serverErrors.length > 0 && (
                <ul className="rounded-2xl border border-danger/30 bg-danger/5 p-3.5 space-y-1">
                  {serverErrors.map((e) => <li key={e} className="flex gap-2 text-xs text-danger"><XCircle className="h-3.5 w-3.5 shrink-0 mt-px" />{e}</li>)}
                </ul>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={onClose}>{tr("Close")}</Button>
                <Button onClick={submit} loading={busy} disabled={!preview || preview.errors.length > 0} data-testid="mydata-submit">
                  <Send className="h-4 w-4" />{env === "simulation" ? "Simulate send" : env === "sandbox" ? "Send to AADE test" : "Send to AADE"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
