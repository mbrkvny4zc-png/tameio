import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { CheckCircle2, EyeOff, Inbox, Link2, Plus, RefreshCw, Send, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { date, money, relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Empty, IconBtn, PageHeader, PageLoader, Segmented, Table } from "@/components/ui";

const SOURCE = { expense: ["from your expense", "success"], history: ["same as last time", "brand"], ai: ["AI suggestion", "violet"] };

export default function Received() {
  const { t } = useT();
  const [data, setData] = useState(null);
  const [cats, setCats] = useState([]);
  const [filter, setFilter] = useState("todo");
  const [sel, setSel] = useState({});
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => setData(await api.get("/received")), []);
  useEffect(() => { load().catch(() => setData({ items: [] })); api.get("/expenses/categories").then(setCats).catch(() => {}); }, [load]);

  const items = useMemo(() => (data?.items || []).filter((x) => ({
    todo: !x.ignored && x.classification?.state !== "sent", sent: x.classification?.state === "sent", unmatched: !x.match && !x.ignored, all: true,
  }[filter])), [data, filter]);
  const label = (k) => t(cats.find((c) => c.key === k)?.label || k);

  const sync = async () => {
    setBusy("sync");
    try { const r = await api.post("/received/sync"); toast.success(t("{n} new purchase invoice(s) · {m} matched to expenses", { n: r.added, m: r.matched })); await load(); }
    catch (e) { toast.error(e.message); }
    setBusy("");
  };
  const suggest = async () => {
    setBusy("ai");
    try { const r = await api.post("/received/suggest"); toast.success(t("AI suggested {n} categories", { n: r.suggested })); await load(); }
    catch (e) { toast.error(e.message); }
    setBusy("");
  };
  const classify = async (x, category) => {
    try { await api.put(`/received/${x.id}/classification`, { category }); await load(); setSel((s) => ({ ...s, [x.id]: true })); }
    catch (e) { toast.error(e.message); }
  };
  const acceptAll = async () => {
    const todo = items.filter((x) => x.suggestion && x.classification?.state !== "sent" && x.classification?.state !== "draft");
    for (const x of todo) await api.put(`/received/${x.id}/classification`, { category: x.suggestion.category }).catch(() => {});
    setSel(Object.fromEntries(items.filter((x) => x.classification?.state !== "sent").map((x) => [x.id, true])));
    await load();
  };
  const send = async () => {
    const ids = Object.entries(sel).filter(([, v]) => v).map(([k]) => k);
    setBusy("send");
    try {
      const r = await api.post("/received/send", { ids });
      if (r.failed.length) toast.error(r.failed.join("\n")); else toast.success(t("{n} classification(s) sent to myDATA", { n: r.sent }));
      setSel({}); await load();
    } catch (e) { toast.error(e.details?.length ? `${e.message}: ${e.details.join(", ")}` : e.message); }
    setBusy("");
  };
  const createExpense = async (x) => { try { const r = await api.post(`/received/${x.id}/create-expense`); toast.success(t("{n} created", { n: r.number })); load(); } catch (e) { toast.error(e.message); } };
  const ignore = async (x) => { await api.put(`/received/${x.id}/ignore`, { ignored: !x.ignored }); load(); };

  if (!data) return <PageLoader />;
  const selectedCount = Object.values(sel).filter(Boolean).length;
  const suggestedWaiting = items.filter((x) => x.suggestion && !["draft", "sent"].includes(x.classification?.state)).length;
  const needAi = (data.items || []).filter((x) => !x.suggestion && !x.ignored).length;
  return (
    <div className="animate-in">
      <PageHeader title={t("Purchase invoices")} subtitle={t("Invoices your suppliers reported to myDATA about you — matched to your expenses and classified for AADE.")}
        actions={<>
          {needAi > 0 && <Button variant="secondary" onClick={suggest} loading={busy === "ai"}><Sparkles className="h-4 w-4" />{t("Suggest with AI")} ({needAi})</Button>}
          <Button onClick={sync} loading={busy === "sync"} data-testid="received-sync"><RefreshCw className="h-4 w-4" />{t("Get from myDATA")}</Button>
        </>} />
      {data.last_sync && <p className="text-xs text-muted -mt-3 mb-5">{t("Last checked {when}", { when: relative(data.last_sync) })} · <Link to="/app/settings?tab=codes" className="text-brand font-semibold">{t("Classification codes")}</Link></p>}
      {(data.items || []).length === 0 ? (
        <Empty icon={Inbox} title={t("Nothing imported yet")} text={t("Fetch the invoices other businesses issued to you. In simulation mode you'll get sample data to try it.")}
          action={<Button onClick={sync} loading={busy === "sync"}><RefreshCw className="h-4 w-4" />{t("Get from myDATA")}</Button>} />
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-3 justify-between mb-4">
            <Segmented value={filter} onChange={setFilter} options={[["todo", t("To classify")], ["unmatched", t("No expense yet")], ["sent", t("Sent to AADE")], ["all", t("All")]]} />
            <div className="flex gap-2">
              {suggestedWaiting > 0 && <Button variant="secondary" onClick={acceptAll} data-testid="accept-all">{t("Accept all suggestions")}</Button>}
              <Button onClick={send} disabled={!selectedCount} loading={busy === "send"} data-testid="send-classifications"><Send className="h-4 w-4" />{t("Send {n} to myDATA", { n: selectedCount })}</Button>
            </div>
          </div>
          <Table head={["", t("Supplier"), t("Date"), { label: t("Total"), className: "text-right" }, t("Expense"), t("Category"), ""]}>
            {items.map((x) => {
              const st = x.classification?.state;
              return (
                <tr key={x.id} className={x.ignored ? "opacity-50" : "hover:bg-surface-2/50"} data-testid={`received-row-${x.id}`}>
                  <td className="td w-8">{st !== "sent" && <input type="checkbox" className="h-4 w-4 accent-[hsl(var(--brand))]" disabled={!["draft", "error"].includes(st)}
                    checked={!!sel[x.id]} onChange={(e) => setSel({ ...sel, [x.id]: e.target.checked })} aria-label={t("Select")} />}</td>
                  <td className="td"><p className="font-medium">{x.issuer_name || x.issuer_afm}</p><p className="text-[11px] text-muted font-mono">ΑΦΜ {x.issuer_afm} · ΜΑΡΚ {x.mark}</p></td>
                  <td className="td text-muted whitespace-nowrap">{date(x.issue_date)}</td>
                  <td className="td text-right num font-semibold">{money(x.gross)}</td>
                  <td className="td">{x.match ? <Badge tone="success"><Link2 className="h-3 w-3" />{x.match.number}</Badge>
                    : !x.ignored && <button onClick={() => createExpense(x)} className="chip bg-surface-2 hover:bg-brand-soft hover:text-brand" data-testid={`create-expense-${x.id}`}><Plus className="h-3 w-3" />{t("Create")}</button>}</td>
                  <td className="td min-w-[200px]">
                    {st === "sent" ? <span className="flex items-center gap-1.5 text-sm"><CheckCircle2 className="h-4 w-4 text-success" />{label(x.classification.category)}</span> : (
                      <div>
                        <select value={x.classification?.category || ""} onChange={(e) => classify(x, e.target.value)} className="input h-9 text-xs" aria-label={t("Category")} disabled={x.ignored}>
                          <option value="">{x.suggestion ? `${label(x.suggestion.category)} ?` : t("Choose…")}</option>
                          {cats.map((c) => <option key={c.key} value={c.key}>{t(c.label)}</option>)}
                        </select>
                        {x.suggestion && st !== "draft" && <button onClick={() => classify(x, x.suggestion.category)} className="mt-1 text-[11px] font-semibold text-brand">{t("Use")} {label(x.suggestion.category)} · <span className="text-muted font-normal">{t(SOURCE[x.suggestion.source][0])}</span></button>}
                        {st === "error" && <p className="text-[11px] text-danger mt-1">{x.classification.error}</p>}
                      </div>
                    )}
                  </td>
                  <td className="td"><IconBtn icon={EyeOff} label={x.ignored ? t("Restore") : t("Ignore")} onClick={() => ignore(x)} /></td>
                </tr>
              );
            })}
            {items.length === 0 && <tr><td colSpan={7} className="text-center text-sm text-muted py-10">{t("Nothing here — all done.")}</td></tr>}
          </Table>
          {(data.items || []).some((x) => x.simulated) && <p className="text-[11px] text-muted mt-3">{t("Simulation mode: these are sample documents, not from AADE.")}</p>}
        </>
      )}
    </div>
  );
}
