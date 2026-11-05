import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { AtSign, Check, MessageSquare, Pencil, Send, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { relative } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { Button, Sheet, cx } from "@/components/ui";

/** Open the conversation for any record from anywhere: openComments("invoice", id, "INV-0012 · Acme"). An optional draft pre-fills the box. */
export const openComments = (type, id, label = "", draft = "") => window.dispatchEvent(new CustomEvent("tameio:comments", { detail: { type, id, label, draft } }));

/** {record id: count} for list badges; refreshes when a comment is added anywhere. */
export function useCommentCounts(type) {
  const [counts, setCounts] = useState({});
  const load = useCallback(() => api.get(`/comments/counts?target_type=${type}`).then(setCounts).catch(() => {}), [type]);
  useEffect(() => {
    load();
    window.addEventListener("tameio:comments-changed", load);
    return () => window.removeEventListener("tameio:comments-changed", load);
  }, [load]);
  return counts;
}

export function CommentButton({ type, id, label, count = 0 }) {
  const { t } = useT();
  return (
    <button onClick={() => openComments(type, id, label)} className={cx("relative p-2 rounded-lg hover:bg-surface-2", count ? "text-brand" : "text-muted hover:text-ink")}
      title={count ? t("{n} comments", { n: count }) : t("Comment or ask a teammate")} aria-label={t("Comments")} data-testid={`comments-${id}`}>
      <MessageSquare className="h-4 w-4" />
      {count > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-brand text-white text-[10px] font-bold flex items-center justify-center">{count}</span>}
    </button>
  );
}

/** Highlights @Name mentions inside comment text. */
function Body({ text, people }) {
  const names = people.map((p) => p.name).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length) return <p className="text-sm whitespace-pre-line break-words">{text}</p>;
  const re = new RegExp(`(@(?:${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")}))`, "gi");
  return <p className="text-sm whitespace-pre-line break-words">{text.split(re).map((part, i) => (part.startsWith("@") && re.test(part) ? <span key={i} className="text-brand font-semibold">{part}</span> : part))}</p>;
}

/** Text box with @-autocomplete for teammates and the accountant. */
function Composer({ people, onSend, initial = "", onCancel, busyLabel }) {
  const { t } = useT();
  const [text, setText] = useState(initial);
  const [query, setQuery] = useState(null);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const caret = useRef(null);
  // Put the cursor right after an inserted @Name in the same render, so fast typing never lands in the wrong place.
  useLayoutEffect(() => {
    if (caret.current !== null && ref.current) { ref.current.focus(); ref.current.setSelectionRange(caret.current, caret.current); caret.current = null; }
  }, [text]);
  const matches = query === null ? [] : people.filter((p) => `${p.name} ${p.email}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const onChange = (e) => {
    const v = e.target.value;
    setText(v);
    const upto = v.slice(0, e.target.selectionStart);
    const m = upto.match(/(?:^|\s)@([\p{L}\p{N}._-]*)$/u);
    setQuery(m ? m[1] : null); setSel(0);
  };
  const choose = (p) => {
    const el = ref.current;
    const pos = el.selectionStart;
    const before = text.slice(0, pos).replace(/@([\p{L}\p{N}._-]*)$/u, `@${p.name} `);
    caret.current = before.length;
    setText(before + text.slice(pos));
    setQuery(null);
  };
  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try { await onSend(text, people.filter((p) => p.name && text.includes(`@${p.name}`)).map((p) => p.id)); setText(""); }
    catch (e) { toast.error(e.message); }
    setBusy(false);
  };
  const onKey = (e) => {
    if (matches.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % matches.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + matches.length) % matches.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); choose(matches[sel]); return; }
      if (e.key === "Escape") { setQuery(null); return; }
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
  };
  return (
    <div className="relative">
      {matches.length > 0 && (
        <div className="absolute bottom-full mb-2 left-0 w-72 card shadow-lift p-1.5 z-10" data-testid="mention-picker">
          {matches.map((p, i) => (
            <button key={p.id} onMouseDown={(e) => { e.preventDefault(); choose(p); }} className={cx("w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left", i === sel && "bg-surface-2")}>
              <span className="h-7 w-7 rounded-full bg-brand-soft text-brand text-xs font-bold flex items-center justify-center">{(p.name || "?")[0]}</span>
              <span className="flex-1 min-w-0"><span className="block truncate font-medium">{p.name}</span><span className="block truncate text-[11px] text-muted">{t(p.role === "accountant" ? "Accountant" : p.role === "owner" ? "Owner" : p.role === "admin" ? "Admin" : "Staff")} · {p.email}</span></span>
            </button>
          ))}
        </div>
      )}
      <textarea ref={ref} value={text} onChange={onChange} onKeyDown={onKey} rows={3} className="input h-auto py-2.5 resize-none" data-testid="comment-input"
        placeholder={t("Write a comment… type @ to mention someone")} />
      <div className="flex items-center gap-2 mt-2">
        <button type="button" onClick={() => { const next = `${text}${text && !text.endsWith(" ") ? " " : ""}@`; caret.current = next.length; setText(next); setQuery(""); }}
          className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface-2" aria-label={t("Mention someone")}><AtSign className="h-4 w-4" /></button>
        <span className="text-[11px] text-muted">{t("Ctrl + Enter to send")}</span>
        {onCancel && <Button size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>{t("Cancel")}</Button>}
        <Button size="sm" className={onCancel ? "" : "ml-auto"} onClick={submit} loading={busy} disabled={!text.trim()} data-testid="comment-send"><Send className="h-3.5 w-3.5" />{busyLabel || t("Send")}</Button>
      </div>
    </div>
  );
}

/** One panel for the whole app; any page opens it with openComments(). */
export function CommentsPanel() {
  const { t } = useT();
  const [target, setTarget] = useState(null);
  const [data, setData] = useState(null);
  const [people, setPeople] = useState([]);
  const [editing, setEditing] = useState(null);
  const end = useRef(null);
  const load = useCallback(async (tg) => {
    try { setData(await api.get(`/comments?target_type=${tg.type}&target_id=${tg.id}`)); }
    catch (e) { toast.error(e.message); setTarget(null); }
  }, []);
  useEffect(() => {
    const h = (e) => { setTarget(e.detail); setData(null); setEditing(null); load(e.detail); api.get("/comments/people").then(setPeople).catch(() => {}); };
    window.addEventListener("tameio:comments", h); return () => window.removeEventListener("tameio:comments", h);
  }, [load]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [data]);
  const changed = () => { load(target); window.dispatchEvent(new Event("tameio:comments-changed")); };
  const post = async (text, mentions) => {
    await api.post("/comments", { target_type: target.type, target_id: target.id, text, mentions });
    if (mentions.length) toast.success(mentions.length === 1 ? t("Sent — 1 person notified") : t("Sent — {n} people notified", { n: mentions.length }));
    changed();
  };
  const save = async (c, text, mentions) => { await api.put(`/comments/${c.id}`, { text, mentions }); setEditing(null); changed(); };
  const del = async (c) => { if (window.confirm(t("Delete this comment?"))) { await api.del(`/comments/${c.id}`).catch((e) => toast.error(e.message)); changed(); } };
  const done = async (c, v) => { await api.post(`/mentions/${c.id}/done`, { done: v }); changed(); window.dispatchEvent(new Event("tameio:mentions-changed")); };
  if (!target) return null;
  const everyone = [...people, ...(data?.comments || []).map((c) => ({ id: c.author_id, name: c.author_name }))];
  return (
    <Sheet open onClose={() => setTarget(null)} title={data?.target.label || target.label || t("Comments")} description={t("Questions and notes about this record. Mention a teammate or your accountant with @.")} width="max-w-lg"
      footer={<div className="w-full"><Composer key={`${target.type}:${target.id}`} people={people} onSend={post} initial={target.draft || ""} /></div>}>
      <div className="space-y-4" data-testid="comments-thread">
        {!data ? <p className="text-sm text-muted">{t("Loading…")}</p> : data.comments.length === 0 ? (
          <div className="text-center py-10 text-sm text-muted"><MessageSquare className="h-7 w-7 mx-auto mb-2 text-brand" />{t("No comments yet. Ask a question, leave a note, or @mention someone.")}</div>
        ) : data.comments.map((c) => (
          <div key={c.id} className={cx("flex gap-3", c.mine && "flex-row-reverse")}>
            <span className={cx("h-8 w-8 rounded-full text-xs font-bold flex items-center justify-center shrink-0", c.mine ? "bg-ink text-bg" : "bg-brand-soft text-brand")}>{(c.author_name || "?")[0]}</span>
            <div className={cx("max-w-[85%] min-w-0", c.mine && "text-right")}>
              <p className="text-[11px] text-muted">{c.mine ? t("You") : c.author_name} · {relative(c.created_at)}{c.edited_at ? ` · ${t("edited")}` : ""}</p>
              {editing === c.id ? (
                <div className="mt-1 text-left w-80 max-w-full"><Composer people={people} initial={c.text} onSend={(tx, m) => save(c, tx, m)} onCancel={() => setEditing(null)} busyLabel={t("Save")} /></div>
              ) : (
                <div className={cx("mt-1 inline-block text-left rounded-2xl px-3.5 py-2.5", c.mine ? "bg-surface-2 rounded-tr-md" : "bg-surface border border-line rounded-tl-md", c.mentions_me && !c.done && "ring-2 ring-brand/30")}>
                  <Body text={c.text} people={everyone} />
                </div>
              )}
              <div className={cx("flex gap-1 mt-1", c.mine ? "justify-end" : "")}>
                {c.mentions_me && (c.done
                  ? <button onClick={() => done(c, false)} className="text-[11px] text-success font-semibold inline-flex items-center gap-1"><Check className="h-3 w-3" />{t("Done")}</button>
                  : <button onClick={() => done(c, true)} className="text-[11px] text-brand font-semibold" data-testid={`mention-done-${c.id}`}>{t("Mark done")}</button>)}
                {c.mine && editing !== c.id && <button onClick={() => setEditing(c.id)} className="p-1 text-muted hover:text-ink" aria-label={t("Edit")}><Pencil className="h-3 w-3" /></button>}
                {c.mine && <button onClick={() => del(c)} className="p-1 text-muted hover:text-danger" aria-label={t("Delete")}><Trash2 className="h-3 w-3" /></button>}
              </div>
            </div>
          </div>
        ))}
        {data && <Link to={data.target.page} onClick={() => setTarget(null)} className="block text-center text-xs text-muted hover:text-ink pt-2">{t("Go to the page")} →</Link>}
        <div ref={end} />
      </div>
    </Sheet>
  );
}
