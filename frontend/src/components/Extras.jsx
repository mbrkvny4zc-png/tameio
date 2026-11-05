import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, FileSpreadsheet, Loader2, MoreHorizontal, Search, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Input, Modal, Select, cx } from "@/components/ui";

/* ------------------------------------------------------------------ ΑΦΜ with auto-fill */

const afmOk = (v) => {
  const d = (v || "").replace(/\D/g, "");
  if (d.length !== 9 || d === "000000000") return false;
  const sum = [...d.slice(0, 8)].reduce((s, c, i) => s + Number(c) * 2 ** (8 - i), 0);
  return (sum % 11) % 10 === Number(d[8]);
};

/** ΑΦΜ field that looks the business up as soon as 9 valid digits are typed. onFound gets {name, address, city, postal_code, doy, ...}. */
export function AfmInput({ value, onChange, onFound, country = "GR", ...p }) {
  const { t } = useT();
  const [state, setState] = useState("idle");
  const last = useRef("");
  const lookup = async (v, manual) => {
    const afm = (v || "").replace(/\D/g, "");
    if (country !== "GR" || !afmOk(afm) || (!manual && afm === last.current)) return;
    last.current = afm;
    setState("busy");
    try {
      const r = await api.get(`/lookup/afm/${afm}`);
      onFound?.(r);
      setState("done");
      toast.success(t("Filled in from the registry: {name}", { name: r.name }));
    } catch (e) { setState("idle"); if (manual) toast.error(e.message); }
  };
  useEffect(() => { if (afmOk(value) && value.replace(/\D/g, "") !== last.current) lookup(value); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = (value || "").replace(/\D/g, "").length === 9 && country === "GR" && !afmOk(value);
  return (
    <div className="relative">
      <Input value={value || ""} onChange={(e) => { setState("idle"); onChange(e.target.value); }} inputMode="numeric" placeholder={t("9 digits")}
        className={cx("pr-10", bad && "border-danger")} aria-invalid={bad} {...p} />
      <button type="button" onClick={() => lookup(value, true)} disabled={country !== "GR" || !afmOk(value) || state === "busy"}
        className="absolute right-1 top-1 h-8 w-8 rounded-lg flex items-center justify-center text-muted hover:text-ink hover:bg-surface-2 disabled:opacity-40"
        title={t("Look up in the registry")} aria-label={t("Look up in the registry")}>
        {state === "busy" ? <Loader2 className="h-4 w-4 animate-spin" /> : state === "done" ? <Check className="h-4 w-4 text-success" /> : <Search className="h-4 w-4" />}
      </button>
      {bad && <p className="text-[11px] text-danger mt-1">{t("This ΑΦΜ fails the checksum")}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ "⋯" row menu */

export function RowMenu({ items, label }) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const shown = items.filter(Boolean);
  if (!shown.length) return null;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface-2" aria-label={label || t("More actions")} aria-expanded={open}>
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 card shadow-lift p-1.5 z-30 animate-in">
          {shown.map(({ label: l, icon: Icon, onClick, tone, testid }) => (
            <button key={l} onClick={() => { setOpen(false); onClick(); }} data-testid={testid}
              className={cx("w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm text-left hover:bg-surface-2", tone === "danger" && "text-danger")}>
              {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" />}{l}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Excel / CSV import */

const FIELD_LABELS = {
  name: "Name", company: "Company", email: "Email", phone: "Phone", afm: "ΑΦΜ", doy: "ΔΟΥ", address: "Address", city: "City",
  postal_code: "Postal code", country: "Country", code: "Code", unit_price: "Price", tax_rate: "VAT rate", unit: "Unit",
  number: "Number", issue_date: "Date", client_name: "Client", client_afm: "Client ΑΦΜ", net: "Net amount", vat: "VAT amount",
  total: "Total", status: "Status (paid?)", due_date: "Due date",
};
const KIND_LABEL = { clients: "clients", products: "products & services", invoices: "past invoices" };

export function ImportDialog({ kind, open, onClose, onDone }) {
  const { t } = useT();
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFile(null); setRes(null); setMapping({}); } }, [open, kind]);

  const send = async (f, commit, m) => {
    const fd = new FormData();
    fd.append("file", f);
    if (commit) fd.append("commit", "true");
    const map = m || mapping;
    if (Object.keys(map).length) fd.append("mapping", Object.entries(map).map(([k, v]) => `${k}=${v}`).join(","));
    setBusy(true);
    try {
      const r = await api.upload(`/import/${kind}`, fd);
      if (commit) {
        toast.success(t("Imported {n} {what}", { n: r.created, what: t(KIND_LABEL[kind]) }));
        onDone?.(r); onClose();
      } else { setRes(r); setMapping(r.mapping); }
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const pick = (f) => { if (f) { setFile(f); send(f, false, {}); } };
  const remap = (field, idx) => { const m = { ...mapping, [field]: idx === "" ? -1 : Number(idx) }; setMapping(m); send(file, false, m); };

  return (
    <Modal open={open} onClose={onClose} wide title={t("Import {what}", { what: t(KIND_LABEL[kind] || "") })}
      description={t("Upload an Excel (.xlsx) or CSV file. Columns are matched automatically — check them before importing.")}
      footer={<>
        <Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
        <Button onClick={() => send(file, true)} loading={busy} disabled={!res || res.missing.length > 0 || res.ready === 0} data-testid="import-commit">
          {res ? t("Import {n}", { n: res.ready }) : t("Import")}
        </Button>
      </>}>
      {!res ? (
        <label className="flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line py-12 cursor-pointer hover:bg-surface-2" data-testid="import-drop"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); pick(e.dataTransfer.files?.[0]); }}>
          {busy ? <Loader2 className="h-8 w-8 animate-spin text-brand" /> : <FileSpreadsheet className="h-8 w-8 text-brand" />}
          <span className="text-sm font-semibold">{t("Choose a file or drop it here")}</span>
          <span className="text-xs text-muted">.xlsx · .csv</span>
          <input type="file" accept=".xlsx,.xlsm,.csv,.txt" className="hidden" onChange={(e) => pick(e.target.files?.[0])} data-testid="import-file" />
        </label>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip bg-surface-2 text-muted"><Upload className="h-3 w-3" />{file?.name}</span>
            <span className="chip bg-success/10 text-success">{t("{n} ready", { n: res.ready })}</span>
            {res.duplicates > 0 && <span className="chip bg-surface-2 text-muted">{t("{n} already exist", { n: res.duplicates })}</span>}
            {res.problems.length > 0 && <span className="chip bg-warn/10 text-warn">{t("{n} with problems", { n: res.problems.length })}</span>}
          </div>
          <div>
            <p className="label">{t("Columns")}</p>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
              {res.fields.map((f) => (
                <div key={f} className="flex items-center gap-2">
                  <span className="text-sm w-32 shrink-0">{t(FIELD_LABELS[f] || f)}{res.required.includes(f) && <span className="text-danger"> *</span>}</span>
                  <Select value={mapping[f] ?? ""} onChange={(e) => remap(f, e.target.value)} className="h-9">
                    <option value="">— {t("not in file")} —</option>
                    {res.headers.map((h, i) => <option key={i} value={i}>{h || `${t("Column")} ${i + 1}`}</option>)}
                  </Select>
                </div>
              ))}
            </div>
            {res.missing.length > 0 && <p className="text-xs text-danger mt-2">{t("Choose a column for: {f}", { f: res.missing.map((m) => t(FIELD_LABELS[m] || m)).join(", ") })}</p>}
          </div>
          {res.problems.length > 0 && (
            <div className="rounded-xl bg-warn/5 border border-warn/20 p-3 text-xs space-y-1 max-h-28 overflow-y-auto">
              {res.problems.slice(0, 8).map((p) => <p key={p.row}>{t("Row {n}", { n: p.row })}: {p.error}</p>)}
              <p className="text-muted">{t("Rows with problems are skipped.")}</p>
            </div>
          )}
          {res.preview.length > 0 && (
            <div>
              <p className="label">{t("Preview")}</p>
              <div className="rounded-xl border border-line divide-y divide-line text-sm">
                {res.preview.map((r, i) => (
                  <div key={i} className="px-3 py-2 flex gap-3 justify-between">
                    <span className="truncate font-medium">{r.name || r.client_name}</span>
                    <span className="text-muted text-xs shrink-0">{r.afm || r.client_afm || ""} {r.unit_price != null ? `€${r.unit_price}` : ""}{r.total != null ? `€${r.total} · ${r.issue_date}` : ""}{r.city ? ` · ${r.city}` : ""}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
