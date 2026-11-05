import { useCallback, useEffect, useState } from "react";
import { AtSign, Check, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { openComments } from "@/components/Comments";
import { Badge, Button, Card, Empty, PageHeader, PageLoader, Segmented } from "@/components/ui";

const TYPE = { invoice: "Invoice", expense: "Expense", client: "Client", supplier: "Supplier", received: "Purchase invoice", delivery_note: "Delivery note", document: "Document", product: "Product" };

/** Everything someone @mentioned you in, until you mark it done. */
export default function Mentions() {
  const { t } = useT();
  const [status, setStatus] = useState("open");
  const [list, setList] = useState(null);
  const load = useCallback(() => api.get(`/mentions?status=${status}`).then(setList).catch(() => setList([])), [status]);
  useEffect(() => { setList(null); load(); }, [load]);
  useEffect(() => {
    window.addEventListener("tameio:comments-changed", load);
    return () => window.removeEventListener("tameio:comments-changed", load);
  }, [load]);
  const done = async (c, v) => { await api.post(`/mentions/${c.id}/done`, { done: v }); load(); window.dispatchEvent(new Event("tameio:mentions-changed")); };
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title={t("Mentions")} subtitle={t("Questions and notes where a teammate or your accountant mentioned you.")} />
      <Segmented className="mb-4" value={status} onChange={setStatus} options={[["open", "To answer"], ["done", "Done"], ["all", "All"]]} />
      {!list ? <PageLoader /> : list.length === 0 ? (
        <Empty icon={AtSign} title={status === "open" ? t("You're all caught up") : t("Nothing here")} text={t("When someone writes @your name on an invoice, expense or client, it shows up here.")} />
      ) : (
        <div className="space-y-3" data-testid="mentions-list">
          {list.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start gap-3">
                <span className="h-9 w-9 rounded-full bg-brand-soft text-brand text-sm font-bold flex items-center justify-center shrink-0">{(c.author_name || "?")[0]}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] text-muted"><b className="text-ink">{c.author_name}</b> · {relative(c.created_at)} · <Badge>{t(TYPE[c.target_type] || c.target_type)}</Badge> {c.target_label}</p>
                  <p className="text-sm mt-1.5 whitespace-pre-line break-words">{c.text}</p>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" onClick={() => openComments(c.target_type, c.target_id, c.target_label)} data-testid={`mention-open-${c.id}`}><MessageSquare className="h-3.5 w-3.5" />{t("Reply")}</Button>
                    {c.done ? <Button size="sm" variant="ghost" onClick={() => done(c, false)}>{t("Reopen")}</Button>
                      : <Button size="sm" variant="secondary" onClick={() => done(c, true)} data-testid={`mention-inbox-done-${c.id}`}><Check className="h-3.5 w-3.5" />{t("Mark done")}</Button>}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
