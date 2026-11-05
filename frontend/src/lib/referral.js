// Referral code from an accounting firm's link (/r/CODE).
// With consent it's remembered for 60 days on this device; without, only for this visit (sessionStorage).
import { hasConsent } from "@/lib/consent";

const KEY = "tameio_ref";
const DAYS = 60;

const read = (store) => { try { return JSON.parse(store.getItem(KEY) || "null"); } catch { return null; } };

export function saveRef(code) {
  const v = JSON.stringify({ code: String(code).toUpperCase(), at: Date.now() });
  try { (hasConsent("referral") ? localStorage : sessionStorage).setItem(KEY, v); } catch { /* storage blocked */ }
}

export function getRef() {
  const v = read(localStorage) || read(sessionStorage);
  if (!v || Date.now() - v.at > DAYS * 864e5) return "";
  return v.code || "";
}

export function clearRef() {
  try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Called when consent changes: keep the visit's code for 60 days, or forget the long-term copy. */
export function applyRefConsent(allowed) {
  try {
    if (allowed) { const v = sessionStorage.getItem(KEY); if (v) { localStorage.setItem(KEY, v); sessionStorage.removeItem(KEY); } }
    else { const v = localStorage.getItem(KEY); if (v) { sessionStorage.setItem(KEY, v); localStorage.removeItem(KEY); } }
  } catch { /* ignore */ }
}
