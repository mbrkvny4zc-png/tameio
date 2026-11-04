import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, EyeOff, Landmark, Link2, Plus, Upload, X } from "lucide-react";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Empty, IconBtn, Modal, PageHeader, PageLoader, Segmented, Select, Table } from "@/components/ui";

function MatchDialog({ txn, data, cats, onClose, onDone }) {
  const { t } = useT();
  const incoming = txn.amount > 0;
  const amount = Math.abs(txn.amount);
  const options = incoming
    ? data.open_invoices.map((i) => ({ type: "invoice", id: i.id, label: `${i.number} · ${i.client_name}`, amount: i.total }))
    : data.expenses.map((x) => ({ type: "expense", id: x.id, label: `${x.number} · ${x.vendor_name} · ${x.date}`, amount: x.total }));
  options.sort((a, b) => Math.abs(a.amount - amount) - Math.abs(b.amount - amount));
  const [pick, setPick] = useState(options[0] ? `${options[0].type}:${options[0].id}` : "");
  const [cat, setCat] = useState("other");
  const match = async () => {
    const [type, id] = pick.split(":");
    try { await api.post(`/bank/transactions/${txn.id}/match`, { type, id }); toast.success(t("Matched")); onDone(); } catch (e) { toast.error(e.message); }
  };
  const create = async () => {
    try { const r = await api.post(`/bank/transactions/${txn.id}/create-expense`, { category: cat }); toast.success(t("{n} created", { n: r.number })); onDone(); } catch (e) { toast.error(e.message); }
  };
  return (
    <Modal open onClose={onClose} title={t("Match payment")} description={`${date(txn.date)} · ${txn.description} · ${money(txn.amount)}`}>
      {options.length > 0 ? (
        <div className="space-y-3">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} data-testid="match-select">
            {options.slice(0, 100).map((o) => <option key={o.id} value={`${o.type}:${o.id}`}>{o.label} — {money(o.amount)}{Math.abs(o.amount - amount) < 0.01 ? " ✓" : ""}</option>)}
          </Select>
          <Button className="w-full" onClick={match}><Link2 className="h-4 w-4" />{incoming ? t("Mark this invoice paid") : t("Link to this expense")}</Button>
        </div>
      ) : <p className="text-sm text-muted">{incoming ? t("No unpaid invoices to match.") : t("No expenses to match.")}</p>}
      {!incoming && (
        <div className="mt-5 pt-5 border-t border-line space-y-3">
          <p className="text-sm font-semibold">{t("Or record it as a new expense")}</p>
          <Select value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}</Select>
          <Button variant="secondary" className="w-full" onClick={create}><Plus className="h-4 w-4" />{t("Create expense")}</Button>
        </div>
      )}
    </Modal>
  );
}

export default function Bank() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [filter, setFilter] = useState("open");
  const [matching, setMatching] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const load = useCallback(async () => setData(await api.get("/bank/transactions")), []);
  useEffect(() => { load().catch(() => setData({ items: [] })); api.get("/expenses/categories").then(setCats).catch(() => {}); }, [load]);

  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    setBusy(true);
    try { const r = await api.upload("/bank/import", fd); toast.success(t("{a} payments imported · {m} matched automatically", { a: r.added, m: r.matched })); await load(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const unmatch = async (x) => { await api.del(`/bank/transactions/${x.id}/match`); load(); };
  const ignore = async (x) => { await api.put(`/bank/transactions/${x.id}/ignore`, { ignored: !x.ignored }); load(); };
  const items = useMemo(() => (data?.items || []).filter((x) => ({ open: !x.match && !x.ignored, matched: !!x.match, all: true }[filter])), [data, filter]);
  const stats = useMemo(() => {
    const all = data?.items || [];
    return { total: all.length, matched: all.filter((x) => x.match).length, open: all.filter((x) => !x.match && !x.ignored).length };
  }, [data]);

  if (!data) return <PageLoader />;
  return (
    <div className="animate-in">
      <PageHeader title={t("Bank")} subtitle={t("Import your bank statement — payments are matched to invoices and expenses automatically.")}
        actions={<Button onClick={() => fileRef.current?.click()} loading={busy} data-testid="bank-import"><Upload className="h-4 w-4" />{t("Import statement (CSV)")}</Button>} />
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} data-testid="bank-file" />
      {data.items.length === 0 ? (
        <Empty icon={Landmark} title={t("No bank payments yet")} text={t("Download your statement as CSV from your bank's e-banking (Piraeus, NBG, Alpha, Eurobank and others work) and import it here.")}
          action={<Button onClick={() => fileRef.current?.click()} loading={busy}><Upload className="h-4 w-4" />{t("Import statement (CSV)")}</Button>} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[[t("Payments"), stats.total, ""], [t("Matched"), stats.matched, "text-success"], [t("To review"), stats.open, stats.open ? "text-warn" : "text-success"]].map(([l, v, c]) => (
              <Card key={l} className="px-4 py-3"><p className="text-xs text-muted">{l}</p><p className={`num text-xl font-bold ${c}`}>{v}</p></Card>
            ))}
          </div>
          <Segmented className="mb-4" value={filter} onChange={setFilter} options={[["open", t("To review")], ["matched", t("Matched")], ["all", t("All")]]} />
          <Table head={[t("Date"), t("Description"), { label: t("Amount"), className: "text-right" }, t("Matched to"), ""]}>
            {items.map((x) => (
              <tr key={x.id} className={x.ignored ? "opacity-50" : "hover:bg-surface-2/50"} data-testid={`bank-row-${x.id}`}>
                <td className="td text-muted whitespace-nowrap">{date(x.date)}</td>
                <td className="td"><span className="flex items-center gap-2">{x.amount > 0 ? <ArrowDownLeft className="h-4 w-4 text-success shrink-0" /> : <ArrowUpRight className="h-4 w-4 text-muted shrink-0" />}<span className="truncate max-w-[340px]">{x.description}</span></span></td>
                <td className={`td text-right num font-semibold ${x.amount > 0 ? "text-success" : ""}`}>{money(x.amount)}</td>
                <td className="td">{x.match ? (
                  <span className="inline-flex items-center gap-1.5"><Badge tone="success"><CheckCircle2 className="h-3 w-3" />{x.match.number}</Badge>{x.match.auto && <span className="text-[10px] text-muted">{t("auto")}</span>}
                    <button onClick={() => unmatch(x)} className="p-1 text-muted hover:text-danger" aria-label={t("Unmatch")}><X className="h-3 w-3" /></button></span>
                ) : !x.ignored && <Button size="sm" variant="soft" onClick={() => setMatching(x)} data-testid={`match-${x.id}`}>{t("Match")}</Button>}</td>
                <td className="td">{!x.match && <IconBtn icon={EyeOff} label={x.ignored ? t("Restore") : t("Ignore (e.g. transfer between your accounts)")} onClick={() => ignore(x)} />}</td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={5} className="text-center text-sm text-muted py-10">{t("Everything is matched.")}</td></tr>}
          </Table>
        </>
      )}
      {matching && <MatchDialog txn={matching} data={data} cats={cats} onClose={() => setMatching(null)} onDone={() => { setMatching(null); load(); }} />}
    </div>
  );
}
