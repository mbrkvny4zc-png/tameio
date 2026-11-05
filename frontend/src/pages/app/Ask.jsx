import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowUp, ExternalLink, Landmark, Loader2, MessageSquareText, RotateCcw, UserRound } from "lucide-react";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { openComments } from "@/components/Comments";
import { PageHeader, Segmented, cx } from "@/components/ui";

const STARTERS = {
  books: [
    "How much did I earn this month?",
    "Who owes me money right now?",
    "What did I spend the most on this quarter?",
    "Was this month better than last month?",
    "How much VAT will I owe for this period?",
    "Which client brought in the most this year?",
  ],
  tax: [
    "When must I send an invoice to myDATA?",
    "Which VAT rates apply in Greece and to what?",
    "When do I add stamp duty to an invoice?",
    "When is 20% withholding tax deducted from a fee?",
    "Do I need a delivery note when moving goods to a customer?",
    "When is the next VAT return due?",
  ],
};

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Plain-language questions — about your own books, or about Greek tax rules (searched live on Taxheaven and official sites). */
export default function Ask() {
  const { t } = useT();
  const [params, setParams] = useSearchParams();
  const [mode, setMode] = useState(params.get("mode") === "tax" ? "tax" : "books");
  const [q, setQ] = useState("");
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState([]);
  const end = useRef(null);
  const input = useRef(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [chat, busy]);
  useEffect(() => { api.get("/comments/people").then(setPeople).catch(() => {}); }, []);
  useEffect(() => {
    input.current?.focus();
    const pre = params.get("q");
    if (pre) { setParams({}, { replace: true }); ask(pre, params.get("mode") === "tax" ? "tax" : "books"); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = (m) => { if (m !== mode) { setMode(m); setChat([]); input.current?.focus(); } };

  const ask = async (question, m = mode) => {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setQ("");
    const history = chat.filter((c) => c.a).map((c) => ({ q: c.q, a: c.a }));
    setChat((c) => [...c, { q: text, mode: m }]);
    setBusy(true);
    try {
      const r = await api.post(m === "tax" ? "/ask/tax" : "/ask", { question: text, history });
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, a: r.answer, id: r.id, sources: r.sources, highlights: r.highlights, follow: r.follow_ups } : x)));
    } catch (e) {
      setChat((c) => c.map((x, i) => (i === c.length - 1 ? { ...x, error: e.message } : x)));
    }
    setBusy(false);
  };

  const accountants = people.filter((p) => p.role === "accountant" && p.name);
  const askAccountant = (c) => {
    const tag = accountants.map((p) => `@${p.name}`).join(" ");
    openComments("question", c.id, c.q, `${tag ? tag + " " : ""}${t("Can you confirm this applies to us?")}\n\n${t("Tameio's answer")}: ${c.a.slice(0, 1500)}`);
  };

  const tax = mode === "tax";
  const last = chat[chat.length - 1];
  return (
    <div className="animate-in max-w-3xl">
      <PageHeader title={t("Ask Tameio")}
        subtitle={tax ? t("Questions about Greek tax and invoicing rules, answered from Taxheaven and official sources — with links so you can check.")
          : t("Questions about your own books, answered in plain words. Only your data is used — nothing is guessed.")}
        actions={chat.length > 0 && <button onClick={() => setChat([])} className="text-sm text-muted hover:text-ink inline-flex items-center gap-1.5"><RotateCcw className="h-4 w-4" />{t("New conversation")}</button>} />

      <Segmented className="mb-4" value={mode} onChange={switchMode} options={[["books", "My numbers"], ["tax", "Tax question"]]} />

      {chat.length === 0 && (
        <div className="card p-6 sm:p-8">
          <div className="h-11 w-11 rounded-2xl bg-brand-soft text-brand flex items-center justify-center">{tax ? <Landmark className="h-5 w-5" /> : <MessageSquareText className="h-5 w-5" />}</div>
          <p className="font-serif text-2xl mt-4">{tax ? t("What rule do you want to check?") : t("What would you like to know?")}</p>
          <p className="text-sm text-muted mt-1">{tax ? t("We search Taxheaven, ΑΑΔΕ, gov.gr and the laws live, then explain in plain words. Try one of these:") : t("Ask in Greek or English. Try one of these:")}</p>
          <div className="mt-5 grid sm:grid-cols-2 gap-2">
            {STARTERS[mode].map((s) => (
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
                {c.mode === "tax" && (
                  <>
                    {c.sources?.length > 0 && (
                      <div className="mt-4" data-testid="ask-sources">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{t("Sources")}</p>
                        <ul className="mt-1.5 space-y-1">
                          {c.sources.map((s) => (
                            <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm text-brand hover:underline inline-flex items-start gap-1.5">
                              <ExternalLink className="h-3.5 w-3.5 mt-0.5 shrink-0" /><span><span className="text-muted">{host(s.url)}</span> · {s.title}</span></a></li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="mt-4 rounded-xl bg-surface-2 border border-line px-3.5 py-3 text-[13px] flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="flex-1 min-w-[200px]">{t("This is general information from public sources, not advice for your business. Confirm with your accountant before you act on it.")}</span>
                      {c.id && <button onClick={() => askAccountant(c)} className="h-8 px-3 rounded-lg bg-ink text-bg text-xs font-semibold inline-flex items-center gap-1.5" data-testid="ask-accountant"><UserRound className="h-3.5 w-3.5" />{t("Ask my accountant")}</button>}
                    </div>
                  </>
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
        {busy && <div className="card p-5 flex items-center gap-2 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" />{tax ? t("Searching Taxheaven and official sources…") : t("Looking through your books…")}</div>}
        <div ref={end} className="scroll-mb-48 lg:scroll-mb-28" />
      </div>

      <form onSubmit={(e) => { e.preventDefault(); ask(); }} className={cx("sticky bottom-24 lg:bottom-6 mt-6", chat.length === 0 && "mt-4")}>
        <div className="card shadow-lift flex items-center gap-2 p-2 pl-4">
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} maxLength={500}
            placeholder={last?.a ? t("Ask a follow-up…") : tax ? t("e.g. Which VAT rate applies to LED panels?") : t("e.g. How much did I spend on fuel in October?")}
            className="flex-1 bg-transparent outline-none text-[15px] h-10" data-testid="ask-input" />
          <button type="submit" disabled={!q.trim() || busy} className="h-10 w-10 rounded-xl bg-brand text-white flex items-center justify-center disabled:opacity-40" aria-label={t("Ask")} data-testid="ask-send">
            <ArrowUp className="h-5 w-5" />
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2 px-1">{tax ? t("Searches taxheaven.gr, aade.gr, gov.gr and the official laws. Takes up to a minute.")
          : t("Answers use your invoices, receipts and expenses from the last 24 months. Check important figures with your accountant.")}</p>
      </form>
    </div>
  );
}
