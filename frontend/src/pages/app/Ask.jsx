import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUp, Loader2, MessageSquareText, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { PageHeader, cx } from "@/components/ui";

const STARTERS = [
  "How much did I earn this month?",
  "Who owes me money right now?",
  "What did I spend the most on this quarter?",
  "Was this month better than last month?",
  "How much VAT will I owe for this period?",
  "Which client brought in the most this year?",
];

export default function Ask() {
  const { t } = useT();
  const [q, setQ] = useState("");
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const end = useRef(null);
  const input = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [chat, busy]);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    input.current?.focus();
    const pre = params.get("q");
    if (pre) { setParams({}, { replace: true }); ask(pre); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = async (question) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ("");
    const history = chat.filter((c) => c.a).map((c) => ({ q: c.q, a: c.a }));
    setChat((c) => [...c, { q: text }]);
    setBusy(true);
    try {
      const r = await api.post("/ask", { question: text, history });
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, a: r.answer, highlights: r.highlights, follow: r.follow_ups } : x)));
    } catch (e) {
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, error: e.message } : x)));
    }
    setBusy(false);
  };

  const last = chat[chat.length - 1];
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title={t("Ask Tameio")} subtitle={t("Questions about your own books, answered in plain words. Only your data is used — nothing is guessed.")}
        actions={chat.length > 0 && <button onClick={() => setChat([])} className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"><RotateCcw className="h-4 w-4" />{t("New conversation")}</button>} />

      {chat.length === 0 && (
        <div className="card p-6 sm:p-8">
          <div className="h-11 w-11 rounded-2xl bg-brand-soft text-brand flex items-center justify-center"><MessageSquareText className="h-5 w-5" /></div>
          <p className="font-serif text-2xl mt-4">{t("What would you like to know?")}</p>
          <p className="text-sm text-muted mt-1">{t("Ask in Greek or English. Try one of these:")}</p>
          <div className="mt-5 grid sm:grid-cols-2 gap-2">
            {STARTERS.map((s) => (
              <button key={s} onClick={() => ask(t(s))} className="text-left text-sm rounded-xl border border-line px-4 py-3 hover:bg-surface-2" data-testid="ask-starter">{t(s)}</button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6" data-testid="ask-thread">
        {chat.map((c, i) => (
          <div key={i} className="space-y-3">
            <div className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink text-bg px-4 py-2.5 text-[15px]">{c.q}</p></div>
            {c.a && (
              <div className="card p-5">
                <p className="font-serif text-[19px] leading-relaxed whitespace-pre-line" data-testid="ask-answer">{c.a}</p>
                {c.highlights?.length > 0 && (
                  <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {c.highlights.map((h) => (
                      <div key={h.label} className="rounded-xl bg-surface-2 px-3 py-2"><p className="text-[11px] text-muted">{h.label}</p><p className="num font-bold">{h.value}</p></div>
                    ))}
                  </div>
                )}
                {i === chat.length - 1 && c.follow?.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {c.follow.map((f) => <button key={f} onClick={() => ask(f)} className="text-xs rounded-full border border-line px-3 py-1.5 hover:bg-surface-2">{f}</button>)}
                  </div>
                )}
              </div>
            )}
            {c.error && <p className="text-sm text-danger card p-4">{c.error}</p>}
          </div>
        ))}
        {busy && <div className="card p-5 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{t("Looking through your books…")}</div>}
        <div ref={end} />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className={cx("sticky bottom-24 lg:bottom-6 mt-6", chat.length === 0 && "mt-4")}>
        <div className="card shadow-lift flex items-center gap-2 p-2 pl-4">
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500} placeholder={last?.a ? t("Ask a follow-up…") : t("e.g. How much did I spend on fuel in October?")}
            className="flex-1 bg-transparent outline-none text-[15px] h-10" data-testid="ask-input" />
          <button type="submit" disabled={!q.trim() || busy} className="h-10 w-10 rounded-xl bg-brand text-white flex items-center justify-center disabled:opacity-40" aria-label={t("Ask")} data-testid="ask-send">
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2 px-1">{t("Answers use your invoices, receipts and expenses from the last 24 months. Check important figures with your accountant.")}</p>
      </form>
    </div>
  );
}
