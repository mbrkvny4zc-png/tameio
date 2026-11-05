// Referral code from an accounting firm's link (/r/CODE), remembered for 60 days on this device.
const KEY = "tameio_ref";
const DAYS = 60;

export function saveRef(code) {
  try { localStorage.setItem(KEY, JSON.stringify({ code: String(code).toUpperCase(), at: Date.now() })); } catch { /* storage blocked */ }
}

export function getRef() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (!v || Date.now() - v.at > DAYS * 864e5) return "";
    return v.code || "";
  } catch { return ""; }
}

export function clearRef() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
