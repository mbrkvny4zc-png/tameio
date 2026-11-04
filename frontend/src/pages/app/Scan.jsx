import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AlertTriangle, Camera, CheckCircle2, FileText, Loader2, ScanLine, Sparkles, Upload, XCircle, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { money, relative, todayISO } from "@/lib/format";
import { Badge, Button, Card, Field, Input, PageHeader, Segmented, Select } from "@/components/ui";
import { ItemsEditor } from "@/components/ItemsEditor";
import { ExpenseForm } from "@/components/ExpenseForm";

const MAX_SIDE = 2200;

/** Shrink big phone photos before upload (faster, and under the AI's 5 MB image limit). */
async function prepare(file) {
  if (!file.type.startsWith("image/") || /hei[cf]/i.test(file.type)) return file;
  if (file.size < 1.2 * 1024 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

function Review({ job, categories, clients, onDone, onSkip }) {
  const s = job.scan.suggestion;
  const [target, setTarget] = useState(s.target);
  const [exp, setExp] = useState(s.expense_draft || {
    date: s.invoice_draft?.issue_date || todayISO(), vendor_name: "", vendor_afm: "", category: "other", description: "", net: 0, vat: 0, total: 0,
    payment_status: "paid", payment_method: "card", document_number: "", mark: "" });
  const [inv, setInv] = useState(s.invoice_draft ? { ...s.invoice_draft, items: s.invoice_draft.items.length ? s.invoice_draft.items : [{ description: "", qty: 1, unit_price: "" }] } : {
    client_id: null, client_name: "", client_afm: "", issue_date: exp.date, tax_rate: 24,
    items: [{ description: exp.description || "Services", qty: 1, unit_price: exp.net || "" }] });
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      if (target === "expense") {
        const body = { ...exp, net: parseFloat(exp.net) || 0, vat: parseFloat(exp.vat) || 0, total: parseFloat(exp.total) || 0, scan_id: job.scan.id };
        const r = await api.post("/expenses", body);
        toast.success(`Saved as ${r.number}`, { description: `${r.vendor_name} · ${money(r.total)}` });
      } else {
        const body = { ...inv, status: "draft", items: inv.items.filter((i) => i.description).map((i) => ({ description: i.description, qty: parseFloat(i.qty) || 0, unit_price: parseFloat(i.unit_price) || 0 })) };
        const r = await api.post("/invoices", body);
        await api.post(`/scans/${job.scan.id}/link-invoice/${r.id}`);
        toast.success(`Draft invoice ${r.number} created`, { description: "Review it in Invoices, then report it to myDATA." });
      }
      onDone();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };

  return (
    <Card className="p-0 overflow-hidden animate-in" data-testid="scan-review">
      <div className="grid lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="bg-surface-2 border-b lg:border-b-0 lg:border-r border-line p-4 flex items-center justify-center min-h-[260px]">
          {job.preview ? <img src={job.preview} alt="Scanned document" className="max-h-[560px] w-auto rounded-lg shadow-card object-contain" />
            : <div className="text-center text-muted"><FileText className="h-14 w-14 mx-auto" /><p className="text-sm mt-2">{job.file.name}</p></div>}
        </div>
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-brand" /><p className="font-bold">Check and save</p>
              <Badge tone={job.scan.extracted.confidence === "high" ? "success" : job.scan.extracted.confidence === "low" ? "danger" : "warn"}>{job.scan.extracted.confidence} confidence</Badge></div>
            <Segmented value={target} onChange={setTarget} options={[["expense", "Expense"], ["invoice", "Sales invoice"]]} />
          </div>
          {s.warnings.length > 0 && (
            <ul className="mb-4 rounded-xl bg-warn/10 px-3.5 py-3 space-y-1.5" data-testid="scan-warnings">
              {s.warnings.map((w) => <li key={w} className={`flex gap-2 text-xs ${w.startsWith("Possible duplicate") ? "text-danger font-semibold" : "text-warn"}`}>
                {w.startsWith("Possible duplicate") ? <Copy className="h-3.5 w-3.5 shrink-0 mt-px" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />}{w}</li>)}
            </ul>
          )}
          {job.scan.extracted.notes_for_user && <p className="text-xs text-muted mb-4">AI note: {job.scan.extracted.notes_for_user}</p>}
          {target === "expense" ? <ExpenseForm draft={exp} categories={categories} onChange={setExp} /> : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Client" className="col-span-2">
                  <Select value={inv.client_id || ""} onChange={(e) => setInv({ ...inv, client_id: e.target.value || null })}>
                    <option value="">— Use the name below —</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </Select>
                </Field>
                {!inv.client_id && <Field label="Client name"><Input value={inv.client_name} onChange={(e) => setInv({ ...inv, client_name: e.target.value })} /></Field>}
                {!inv.client_id && <Field label="Client ΑΦΜ"><Input value={inv.client_afm || ""} onChange={(e) => setInv({ ...inv, client_afm: e.target.value })} /></Field>}
                <Field label="Issue date"><Input type="date" value={inv.issue_date} onChange={(e) => setInv({ ...inv, issue_date: e.target.value })} /></Field>
              </div>
              <ItemsEditor items={inv.items} onChange={(items) => setInv({ ...inv, items })} taxRate={inv.tax_rate} onTaxRate={(tax_rate) => setInv({ ...inv, tax_rate })} />
            </div>
          )}
          <div className="flex justify-end gap-2 mt-6">
            <Button variant="ghost" onClick={onSkip}>Skip</Button>
            <Button onClick={save} loading={busy} data-testid="scan-save">{target === "expense" ? "Save expense" : "Create draft invoice"}</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function Scan() {
  const [queue, setQueue] = useState([]); // {id, file, preview, status: waiting|scanning|ready|failed|saved|skipped, scan, error}
  const [categories, setCategories] = useState([]);
  const [clients, setClients] = useState([]);
  const [recent, setRecent] = useState([]);
  const [drag, setDrag] = useState(false);
  const camRef = useRef(null), fileRef = useRef(null);
  const working = useRef(false);

  useEffect(() => {
    api.get("/expenses/categories").then(setCategories).catch(() => {});
    api.get("/clients").then(setClients).catch(() => {});
    api.get("/scans").then(setRecent).catch(() => {});
  }, []);

  const update = (id, patch) => setQueue((q) => q.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  // Process waiting jobs one at a time.
  useEffect(() => {
    const next = queue.find((j) => j.status === "waiting");
    if (!next || working.current) return;
    working.current = true;
    (async () => {
      update(next.id, { status: "scanning" });
      try {
        const fd = new FormData();
        fd.append("file", await prepare(next.file));
        const scan = await api.upload("/scans", fd);
        update(next.id, { status: "ready", scan });
      } catch (e) {
        update(next.id, { status: "failed", error: e.message });
      } finally {
        working.current = false;
        setQueue((q) => [...q]);
      }
    })();
  }, [queue]);

  const add = (files) => {
    const jobs = [...files].slice(0, 20).map((file) => ({
      id: crypto.randomUUID(), file, status: "waiting",
      preview: file.type.startsWith("image/") && !/hei[cf]/i.test(file.type) ? URL.createObjectURL(file) : null,
    }));
    if (jobs.length) setQueue((q) => [...q, ...jobs]);
  };
  const current = queue.find((j) => j.status === "ready");
  const finish = (job, status) => { update(job.id, { status }); api.get("/scans").then(setRecent).catch(() => {}); };

  return (
    <div className="animate-in">
      <PageHeader title="Scan" subtitle="Photograph or upload receipts and invoices — AI fills in the details, you check and save." />

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={`relative card border-2 border-dashed transition-colors px-6 py-10 sm:py-14 text-center ${drag ? "border-brand bg-brand-soft" : "border-line"}`}
        data-testid="dropzone">
        <div className="mx-auto h-16 w-16 rounded-3xl bg-gradient-to-br from-brand to-violet text-white flex items-center justify-center shadow-lift"><ScanLine className="h-7 w-7" /></div>
        <p className="mt-5 text-lg font-bold">Drop receipts or invoices here</p>
        <p className="text-sm text-muted mt-1">Photos (JPG, PNG, WebP) or PDFs · several at once is fine</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button size="lg" onClick={() => camRef.current?.click()}><Camera className="h-5 w-5" />Take photo</Button>
          <Button size="lg" variant="secondary" onClick={() => fileRef.current?.click()}><Upload className="h-5 w-5" />Upload files</Button>
        </div>
        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ""; }} data-testid="scan-input" />
        <p className="text-[11px] text-muted mt-6">Tips: flat surface, good light, the whole receipt in frame. Nothing is saved until you confirm.</p>
      </div>

      {queue.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2" data-testid="scan-queue">
          {queue.map((j) => (
            <div key={j.id} className="card px-3 py-2 flex items-center gap-2 text-xs max-w-[240px]">
              {j.status === "scanning" || j.status === "waiting" ? <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                : j.status === "failed" ? <XCircle className="h-3.5 w-3.5 text-danger" />
                : j.status === "ready" ? <Sparkles className="h-3.5 w-3.5 text-brand" /> : <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
              <span className="truncate">{j.file.name}</span>
              <span className="text-muted shrink-0">{{ waiting: "queued", scanning: "reading…", ready: "review", failed: "failed", saved: "saved", skipped: "skipped" }[j.status]}</span>
            </div>
          ))}
        </div>
      )}
      {queue.filter((j) => j.status === "failed").map((j) => (
        <div key={j.id} className="mt-3 rounded-xl bg-danger/10 text-danger text-sm px-4 py-3 flex items-start gap-2" role="alert">
          <XCircle className="h-4 w-4 shrink-0 mt-0.5" /><span><b>{j.file.name}:</b> {j.error}</span>
        </div>
      ))}
      {queue.some((j) => j.status === "scanning") && !current && (
        <Card className="mt-6 p-8 text-center">
          <div className="relative mx-auto h-24 w-20 rounded-lg border border-line bg-surface-2 overflow-hidden">
            <div className="absolute inset-x-0 h-0.5 bg-brand shadow-[0_0_14px_hsl(var(--brand))] animate-[scan_1.6s_ease-in-out_infinite]" />
          </div>
          <p className="mt-4 font-semibold">Reading your document…</p>
          <p className="text-sm text-muted">Finding the vendor, ΑΦΜ, VAT and totals. This takes a few seconds.</p>
          <style>{"@keyframes scan{0%{top:6%}50%{top:90%}100%{top:6%}}"}</style>
        </Card>
      )}

      {current && (
        <div className="mt-6">
          <Review key={current.id} job={current} categories={categories} clients={clients} onDone={() => finish(current, "saved")} onSkip={() => finish(current, "skipped")} />
        </div>
      )}

      {recent.length > 0 && (
        <div className="mt-10">
          <p className="font-bold mb-3">Recent scans</p>
          <div className="card divide-y divide-line">
            {recent.slice(0, 8).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                {r.status === "failed" ? <XCircle className="h-4 w-4 text-danger" /> : r.used_for ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Sparkles className="h-4 w-4 text-muted" />}
                <span className="flex-1 truncate">{r.extracted?.issuer_name || r.file?.filename}</span>
                {r.extracted?.total_amount != null && <span className="num font-semibold">{money(r.extracted.total_amount)}</span>}
                {r.used_for ? <Link to={r.used_for.type === "expense" ? "/app/expenses" : "/app/invoices"} className="text-xs font-semibold text-brand">{r.used_for.number}</Link>
                  : <span className="text-xs text-muted">{r.status === "failed" ? "failed" : "not saved"}</span>}
                <span className="text-[11px] text-muted w-20 text-right hidden sm:block">{relative(r.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
