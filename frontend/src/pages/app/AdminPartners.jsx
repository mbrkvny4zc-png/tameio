import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, Handshake } from "lucide-react";
import { api, download } from "@/lib/api";
import { money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Empty, Input, Modal, PageHeader, PageLoader, Stat, Table } from "@/components/ui";

/** For Tameio's own admins: every partner firm, what it's owed, and marking payouts as paid. */
export default function AdminPartners() {
  const { t } = useT();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(() => api.get("/admin/partners").then(setList).catch((e) => { toast.error(e.message); setList(false); }), []);
  useEffect(() => { load(); }, [load]);
  if (list === null) return <PageLoader />;
  if (list === false) return <Empty icon={Handshake} title={t("Not available")} text={t("This page is for Tameio administrators.")} />;
  const setShare = async (p, v) => { try { await api.put(`/admin/partners/${p.org_id}`, { share_pct: parseFloat(v) }); toast.success(t("Saved")); load(); } catch (e) { toast.error(e.message); } };
  const pay = async (p, m) => {
    try { const r = await api.post(`/admin/partners/${p.org_id}/payouts`, { month: m.month }); toast.success(t("Marked {amount} as paid", { amount: money(r.amount) })); await load(); }
    catch (e) { toast.error(e.message); }
  };
  const unpay = async (p, m) => { await api.del(`/admin/partners/${p.org_id}/payouts/${m.month}`).catch(() => {}); load(); };
  const current = open && list.find((x) => x.org_id === open);
  const thisMonth = new Date().toISOString().slice(0, 7);
  return (
    <div className="animate-in">
      <PageHeader title={t("Partner payouts")} subtitle={t("Accounting firms, what their referrals bring in, and what you owe them.")} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label={t("Partner firms")} value={list.length} />
        <Stat label={t("Referred businesses")} value={list.reduce((s, p) => s + p.referred, 0)} />
        <Stat label={t("Partner share this month")} value={money(list.reduce((s, p) => s + p.this_month, 0))} />
        <Stat label={t("Owed (finished months)")} value={money(list.reduce((s, p) => s + p.unpaid, 0))} tone="warn" />
      </div>
      {list.length === 0 ? <Empty icon={Handshake} title={t("No partner firms yet")} text={t("Accounting firms get a referral link as soon as they open their free account.")} /> : (
        <Table head={["Firm", "Code", { label: "Share %", className: "text-right" }, { label: "Referred", className: "text-right" }, { label: "This month", className: "text-right" }, { label: "Owed", className: "text-right" }, ""]}>
          {list.map((p) => (
            <tr key={p.org_id} data-testid={`admin-partner-${p.code}`}>
              <td className="td"><p className="font-medium">{p.firm}</p><p className="text-[11px] text-muted">{p.email}</p></td>
              <td className="td font-mono text-xs">{p.code}</td>
              <td className="td text-right"><Input type="number" min="0" max="100" step="1" defaultValue={p.share_pct} className="h-8 w-20 ml-auto text-right" onBlur={(e) => Number(e.target.value) !== p.share_pct && setShare(p, e.target.value)} aria-label={t("Share %")} /></td>
              <td className="td text-right num">{p.referred} <span className="text-muted text-xs">({p.paying})</span></td>
              <td className="td text-right num">{money(p.this_month)}</td>
              <td className={`td text-right num font-semibold ${p.unpaid > 0 ? "text-warn" : "text-muted"}`}>{money(p.unpaid)}</td>
              <td className="td text-right"><Button size="sm" variant="secondary" onClick={() => setOpen(p.org_id)} data-testid={`admin-open-${p.code}`}>{t("Payouts")}</Button></td>
            </tr>
          ))}
        </Table>
      )}
      <Modal open={!!current} onClose={() => setOpen(null)} wide title={current ? t("Payouts · {firm}", { firm: current.firm }) : ""}
        footer={current && <Button variant="secondary" onClick={() => download(`/admin/partners/${current.org_id}/report.csv`, `partner-${current.code}.csv`)}><Download className="h-4 w-4" />{t("Download report")}</Button>}>
        {current && (
          <div className="divide-y divide-line text-sm" data-testid="admin-payouts">
            {[...current.months].reverse().map((m) => (
              <div key={m.month} className="flex items-center gap-3 py-2">
                <span className="w-20 font-medium">{m.month}</span>
                <span className="flex-1 text-xs text-muted">{t("{n} paying", { n: m.paying_clients })} · {money(m.revenue)}</span>
                <span className="num font-semibold w-20 text-right">{money(m.share)}</span>
                <span className="w-36 text-right">
                  {m.paid ? <button onClick={() => unpay(current, m)} className="inline-flex items-center gap-1 text-success text-xs font-semibold" title={t("Undo")}><CheckCircle2 className="h-4 w-4" />{t("Paid")}</button>
                    : m.month >= thisMonth ? <Badge>{t("Running")}</Badge>
                      : m.share > 0 ? <Button size="sm" onClick={() => pay(current, m)} data-testid={`pay-${m.month}`}>{t("Mark paid")}</Button> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
