import { createContext, Fragment, useCallback, useContext, useEffect, useState } from "react";
import EL from "@/locales/el";

// English is the source language: t("Save") returns the Greek string when Greek is on, or the English
// one when there is no translation yet. Variables: t("{n} invoices", { n: 3 }).
const LangCtx = createContext({ lang: "en", setLang: () => {}, t: (s) => s });

const initial = () => {
  try { const saved = localStorage.getItem("tameio_lang"); if (saved === "el" || saved === "en") return saved; } catch { /* storage blocked */ }
  return (navigator.language || "").toLowerCase().startsWith("el") ? "el" : "en";
};

let current = initial();
export const getLang = () => current;
export const translate = (s, vars) => {
  if (typeof s !== "string") return s;
  let out = current === "el" && EL[s] ? EL[s] : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, v);
  return out;
};

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(current);
  const setLang = useCallback((l) => {
    current = l;
    try { localStorage.setItem("tameio_lang", l); } catch { /* ignore */ }
    setLangState(l);
  }, []);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  const t = useCallback((s, vars) => translate(s, vars), [lang]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-mount on language change so text rendered with translate() outside hooks updates too.
  return <LangCtx.Provider value={{ lang, setLang, t }}><Fragment key={lang}>{children}</Fragment></LangCtx.Provider>;
}

export const useT = () => useContext(LangCtx);

export function LangToggle({ className = "" }) {
  const { lang, setLang } = useT();
  return (
    <div className={`inline-flex p-0.5 rounded-lg bg-surface-2 border border-line text-[11px] font-semibold ${className}`} role="group" aria-label="Language">
      {[["el", "ΕΛ"], ["en", "EN"]].map(([k, l]) => (
        <button key={k} onClick={() => setLang(k)} aria-pressed={lang === k}
          className={`px-2 h-6 rounded-md ${lang === k ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"}`}>{l}</button>
      ))}
    </div>
  );
}
