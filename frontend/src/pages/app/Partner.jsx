import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Copy, Download, Handshake, Link2, Pencil, QrCode, Users } from "lucide-react";
import { api, download } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Empty, Field, Input, Modal, PageHeader, PageLoader, Stat, Table } from "@/components/ui";

const SOURCE = { link: "Signed up with your link", added_by_firm: "Set up by your firm", code: "Entered your code", admin: "Added by Tameio" };

const monthLabel = (m, lang) => new Date(m + "-01T00:00:00").toLocaleDateString(lang === "el" ? "el-GR" : "en-GB", { month: "short", year: "numeric" });

/** The accounting firm's partner page: its link, who signed up through it, and what it has earned. */
export default function Partner() {
  const { t, lang } = useT();
  const [r, setR] = useState(null);
  const [edit, setEdit] = useState(null);
  const [qr, setQr] = useState(null);
  const load = useCallback(() => api.get("/partner?months=12").then(setR).catch((e) => { toast.error(e.message); setR(false); }), []);
  useEffect(() => { load(); }, [load]);
  if (r === null) return <PageLoader />;
  if (r === false) return <Empty icon={Handshake} title={t("Partner programme")} text={t("Only the firm's owner or admins can see this page.")} />;
  const copy = (v) => navigator.clipboard?.writeText(v).then(() => toast.success(t("Copied")));
  const saveCode = async () => { try { setR(await api.put("/partner/code", { code: edit })); setEdit(null); toast.success(t("Your link changed — share the new one")); } catch (e) { toast.error(e.message); } };
  const showQr = async () => setQr(await QRCode.toDataURL(r.link, { margin: 1, width: 520 }));
  // Hide the empty months before the firm's first referral.
  const first = r.months.findIndex((m) => m.revenue > 0 || m.paid);
  const months = r.months.slice(first < 0 ? r.months.length - 1 : first).reverse();
  const max = Math.max(1, ...r.months.map((m) => m.share));
  return (
    <div className="animate-in">
      <PageHeader title={t("Partner programme")} subtitle={t("Recommend Tameio to your clients and earn {pct}% of their subscription, every month they stay.", { pct: r.share_pct })}
        actions={<Button variant="secondary" onClick={() => download("/partner/report.csv", `tameio-partner-${r.code}.csv`).catch((e) => toast.error(e.message))}><Download className="h-4 w-4" />{t("Download report")}</Button>} />

      <Card className="p-5 sm:p-6 mb-6 bg-gradient-to-br from-brand-soft to-surface" data-testid="partner-link">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{t("Your referral link")}</p>
        <div className="mt-2 flex flex-col sm:flex-row gap-2 sm:items-center">
          <code className="flex-1 min-w-0 block truncate rounded-xl bg-surface border border-line px-4 h-11 leading-[44px] text-sm font-semibold" title={r.link}>{r.link}</code>
          <div className="flex gap-2">
            <Button onClick={() => copy(r.link)} data-testid="partner-copy"><Copy className="h-4 w-4" />{t("Copy link")}</Button>
            <Button variant="secondary" onClick={showQr} aria-label={t("QR code")}><QrCode className="h-4 w-4" /></Button>
          </div>
        </div>
        <p className="text-sm text-muted mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
          {t("Or give clients your code")} <b className="font-mono text-ink">{r.code}</b>
          <button onClick={() => setEdit(r.code)} className="inline-flex items-center gap-1 text-brand font-semibold text-xs"><Pencil className="h-3 w-3" />{t("Change")}</button>
        </p>
        <p className="text-xs text-muted mt-2">{t("Businesses you add yourself from “My clients” count automatically.")}</p>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Stat label={t("Referred businesses")} value={r.totals.referred} sub={t("{n} paying", { n: r.totals.paying })} icon={Users} />
        <Stat label={t("This month")} value={money(r.totals.this_month)} sub={t("so far")} />
        <Stat label={t("Last 12 months")} value={money(r.totals.earned)} />
        <Stat label={t("Due to you")} value={money(r.totals.unpaid)} sub={t("finished months not yet paid")} tone={r.totals.unpaid > 0 ? "success" : undefined} />
      </div>

      <div className="grid lg:grid-cols-[1fr_1.1fr] gap-6 items-start">
        <Card className="p-5 sm:p-6">
          <p className="font-bold mb-4">{t("Earnings by month")}</p>
          <div className="flex items-end gap-1.5 h-28 mb-4" aria-hidden>
            {r.months.map((m) => <div key={m.month} className="flex-1 rounded-t bg-brand/80" style={{ height: `${Math.max(3, (m.share / max) * 100)}%` }} title={`${m.month}: ${money(m.share)}`} />)}
          </div>
          <div className="divide-y divide-line text-sm">
            {months.map((m) => (
              <div key={m.month} className="flex items-center gap-3 py-2">
                <span className="w-24 text-muted">{monthLabel(m.month, lang)}</span>
                <span className="flex-1 text-xs text-muted">{t("{n} paying", { n: m.paying_clients })} · {money(m.revenue)}</span>
                <span className="num font-semibold w-20 text-right">{money(m.share)}</span>
                <span className="w-20 text-right">{m.paid ? <Badge tone="success">{t("Paid")}</Badge> : m.month === r.months[r.months.length - 1].month ? <Badge>{t("Running")}</Badge> : m.share > 0 ? <Badge tone="warn">{t("Due")}</Badge> : null}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted mt-3">{t("Estimated from plan prices before VAT, using each client's plan at the end of the month.")}</p>
        </Card>

        <Card className="p-0 overflow-hidden">
          <p className="font-bold px-5 sm:px-6 pt-5">{t("Your referred businesses")}</p>
          {r.clients.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted"><Link2 className="h-6 w-6 mx-auto mb-2 text-brand" />{t("Nobody yet. Send your link to a client who still invoices on paper or in Excel.")}</div>
          ) : (
            <div className="mt-3"><Table head={["Business", { label: "Plan", className: "hidden sm:table-cell" }, { label: "Monthly", className: "text-right" }, { label: "Your share", className: "text-right" }]}>
              {r.clients.map((c) => (
                <tr key={c.org_id} data-testid={`partner-client-${c.org_id}`}>
                  <td className="td"><p className="font-medium">{c.name}</p><p className="text-[11px] text-muted">{t(SOURCE[c.source] || "")} · {date(c.since)}</p></td>
                  <td className="td hidden sm:table-cell"><Badge tone={c.monthly > 0 ? "brand" : "neutral"}>{t(c.plan_name)}</Badge></td>
                  <td className="td text-right num">{money(c.monthly)}</td>
                  <td className="td text-right num font-semibold">{money(c.your_share)}</td>
                </tr>
              ))}
            </Table></div>
          )}
        </Card>
      </div>

      <Modal open={edit !== null} onClose={() => setEdit(null)} title={t("Change your code")} description={t("Pick something your clients will remember. Links with the old code stop working.")}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>{t("Cancel")}</Button><Button onClick={saveCode} data-testid="partner-code-save">{t("Save")}</Button></>}>
        <Field label={t("Code")} hint={t("Latin letters, digits and dashes, e.g. PAPADOPOULOS")}><Input value={edit || ""} onChange={(e) => setEdit(e.target.value.toUpperCase())} maxLength={24} data-testid="partner-code" /></Field>
      </Modal>
      <Modal open={!!qr} onClose={() => setQr(null)} title={t("QR code for your link")} description={t("Print it on your office door, your emails or your invoices.")}>
        {qr && <div className="text-center"><img src={qr} alt="QR" className="mx-auto h-60 w-60" /><a href={qr} download={`tameio-${r.code}.png`} className="inline-flex mt-4 text-sm font-semibold text-brand">{t("Download PNG")}</a></div>}
      </Modal>
    </div>
  );
}
