// Cookie / device-storage consent (ePrivacy: Greek law 3471/2006 art. 4(5); GDPR).
// Strictly necessary storage (sign-in, language, your own settings) needs no consent.
// Optional storage — today only remembering an accounting firm's referral link for 60 days — waits for a "yes".
const KEY = "tameio_consent";
export const CONSENT_VERSION = 1;
export const OPTIONAL = ["referral"]; // add "analytics" here if analytics are ever introduced (and list them in the cookie policy)

export function getConsent() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!v || v.v !== CONSENT_VERSION || Date.now() - v.at > 365 * 864e5) return null; // ask again after 12 months
    return v;
  } catch { return null; }
}

export const hasConsent = (cat) => !!getConsent()?.choices?.[cat];

export function setConsent(choices) {
  const v = { v: CONSENT_VERSION, at: Date.now(), choices: Object.fromEntries(OPTIONAL.map((k) => [k, !!choices[k]])) };
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* storage blocked: we simply ask again next time */ }
  window.dispatchEvent(new CustomEvent("tameio:consent", { detail: v }));
  return v;
}

/** Re-open the banner (e.g. from "Cookie settings" in the footer). */
export const openConsent = () => window.dispatchEvent(new Event("tameio:consent-open"));
