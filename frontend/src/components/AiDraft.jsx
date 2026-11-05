import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Modal, Textarea } from "@/components/ui";

const EXAMPLES = [
  "Invoice Kafeneio Plaka for 3 hours of electrical work and 2 sockets at €12.40, due in 15 days",
  "Receipt: 2 koulouria and a coffee, cash",
  "Quote for Studio Lefko: website redesign €1,800 plus hosting €15/month",
];

/** "Write the invoice for me": one sentence in, a pre-filled editor out. Nothing is issued until the user saves. */
export function AiDraft() {
  const { t } = useT();
  const go = useNavigate();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const h = () => { setText(""); setOpen(true); };
    window.addEventListener("tameio:ai-draft", h); return () => window.removeEventListener("tameio:ai-draft", h);
  }, []);
  const run = async () => {
    setBusy(true);
    try {
      const d = await api.post("/ai/draft-invoice", { text });
      sessionStorage.setItem("tameio_draft", JSON.stringify(d));
      setOpen(false);
      go(d.doc_kind === "quote" ? "/app/quotes?draft=1" : "/app/invoices?draft=1");
    } catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t("Write with AI")} description={t("Describe the sale in your own words, in Greek or English. You'll check everything before it's issued.")}
      footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{t("Cancel")}</Button><Button onClick={run} loading={busy} disabled={!text.trim()} data-testid="ai-draft-run"><Sparkles className="h-4 w-4" />{t("Draft it")}</Button></>}>
      <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={1000} data-testid="ai-draft-text"
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim()) run(); }}
        placeholder={t("e.g. Invoice Kafeneio Plaka for 3 hours of work and 2 sockets, due in 15 days")} />
      <div className="mt-3 space-y-1.5">
        {EXAMPLES.map((x) => <button key={x} onClick={() => setText(t(x))} className="block text-left text-xs text-muted hover:text-ink">→ {t(x)}</button>)}
      </div>
    </Modal>
  );
}
