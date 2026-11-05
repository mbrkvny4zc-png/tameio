import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, Link2, PackageCheck, Pencil, Plus, Printer, Send, Trash2, Truck, XCircle } from "lucide-react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { CommentButton, useCommentCounts } from "@/components/Comments";
import { date, todayISO } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { AfmInput, RowMenu } from "@/components/Extras";
import { useProducts } from "@/components/ItemsEditor";
import { Badge, Button, Empty, Field, IconBtn, Input, PageHeader, PageLoader, Segmented, Select, Sheet, Table, Textarea } from "@/components/ui";

const STATUS = { draft: ["Draft", "neutral"], issuing: ["Sending…", "brand"], issued: ["In transit", "brand"], delivered: ["Delivered", "success"], cancelled: ["Cancelled", "danger"] };
const ADDR = { street: "", number: "", postal_code: "", city: "" };

function blank(biz) {
  return { move_purpose: 1, other_purpose: "", client_id: null, recipient_name: "", recipient_afm: "",
    loading_address: { ...ADDR, street: biz?.address || "", postal_code: biz?.postal_code || "", city: biz?.city || "" }, delivery_address: { ...ADDR },
    dispatch_date: todayISO(), dispatch_time: new Date().toTimeString().slice(0, 5), vehicle_number: "", items: [{ description: "", qty: 1, unit: 1, code: "" }], notes: "" };
}

function AddressFields({ label, value, onChange, testid }) {
  const { t } = useT();
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value });
  return (
    <fieldset className="space-y-2">
      <legend className="label">{label}</legend>
      <div className="grid grid-cols-[1fr_84px] gap-2"><Input placeholder={t("Street")} value={value.street} onChange={set("street")} data-testid={testid} /><Input placeholder={t("No.")} value={value.number} onChange={set("number")} /></div>
      <div className="grid grid-cols-[110px_1fr] gap-2"><Input placeholder={t("Postcode")} value={value.postal_code} onChange={set("postal_code")} inputMode="numeric" /><Input placeholder={t("City")} value={value.city} onChange={set("city")} /></div>
    </fieldset>
  );
}

function NoteEditor({ value, meta, clients, onClose, onSaved }) {
  const { t } = useT();
  const products = useProducts();
  const [f, setF] = useState(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setF(value), [value]);
  if (!f) return null;
  const own = Number(f.move_purpose) === 8;
  const setItem = (i, k, v) => setF({ ...f, items: f.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });
  const pickClient = (id) => {
    const c = clients.find((x) => x.id === id);
    setF({ ...f, client_id: id || null, ...(c ? { recipient_name: c.company || c.name, recipient_afm: c.afm || "",
      delivery_address: { ...ADDR, street: c.address || "", postal_code: c.postal_code || "", city: c.city || "" } } : {}) });
  };
  const save = async (thenIssue) => {
    setBusy(true);
    try {
      const body = { ...f, move_purpose: Number(f.move_purpose), items: f.items.filter((i) => i.description.trim()).map((i) => ({ ...i, qty: parseFloat(i.qty) || 0, unit: Number(i.unit) })) };
      let n = f.id ? await api.put(`/delivery-notes/${f.id}`, body) : await api.post("/delivery-notes", body);
      if (thenIssue) {
        try { n = await api.post(`/delivery-notes/${n.id}/issue`); toast.success(t("{n} issued · ΜΑΡΚ {m}", { n: n.number, m: n.mydata.mark })); }
        catch (e) { toast.error(e.message); onSaved(n, true); setBusy(false); return; }
      } else toast.success(t("Saved"));
      onSaved(n);
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Sheet open onClose={onClose} title={f.id ? f.number : t("New delivery note")} description={t("Goes to myDATA and gets a ΜΑΡΚ + QR that travels with the goods.")} width="max-w-2xl"
      footer={<><Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button><Button variant="secondary" onClick={() => save(false)} loading={busy}>{t("Save draft")}</Button>
        <Button onClick={() => save(true)} loading={busy} data-testid="dn-issue"><Send className="h-4 w-4" />{t("Issue to myDATA")}</Button></>}>
      <div className="space-y-6" data-testid="dn-editor">
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label={t("Why are the goods moving?")}>
            <Select value={f.move_purpose} onChange={(e) => setF({ ...f, move_purpose: Number(e.target.value) })} data-testid="dn-purpose">
              {Object.entries(meta.purposes).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
            </Select>
          </Field>
          {Number(f.move_purpose) === 19 && <Field label={t("Describe the purpose")}><Input value={f.other_purpose} onChange={(e) => setF({ ...f, other_purpose: e.target.value })} /></Field>}
        </div>
        {!own && (
          <div className="grid sm:grid-cols-2 gap-3">
            {clients.length > 0 && (
              <Field label={t("Recipient")} className="sm:col-span-2">
                <Select value={f.client_id || ""} onChange={(e) => pickClient(e.target.value)}>
                  <option value="">— {t("Type the details below")} —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.afm ? ` · ${c.afm}` : ""}</option>)}
                </Select>
              </Field>
            )}
            <Field label={t("Recipient ΑΦΜ")}><AfmInput value={f.recipient_afm} onChange={(v) => setF((x) => ({ ...x, recipient_afm: v }))} data-testid="dn-afm"
              onFound={(r) => setF((x) => ({ ...x, recipient_name: x.recipient_name || r.name, delivery_address: x.delivery_address.street ? x.delivery_address : { ...ADDR, street: r.address, postal_code: r.postal_code, city: r.city } }))} /></Field>
            <Field label={t("Recipient name")}><Input value={f.recipient_name} onChange={(e) => setF({ ...f, recipient_name: e.target.value })} /></Field>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-5">
          <AddressFields label={t("Loading from")} value={f.loading_address} onChange={(v) => setF({ ...f, loading_address: v })} />
          <AddressFields label={t("Delivering to")} value={f.delivery_address} onChange={(v) => setF({ ...f, delivery_address: v })} testid="dn-delivery-street" />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label={t("Dispatch date")}><Input type="date" value={f.dispatch_date} onChange={(e) => setF({ ...f, dispatch_date: e.target.value })} /></Field>
          <Field label={t("Time")}><Input type="time" value={f.dispatch_time} onChange={(e) => setF({ ...f, dispatch_time: e.target.value })} /></Field>
          <Field label={t("Vehicle plate")}><Input value={f.vehicle_number} onChange={(e) => setF({ ...f, vehicle_number: e.target.value.toUpperCase() })} placeholder="ΙΚΧ-1234" /></Field>
        </div>
        <div>
          <p className="label">{t("Goods")}</p>
          <div className="space-y-2">
            {f.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[1fr_76px_88px_32px] gap-2">
                <Input value={it.description} onChange={(e) => setItem(i, "description", e.target.value)} placeholder={t("What is being moved?")} list="dn-products" data-testid={`dn-item-${i}`} />
                <Input type="number" min="0" step="any" className="text-right num" value={it.qty} onChange={(e) => setItem(i, "qty", e.target.value)} aria-label={t("Quantity")} />
                <Select value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} aria-label={t("Unit")}>{Object.entries(meta.units).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}</Select>
                <IconBtn icon={Trash2} label={t("Remove line")} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== i) })} disabled={f.items.length === 1} />
              </div>
            ))}
          </div>
          <datalist id="dn-products">{products.map((p) => <option key={p.id} value={p.name} />)}</datalist>
          <Button variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setF({ ...f, items: [...f.items, { description: "", qty: 1, unit: 1, code: "" }] })}><Plus className="h-4 w-4" />{t("Add line")}</Button>
        </div>
        <Field label={t("Notes")}><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Sheet>
  );
}

async function printNote(n, biz, meta) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const md = n.mydata || {};
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const qrTarget = md.qr_url || (n.public_token ? `${location.origin}/d/${n.public_token}` : "");
  const qr = qrTarget ? await QRCode.toDataURL(qrTarget, { margin: 1, width: 200 }).catch(() => "") : "";
  const a = (x) => esc([x.street, x.number].filter(Boolean).join(" ") + ", " + [x.postal_code, x.city].filter(Boolean).join(" "));
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(n.number)}</title><style>
  @page{size:A4;margin:16mm} body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f1a14}
  h1{font-size:20px;margin:0} .muted{color:#6b6257} table{width:100%;border-collapse:collapse;margin-top:16px} th,td{padding:7px 6px;border-bottom:1px solid #e5dccb;text-align:left}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px} .box{border:1px solid #e5dccb;border-radius:8px;padding:10px} .r{text-align:right}
  .mark{display:flex;gap:14px;align-items:center;margin-top:20px;border-top:2px solid #1f1a14;padding-top:12px}
  </style></head><body>
  <div style="display:flex;justify-content:space-between"><div><h1>ΔΕΛΤΙΟ ΑΠΟΣΤΟΛΗΣ <span class="muted" style="font-weight:400">· Delivery note</span></h1>
  <p class="muted">${esc(biz.business_name)} · ΑΦΜ ${esc(biz.afm)}${biz.doy ? ` · ΔΟΥ ${esc(biz.doy)}` : ""}</p></div>
  <div class="r"><b>${esc(n.number)}</b><br>${esc(n.dispatch_date)} ${esc(n.dispatch_time || "")}${n.vehicle_number ? `<br>Όχημα ${esc(n.vehicle_number)}` : ""}</div></div>
  <p><b>Σκοπός διακίνησης:</b> ${esc(meta.purposes[n.move_purpose] || "")}${n.other_purpose ? ` — ${esc(n.other_purpose)}` : ""}</p>
  <div class="grid"><div class="box"><b>Φόρτωση</b><br>${a(n.loading_address)}</div><div class="box"><b>Παράδοση</b><br>${n.recipient_name ? `${esc(n.recipient_name)}${n.recipient_afm ? ` · ΑΦΜ ${esc(n.recipient_afm)}` : ""}<br>` : ""}${a(n.delivery_address)}</div></div>
  <table><tr><th>#</th><th>Περιγραφή</th><th class="r">Ποσότητα</th><th>Μ.Μ.</th></tr>
  ${n.items.map((i, k) => `<tr><td>${k + 1}</td><td>${esc(i.description)}</td><td class="r">${esc(i.qty)}</td><td>${esc(meta.units[i.unit] || "")}</td></tr>`).join("")}</table>
  ${n.notes ? `<p class="muted">${esc(n.notes)}</p>` : ""}
  ${md.mark ? `<div class="mark">${qr ? `<img src="${qr}" width="100" height="100">` : ""}<div><b>ΜΑΡΚ</b> ${esc(md.mark)}${md.simulated ? " <span style='color:#B45309'>(SIMULATION — not reported to AADE)</span>" : ""}<br><b>Σειρά / Α.Α.</b> ${esc(md.series)} / ${esc(md.aa)}</div></div>` : ""}
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script></body></html>`);
  w.document.close();
  return true;
}

export default function DeliveryNotes() {
  const commentCounts = useCommentCounts("delivery_note");
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState(null);
  const [meta, setMeta] = useState(null);
  const [clients, setClients] = useState([]);
  const [biz, setBiz] = useState({});
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState("all");
  const load = useCallback(async () => {
    const [l, m, c, b] = await Promise.all([api.get("/delivery-notes"), api.get("/delivery-notes/meta"), api.get("/clients"), api.get("/business")]);
    setList(l); setMeta(m); setClients(c); setBiz(b); return l;
  }, []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);
  useEffect(() => {
    if (!list || !meta) return;
    if (params.get("new")) setEditing(blank(biz));
    const o = params.get("open") && list.find((n) => n.id === params.get("open"));
    if (o) setEditing(o);
    if (params.get("new") || params.get("open")) setParams({}, { replace: true });
  }, [params, list, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (n, path, msg) => { try { await api.post(`/delivery-notes/${n.id}/${path}`); toast.success(t(msg)); load(); } catch (e) { toast.error(e.message); } };
  const share = async (n) => { try { const r = await api.post(`/delivery-notes/${n.id}/share`); await navigator.clipboard?.writeText(r.url); toast.success(t("Link copied")); load(); } catch (e) { toast.error(e.message); } };
  const print = async (n) => {
    let note = n;
    if (!n.public_token && n.status !== "draft") { await api.post(`/delivery-notes/${n.id}/share`).catch(() => {}); note = (await load()).find((x) => x.id === n.id) || n; }
    if (!(await printNote(note, biz, meta))) toast.error(t("Allow pop-ups to print"));
  };
  const del = async (n) => { if (window.confirm(t("Delete {n}?", { n: n.number }))) { try { await api.del(`/delivery-notes/${n.id}`); load(); } catch (e) { toast.error(e.message); } } };

  if (!list || !meta) return <PageLoader />;
  const shown = list.filter((n) => filter === "all" || (filter === "transit" ? n.status === "issued" : n.status === filter));
  return (
    <div className="animate-in">
      <PageHeader title={t("Delivery notes")} subtitle={t("Digital delivery notes (Ψηφιακό Δελτίο Αποστολής) with ΜΑΡΚ and QR, reported to myDATA.")}
        actions={<Button onClick={() => setEditing(blank(biz))} data-testid="new-dn"><Plus className="h-4 w-4" />{t("New delivery note")}</Button>} />
      {list.length === 0 ? (
        <Empty icon={Truck} title={t("No delivery notes yet")} text={t("Create one here, or open an invoice's menu and choose “Create delivery note” to fill it in automatically.")}
          action={<Button onClick={() => setEditing(blank(biz))}><Plus className="h-4 w-4" />{t("New delivery note")}</Button>} />
      ) : (
        <>
          <Segmented className="mb-4" value={filter} onChange={setFilter} options={[["all", "All"], ["draft", "Drafts"], ["transit", "In transit"], ["delivered", "Delivered"]]} />
          <Table head={["Number", "Recipient", { label: "Route", className: "hidden md:table-cell" }, "Status", { label: "ΜΑΡΚ", className: "hidden lg:table-cell" }, ""]}>
            {shown.map((n) => {
              const [label, tone] = STATUS[n.status] || STATUS.draft;
              return (
                <tr key={n.id} className="hover:bg-surface-2/50" data-testid={`dn-row-${n.id}`}>
                  <td className="td font-semibold">{n.number}<p className="text-[11px] font-normal text-muted">{date(n.dispatch_date)}</p></td>
                  <td className="td"><p className="font-medium">{n.recipient_name || t(meta.purposes[n.move_purpose] || "")}</p>{n.recipient_afm && <p className="text-[11px] text-muted">ΑΦΜ {n.recipient_afm}</p>}</td>
                  <td className="td hidden md:table-cell text-muted text-sm">{n.loading_address.city || "—"} → {n.delivery_address.city || "—"}</td>
                  <td className="td"><Badge tone={tone}>{t(label)}</Badge>{n.mydata?.simulated && <span className="block text-[10px] text-warn mt-0.5">{t("Simulation")}</span>}</td>
                  <td className="td hidden lg:table-cell font-mono text-xs">{n.mydata?.mark || "—"}</td>
                  <td className="td"><div className="flex justify-end items-center -mr-2">
                    <CommentButton type="delivery_note" id={n.id} label={`${n.number} · ${n.recipient_name || ""}`} count={commentCounts[n.id]} />
                    {n.status === "draft" && <IconBtn icon={Pencil} label={t("Edit")} onClick={() => setEditing(n)} />}
                    <IconBtn icon={Printer} label={t("Print with QR")} onClick={() => print(n)} />
                    <RowMenu items={[
                      n.status === "draft" && { label: t("Issue to myDATA"), icon: Send, onClick: () => act(n, "issue", "Issued") },
                      n.status === "issued" && { label: t("Mark as delivered"), icon: CheckCircle2, onClick: () => act(n, "delivered", "Marked as delivered"), testid: `dn-delivered-${n.id}` },
                      n.status !== "draft" && { label: t("Copy QR link"), icon: Link2, onClick: () => share(n) },
                      n.status === "issued" && { label: t("Cancel at AADE"), icon: XCircle, tone: "danger", onClick: () => window.confirm(t("Cancel {n} at AADE?", { n: n.number })) && act(n, "cancel", "Cancelled") },
                      n.status === "draft" && { label: t("Delete"), icon: Trash2, tone: "danger", onClick: () => del(n) },
                    ]} />
                  </div></td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={6} className="text-center text-sm text-muted py-10">{t("Nothing matches this filter.")}</td></tr>}
          </Table>
        </>
      )}
      {editing && <NoteEditor value={editing} meta={meta} clients={clients} onClose={() => setEditing(null)} onSaved={(n, keepOpen) => { load(); setEditing(keepOpen ? n : null); }} />}
      <p className="text-xs text-muted mt-6 flex items-center gap-1.5"><PackageCheck className="h-3.5 w-3.5" />{t("Simulation mode issues test ΜΑΡΚs only. Check the current AADE delivery-note rules with your accountant before going live.")}</p>
    </div>
  );
}
