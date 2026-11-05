import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bug, ImagePlus, Lightbulb, LifeBuoy, MessageCircleQuestion, Send, X } from "lucide-react";
import { api } from "@/lib/api";
import { relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Badge, Button, Card, Field, PageHeader, Segmented, Textarea } from "@/components/ui";

export const FB_STATUS = { new: ["Received", "neutral"], in_progress: ["Being worked on", "brand"], fixed: ["Fixed", "success"], wont_fix: ["Closed", "neutral"] };
const KIND_ICON = { bug: Bug, idea: Lightbulb, question: MessageCircleQuestion };

function shrink(file) {
  return new Promise((resolve, reject) => {
    if (!file?.type.startsWith("image/")) return reject(new Error("Choose an image"));
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, 1600 / img.width);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    img.onerror = () => reject(new Error("That image couldn't be read"));
    img.src = URL.createObjectURL(file);
  });
}

/** Every user: report a bug, suggest an idea or ask a question — and see the answers. */
export default function Feedback() {
  const { t } = useT();
  const [kind, setKind] = useState("bug");
  const [msg, setMsg] = useState("");
  const [shot, setShot] = useState("");
  const [busy, setBusy] = useState(false);
  const [mine, setMine] = useState([]);
  const load = useCallback(() => api.get("/feedback").then(setMine).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);
  const from = sessionStorage.getItem("tameio_last_page") || "";
  const send = async () => {
    setBusy(true);
    try {
      const r = await api.post("/feedback", { kind, message: msg, page: from, user_agent: navigator.userAgent, screenshot: shot });
      toast.success(t("Thanks! Report #{n} sent — we'll get back to you here.", { n: r.number }));
      setMsg(""); setShot(""); load();
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const placeholder = { bug: "What happened, and what did you expect? e.g. “When I print INV-0012 the page is blank.”", idea: "What would make Tameio better for you?", question: "Ask us anything about using Tameio." }[kind];
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title={t("Help & feedback")} subtitle={t("Found a problem or have an idea? Tell us — we read every message and reply here.")} />
      <Card className="p-5 sm:p-6" data-testid="feedback-form">
        <Segmented value={kind} onChange={setKind} options={[["bug", "Report a problem"], ["idea", "Suggest an idea"], ["question", "Ask a question"]]} />
        <Field label={t("Your message")} className="mt-4"><Textarea rows={5} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={t(placeholder)} data-testid="feedback-message" /></Field>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {shot ? (
            <div className="relative"><img src={shot} alt="" className="h-16 rounded-lg border border-line" /><button onClick={() => setShot("")} className="absolute -top-2 -right-2 h-5 w-5 rounded-full bg-ink text-bg flex items-center justify-center" aria-label={t("Remove")}><X className="h-3 w-3" /></button></div>
          ) : (
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-brand cursor-pointer"><ImagePlus className="h-4 w-4" />{t("Add a screenshot")}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { try { setShot(await shrink(e.target.files[0])); } catch (er) { toast.error(t(er.message)); } }} />
            </label>
          )}
          {from && <span className="text-xs text-muted">{t("We'll include the page you were on: {p}", { p: from })}</span>}
          <Button className="ml-auto" onClick={send} loading={busy} disabled={msg.trim().length < 5} data-testid="feedback-send"><Send className="h-4 w-4" />{t("Send")}</Button>
        </div>
      </Card>

      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted mt-8 mb-3">{t("Your reports")}</h2>
      {mine.length === 0 ? <p className="text-sm text-muted flex items-center gap-2"><LifeBuoy className="h-4 w-4" />{t("Nothing yet.")}</p> : (
        <div className="space-y-3">
          {mine.map((f) => {
            const [label, tone] = FB_STATUS[f.status] || FB_STATUS.new;
            const Icon = KIND_ICON[f.kind] || Bug;
            return (
              <Card key={f.id} className="p-4" data-testid={`my-feedback-${f.number}`}>
                <div className="flex items-start gap-3">
                  <Icon className="h-4 w-4 mt-1 text-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm whitespace-pre-line">{f.message}</p>
                    <p className="text-[11px] text-muted mt-1">#{f.number} · {relative(f.created_at)}</p>
                    {(f.replies || []).map((r, i) => (
                      <div key={i} className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm"><p className="text-[11px] font-semibold text-brand">{r.by} · {relative(r.at)}</p><p className="whitespace-pre-line">{r.text}</p></div>
                    ))}
                  </div>
                  <Badge tone={tone}>{t(label)}</Badge>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
