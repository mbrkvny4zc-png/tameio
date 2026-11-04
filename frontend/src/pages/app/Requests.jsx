import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileQuestion, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { money, relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Card, Empty, PageHeader, PageLoader, Spinner } from "@/components/ui";

function ItemRow({ req, item, onDone }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const upload = async (file) => {
    if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    setBusy(true);
    try { await api.upload(`/receipt-requests/${req.id}/items/${item.id}/upload`, fd); toast.success(t("Receipt added")); onDone(); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm" data-testid={`request-item-${item.id}`}>
      {item.status === "done" ? <CheckCircle2 className="h-5 w-5 text-success shrink-0" /> : <FileQuestion className="h-5 w-5 text-warn shrink-0" />}
      <div className="flex-1 min-w-0"><p className="truncate">{item.description}</p><p className="text-[11px] text-muted">{item.date} · {t(item.kind === "bank" ? "Bank payment" : "Expense")}</p></div>
      <span className="num font-semibold">{money(item.amount)}</span>
      {item.status !== "done" && (
        <label className="h-9 px-3 inline-flex items-center gap-1.5 rounded-xl bg-brand text-white text-xs font-semibold cursor-pointer hover:brightness-110">
          {busy ? <Spinner className="h-4 w-4 text-white" /> : <Upload className="h-4 w-4" />}{t("Upload")}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" capture="environment" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
        </label>
      )}
    </div>
  );
}

export default function Requests() {
  const { t } = useT();
  const [list, setList] = useState(null);
  const load = useCallback(async () => setList(await api.get("/receipt-requests")), []);
  useEffect(() => { load().catch(() => setList([])); }, [load]);
  if (!list) return <PageLoader />;
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title={t("Receipts your accountant needs")} subtitle={t("Upload a photo or PDF for each payment — that's it.")} />
      {list.length === 0 ? <Empty icon={CheckCircle2} title={t("No requests")} text={t("When your accountant needs a receipt, it shows up here.")} /> : (
        <div className="space-y-5">
          {list.map((r) => (
            <Card key={r.id} className="overflow-hidden">
              <div className="px-4 py-3 border-b border-line flex items-center justify-between gap-3 bg-surface-2/50">
                <div><p className="font-semibold text-sm">{t("From {name}", { name: r.requested_by_name })}</p><p className="text-[11px] text-muted">{relative(r.created_at)}</p></div>
                <Badge tone={r.status === "done" ? "success" : "warn"}>{t(r.status === "done" ? "Done" : "Open")}</Badge>
              </div>
              {r.message && <p className="px-4 pt-3 text-sm text-muted">{r.message}</p>}
              <div className="divide-y divide-line">{r.items.map((i) => <ItemRow key={i.id} req={r} item={i} onDone={load} />)}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
