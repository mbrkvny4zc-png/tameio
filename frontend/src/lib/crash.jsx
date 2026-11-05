import { Component } from "react";

// Sends unexpected errors to the creator's management area, at most once per message per page view.
const sent = new Set();
export function reportCrash(message, stack = "") {
  const key = String(message).slice(0, 200);
  if (!key || sent.has(key) || sent.size > 20) return;
  sent.add(key);
  try {
    fetch(`${import.meta.env.VITE_API_URL || ""}/api/errors`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, keepalive: true,
      body: JSON.stringify({ message: key, stack: String(stack || "").slice(0, 8000), page: location.pathname, user_agent: navigator.userAgent }),
    }).catch(() => {});
  } catch { /* never let reporting break the app */ }
}

export function installCrashReporter() {
  window.addEventListener("error", (e) => {
    if (!e.message || /ResizeObserver loop/.test(e.message)) return; // harmless browser noise
    reportCrash(e.message, e.error?.stack);
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    if (r && typeof r.status === "number" && r.status < 500) return; // API "you did something wrong" answers and offline aren't crashes
    reportCrash(r?.message || String(r), r?.stack);
  });
}

/** Catches a crashing screen, reports it, and offers a way back instead of a blank page. */
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { reportCrash(error?.message || "Render error", `${error?.stack || ""}\n${info?.componentStack || ""}`); }
  render() {
    if (!this.state.error) return this.props.children;
    const el = (document.documentElement.lang || "en") === "el";
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center gap-3 px-6">
        <p className="font-serif text-3xl">{el ? "Κάτι πήγε στραβά" : "Something went wrong"}</p>
        <p className="text-muted max-w-md">{el ? "Το πρόβλημα αναφέρθηκε αυτόματα και θα το διορθώσουμε. Δοκιμάστε να ανανεώσετε τη σελίδα." : "The problem was reported automatically and we'll fix it. Try reloading the page."}</p>
        <div className="flex gap-2 mt-2">
          <button onClick={() => location.reload()} className="h-10 px-4 rounded-xl bg-brand text-white font-semibold text-sm">{el ? "Ανανέωση" : "Reload"}</button>
          <a href="/app/feedback" className="h-10 px-4 rounded-xl border border-line font-semibold text-sm inline-flex items-center">{el ? "Περιγράψτε τι έγινε" : "Tell us what happened"}</a>
        </div>
      </div>
    );
  }
}
