import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Banknote, CalendarClock, Check, Download, Link2, Mail, Plus, RefreshCw, Search, Settings2, ShieldAlert, ShieldCheck, ShieldX, Trash2, Truck, Upload, X,
} from "lucide-react";
import { api, download } from "@/lib/api";
import { CommentButton, useCommentCounts } from "@/components/Comments";
import { Badge, Button, Card, Empty, Field, IconBtn, Input, Modal, PageHeader, PageLoader, Segmented, Sheet, Table, Textarea } from "@/components/ui";
import { translate as tr } from "@/lib/i18n";
import { AfmInput } from "@/components/Extras";

export const VERDICT = {
  compliant: ["Compliant", "success", ShieldCheck], attention: ["Needs attention", "warn", ShieldAlert], blocked: ["Blocked", "danger", ShieldX],
};
export const ITEM = {
  valid: ["Valid", "success"], expiring: ["Expiring soon", "warn"], expired: ["Expired", "danger"], pending_review: ["Awaiting review", "brand"],
  rejected: ["Rejected", "danger"], missing: ["Missing", "neutral"],
};
const STATUS = { invited: "Invited", submitted: "Submitted", approved: "Approved", rejected: "Rejected", suspended: "Suspended" };
const EMPTY = { name: "", email: "", contact_name: "", phone: "", afm: "", doy: "", country: "GR", address: "", iban: "", category: "", notes: "" };

function Verdict({ v }) { const [l, t, I] = VERDICT[v] || VERDICT.blocked; return <Badge tone={t}><I className="h-3 w-3" />{tr(l)}</Badge>; }

function Requirements({ open, onClose, onSaved }) {
  const [items, setItems] = useState(null);
  useEffect(() => { if (open) api.get("/suppliers/requirements").then(setItems).catch(() => setItems([])); }, [open]);
  const set = (i, k, v) => setItems(items.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async () => { try { await api.put("/suppliers/requirements", { items }); toast.success(tr("Saved")); onSaved(); onClose(); } catch (e) { toast.error(e.message); } };
  return (
    <Modal open={open} onClose={onClose} wide title={tr("Documents you require")} description={tr("Every new supplier is asked for these. Expiring documents are tracked and renewal reminders go out automatically.")}
      footer={<><Button variant="secondary" onClick={() => setItems([...(items || []), { key: "", label: "", required: true, has_expiry: false, help: "" }])}><Plus className="h-4 w-4" />{tr("Add")}</Button><Button onClick={save}>{tr("Save")}</Button></>}>
      {!items ? <PageLoader /> : (
        <div className="space-y-2">
          {items.map((r, i) => (
            <div key={r.key || i} className="rounded-xl border border-line p-3 space-y-2">
              <div className="flex gap-2"><Input value={r.label} onChange={(e) => set(i, "label", e.target.value)} placeholder={tr("Document name")} />
                <IconBtn icon={Trash2} label={tr("Remove")} tone="danger" onClick={() => setItems(items.filter((_, j) => j !== i))} /></div>
              <Input className="h-8 text-xs" value={r.help || ""} onChange={(e) => set(i, "help", e.target.value)} placeholder={tr("Instructions for the supplier (optional)")} />
              <div className="flex gap-5 text-xs font-medium">
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[hsl(var(--brand))] h-4 w-4" checked={r.required} onChange={(e) => set(i, "required", e.target.checked)} />{tr("Required")}</label>
                <label className="flex items-center gap-2"><input type="checkbox" className="accent-[hsl(var(--brand))] h-4 w-4" checked={r.has_expiry} onChange={(e) => set(i, "has_expiry", e.target.checked)} />{tr("Has an expiry date")}</label>
              </div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

function StaffUpload({ supplier, item, onDone }) {
  const [file, setFile] = useState(null);
  const [exp, setExp] = useState("");
  const [busy, setBusy] = useState(false);
  const go = async () => {
    const fd = new FormData(); fd.append("requirement_key", item.key); fd.append("file", file);
    if (item.has_expiry) fd.append("expiry_date", exp);
    setBusy(true);
    try { onDone(await api.upload(`/suppliers/${supplier.id}/documents`, fd)); toast.success(tr("Added")); } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="flex flex-wrap gap-2 mt-2.5">
      <Input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx" className="h-9 text-xs max-w-[230px] py-1.5" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      {item.has_expiry && <Input type="date" className="h-9 w-40 text-xs" value={exp} onChange={(e) => setExp(e.target.value)} />}
      <Button size="sm" variant="secondary" className="h-9" disabled={!file || (item.has_expiry && !exp)} loading={busy} onClick={go}><Upload className="h-3.5 w-3.5" />{tr("Add")}</Button>
    </div>
  );
}

function SupplierSheet({ supplier, onClose, onChanged, onDeleted }) {
  const [form, setForm] = useState(null);
  const [pay, setPay] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const [uploadFor, setUploadFor] = useState(null);
  useEffect(() => { if (supplier) { setForm({ ...EMPTY, ...supplier }); setPay(null); setRejecting(null); setUploadFor(null); } }, [supplier?.id]); // eslint-disable-line
  if (!supplier || !form) return null;
  const isNew = !supplier.id;
  const comp = supplier.compliance;

  const save = async () => {
    const body = Object.fromEntries(Object.keys(EMPTY).map((k) => [k, form[k] || ""]));
    try { const r = isNew ? await api.post("/suppliers", body) : await api.put(`/suppliers/${supplier.id}`, body); toast.success(isNew ? "Supplier added — send them their onboarding link" : "Saved"); onChanged(r); }
    catch (e) { toast.error(e.message); }
  };
  const copy = async () => { const r = await api.get(`/suppliers/${supplier.id}/link`); await navigator.clipboard?.writeText(r.portal_url); toast.success(tr("Onboarding link copied")); };
  const invite = async () => {
    try { const r = await api.post(`/suppliers/${supplier.id}/invite`); if (r.emailed) toast.success(`Invitation sent to ${supplier.email}`); else { await navigator.clipboard?.writeText(r.portal_url).catch(() => {}); toast.message(tr("Email isn't set up — link copied instead")); } }
    catch (e) { toast.error(e.message); }
  };
  const rotate = async () => { if (!window.confirm(tr("Create a new link? The old one stops working."))) return; const r = await api.post(`/suppliers/${supplier.id}/rotate-link`); await navigator.clipboard?.writeText(r.portal_url).catch(() => {}); toast.success(tr("New link copied")); };
  const setStatus = async (status, force = false) => {
    try { onChanged(await api.put(`/suppliers/${supplier.id}/status`, { status, force })); toast.success(`Supplier ${STATUS[status].toLowerCase()}`); }
    catch (e) {
      if (status === "approved" && e.status === 409 && window.confirm(`${e.message}:\n\n• ${e.details.join("\n• ")}\n\nApprove anyway?`)) return setStatus(status, true);
      if (e.status !== 409) toast.error(e.message);
    }
  };
  const review = async (doc, status, note = "") => {
    try { onChanged(await api.put(`/suppliers/${supplier.id}/documents/${doc.id}/review`, { status, note })); setRejecting(null); }
    catch (e) { toast.error(e.message); }
  };
  const remove = async () => { if (window.confirm(`Delete ${supplier.name} and their documents?`)) { await api.del(`/suppliers/${supplier.id}`); onDeleted(); } };
  const docs = (key) => (supplier.documents || []).filter((d) => d.requirement_key === key).sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));
  const F = (k, label, p = {}) => <Field label={label}><Input value={form[k] || ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...p} /></Field>; return (<Sheet open onClose={onClose} title={isNew ? "New supplier" : supplier.name} description={isNew ? "Add the basics — the supplier completes the rest through their private link." : `${tr(STATUS[supplier.status])} · ${comp.progress.done}/${comp.progress.total} documents`}
      footer={<>{!isNew && <Button variant="ghost" className="text-danger mr-auto" onClick={remove}><Trash2 className="h-4 w-4" />{tr("Delete")}</Button>}<Button variant="secondary" onClick={onClose}>{tr("Close")}</Button><Button onClick={save} data-testid="supplier-save">{isNew ? "Add supplier" : "Save details"}</Button></>}>
      {!isNew && (
        <>
          <div className="flex flex-wrap items-center gap-2"><Verdict v={comp.verdict} />
            <div className="ml-auto flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={copy}><Link2 className="h-3.5 w-3.5" />{tr("Copy link")}</Button>
              <Button size="sm" variant="secondary" onClick={invite}><Mail className="h-3.5 w-3.5" />{tr("Email invite")}</Button>
              <Button size="sm" variant="soft" onClick={async () => setPay(await api.get(`/suppliers/${supplier.id}/payment-check`))} data-testid="pay-check"><Banknote className="h-3.5 w-3.5" />{tr("Can I pay them?")}</Button>
              <IconBtn icon={RefreshCw} label={tr("New link (old one stops working)")} onClick={rotate} />
            </div>
          </div>
          {pay && (
            <div className={`mt-4 rounded-2xl p-4 text-sm ${pay.can_pay ? "bg-success/10" : "bg-danger/10"}`} data-testid="pay-result">
              <p className={`font-bold flex items-center gap-2 ${pay.can_pay ? "text-success" : "text-danger"}`}>{pay.can_pay ? <><ShieldCheck className="h-4 w-4" />{tr("OK to pay")}</> : <><ShieldX className="h-4 w-4" />{tr("Don't pay yet")}</>}</p>
              {pay.can_pay && <p className="text-xs mt-1">{tr("Pay only to IBAN")} <span className="font-mono">{pay.iban}</span></p>}
              {[...pay.reasons, ...pay.warnings].map((r) => <p key={r} className="text-xs mt-1">• {r}</p>)}
            </div>
          )}
          {supplier.iban_changed_at && <p className="mt-4 text-xs rounded-xl bg-warn/10 text-warn px-3 py-2">The supplier changed their IBAN on {new Date(supplier.iban_changed_at).toLocaleDateString()}. Confirm it by phone, on a number you already had, before paying.</p>}
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mt-6 mb-2">{tr("Documents")}</p>
          <div className="space-y-2">
            {comp.items.map((it) => {
              const [l, t] = ITEM[it.state];
              return (
                <div key={it.key} className="rounded-xl border border-line p-3.5" data-testid={`req-${it.key}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="text-sm font-medium">{it.label}{!it.required && <span className="text-[11px] text-muted"> {tr("· optional")}</span>}</p>
                      {it.expiry_date && <p className="text-[11px] text-muted flex items-center gap-1 mt-0.5"><CalendarClock className="h-3 w-3" />Expires {it.expiry_date}{it.days_left != null && ` · ${it.days_left < 0 ? `${-it.days_left} days ago` : `in ${it.days_left} days`}`}</p>}</div>
                    <div className="flex items-center gap-1 shrink-0"><Badge tone={t}>{tr(l)}</Badge><IconBtn icon={Upload} label={tr("Upload on their behalf")} onClick={() => setUploadFor(uploadFor === it.key ? null : it.key)} /></div>
                  </div>
                  {uploadFor === it.key && <StaffUpload supplier={supplier} item={it} onDone={(s) => { setUploadFor(null); onChanged(s); }} />}
                  {docs(it.key).slice(0, 3).map((d) => (
                    <div key={d.id} className="flex items-center gap-2 mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                      <button className="flex-1 min-w-0 truncate text-left hover:underline flex items-center gap-1.5" onClick={() => download(`/suppliers/${supplier.id}/documents/${d.id}/file`, d.filename)}><Download className="h-3 w-3 shrink-0" />{d.filename}</button>
                      <span className="text-muted shrink-0">{d.status}{d.expiry_date ? ` · ${d.expiry_date}` : ""}</span>
                      {d.status === "pending" && <>
                        <button onClick={() => review(d, "approved")} className="p-1 rounded text-success hover:bg-success/10" title={tr("Approve")} data-testid={`approve-${d.id}`}><Check className="h-3.5 w-3.5" /></button>
                        <button onClick={() => setRejecting({ doc: d, note: "" })} className="p-1 rounded text-danger hover:bg-danger/10" title={tr("Reject")}><X className="h-3.5 w-3.5" /></button>
                      </>}
                    </div>
                  ))}
                  {rejecting && docs(it.key).some((d) => d.id === rejecting.doc.id) && (<div className="flex gap-2 mt-2"><Input autoFocus className="h-9 text-xs" placeholder={tr("Reason — sent to the supplier")} value={rejecting.note} onChange={(e) => setRejecting({ ...rejecting, note: e.target.value })} />
                      <Button size="sm" variant="danger" className="h-9" disabled={!rejecting.note.trim()} onClick={() => review(rejecting.doc, "rejected", rejecting.note)}>{tr("Reject")}</Button></div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            {supplier.status !== "approved" && <Button size="sm" onClick={() => setStatus("approved")} data-testid="approve-supplier"><ShieldCheck className="h-4 w-4" />{tr("Approve supplier")}</Button>}
            {supplier.status !== "suspended" ? <Button size="sm" variant="secondary" onClick={() => setStatus("suspended")}>{tr("Suspend")}</Button> : <Button size="sm" variant="secondary" onClick={() => setStatus("submitted")}>{tr("Reactivate")}</Button>}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted mt-8 mb-3">{tr("Company details")}</p>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label={tr("ΑΦΜ")}><AfmInput value={form.afm} country={form.country} onChange={(v) => setForm((x) => ({ ...x, afm: v }))}
          onFound={(r) => setForm((x) => ({ ...x, name: x.name || r.name, address: x.address || [r.address, r.postal_code, r.city].filter(Boolean).join(", "), doy: r.doy || x.doy }))} /></Field>{F("doy", tr("ΔΟΥ"))}
        <div className="col-span-2">{F("name", tr("Company name"), { "data-testid": "supplier-name" })}</div>
        {F("contact_name", "Contact person")}{F("email", "Email", { type: "email" })}
        {F("phone", "Phone")}{F("category", "Category", { placeholder: "e.g. Materials" })}
        <div className="col-span-2">{F("iban", "IBAN")}</div>
        <div className="col-span-2">{F("address", "Address")}</div>
        <div className="col-span-2"><Field label={tr("Internal notes")}><Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field></div>
      </div>
    </Sheet>
  );
}

export default function Suppliers() {
  const commentCounts = useCommentCounts("supplier");
  const [params] = useSearchParams();
  const [list, setList] = useState(null);
  const [renewals, setRenewals] = useState([]);
  const [selected, setSelected] = useState(null);
  const [reqOpen, setReqOpen] = useState(false);
  const [filter, setFilter] = useState(params.get("filter") || "all");
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    const [s, r] = await Promise.all([api.get("/suppliers"), api.get("/suppliers/renewals?days=60")]);
    setList(s); setRenewals(r); return s;
  }, []);
  useEffect(() => { load().then((s) => { const id = params.get("open"); if (id) setSelected(s.find((x) => x.id === id) || null); }).catch(() => setList([])); }, [load]); // eslint-disable-line
  const counts = useMemo(() => (list || []).reduce((a, s) => ({ ...a, [s.compliance.verdict]: (a[s.compliance.verdict] || 0) + 1 }), {}), [list]);
  const shown = (list || []).filter((s) => (filter === "all" || s.compliance.verdict === filter) && (!q || `${s.name} ${s.afm} ${s.category}`.toLowerCase().includes(q.toLowerCase())));
  const changed = async (u) => { const l = await load(); setSelected(l.find((x) => x.id === u.id) || u); };

  if (!list) return <PageLoader />; return (<div className="animate-in">
      <PageHeader title={tr("Suppliers")} subtitle={tr("Collect clearances, contracts and bank details — and know who's safe to pay.")}
        actions={<><Button variant="secondary" onClick={() => setReqOpen(true)}><Settings2 className="h-4 w-4" />{tr("Required documents")}</Button><Button onClick={() => setSelected({ ...EMPTY })} data-testid="new-supplier"><Plus className="h-4 w-4" />{tr("Add supplier")}</Button></>} />
      {renewals.length > 0 && (
        <Card className="p-4 sm:p-5 mb-5">
          <p className="font-bold text-sm flex items-center gap-2 mb-3"><CalendarClock className="h-4 w-4 text-warn" />{tr("Renewals in the next 60 days")}</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {renewals.slice(0, 12).map((r) => (
              <button key={r.supplier_id + r.requirement} onClick={() => setSelected(list.find((s) => s.id === r.supplier_id))}
                className={`shrink-0 text-left rounded-xl border px-3 py-2 text-xs hover:border-brand/40 ${r.days_left < 0 ? "border-danger/40 bg-danger/5" : r.days_left <= 7 ? "border-warn/40 bg-warn/5" : "border-line"}`}>
                <p className="font-semibold">{r.supplier_name}</p><p className="text-muted max-w-[200px] truncate">{r.requirement}</p>
                <p className={`font-semibold ${r.days_left < 0 ? "text-danger" : "text-warn"}`}>{r.days_left < 0 ? `Expired ${-r.days_left}d ago` : r.days_left === 0 ? "Expires today" : `${r.days_left} days left`}</p>
              </button>
            ))}
          </div>
        </Card>
      )}
      {list.length === 0 ? (
        <Empty icon={Truck} title={tr("No suppliers yet")} text={tr("Add a supplier and send them a private link. They upload their tax and social security clearances, ΓΕΜΗ certificate, contract and IBAN; you approve.")}
          action={<Button onClick={() => setSelected({ ...EMPTY })}><Plus className="h-4 w-4" />{tr("Add supplier")}</Button>} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 justify-between mb-4">
            <Segmented value={filter} onChange={setFilter} options={[["all", `All ${list.length}`], ["blocked", `Blocked ${counts.blocked || 0}`], ["attention", `Attention ${counts.attention || 0}`], ["compliant", `Compliant ${counts.compliant || 0}`]]} />
            <div className="relative sm:w-64"><Search className="h-4 w-4 absolute left-3 top-3 text-muted" /><Input className="pl-9" placeholder={tr("Name or ΑΦΜ")} value={q} onChange={(e) => setQ(e.target.value)} /></div>
          </div>
          <Table head={["Supplier", { label: "ΑΦΜ", className: "hidden md:table-cell" }, "Status", "Compliance", { label: "Next expiry", className: "hidden lg:table-cell" }, ""]}>
            {shown.map((s) => (
              <tr key={s.id} onClick={() => setSelected(s)} className="hover:bg-surface-2/50 cursor-pointer" data-testid={`supplier-row-${s.id}`}>
                <td className="td"><p className="font-medium">{s.name}</p><p className="text-[11px] text-muted">{[s.category, s.contact_name].filter(Boolean).join(" · ")}</p></td>
                <td className="td font-mono text-xs hidden md:table-cell">{s.afm || "—"}</td>
                <td className="td text-sm">{tr(STATUS[s.status])}</td>
                <td className="td"><div className="flex items-center gap-2"><Verdict v={s.compliance.verdict} /><span className="text-[11px] text-muted">{s.compliance.progress.done}/{s.compliance.progress.total}</span></div>
                  {s.compliance.blocking[0] && <p className="text-[11px] text-muted mt-1 truncate max-w-[260px]">{s.compliance.blocking[0]}</p>}</td>
                <td className="td text-muted hidden lg:table-cell">{s.compliance.next_expiry || "—"}</td>
                <td className="td" onClick={(e) => e.stopPropagation()}><CommentButton type="supplier" id={s.id} label={s.name} count={commentCounts[s.id]} /></td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {selected && <SupplierSheet supplier={selected} onClose={() => setSelected(null)} onChanged={changed} onDeleted={() => { setSelected(null); load(); }} />}
      <Requirements open={reqOpen} onClose={() => setReqOpen(false)} onSaved={load} />
    </div>
  );
}
