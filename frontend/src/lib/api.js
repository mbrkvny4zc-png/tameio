// Thin fetch wrapper. Cookies carry the session; errors become readable messages.
import { translate } from "@/lib/i18n";

const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";
const ORG_KEY = "tameio_org";

export const getOrg = () => { try { return localStorage.getItem(ORG_KEY) || ""; } catch { return ""; } };
export const setOrg = (id) => { try { id ? localStorage.setItem(ORG_KEY, id) : localStorage.removeItem(ORG_KEY); } catch { /* ignore */ } };

export class ApiError extends Error {
  constructor(message, status, details = [], data = null) {
    super(translate(message));
    this.status = status;
    this.details = details;
    this.data = data;
  }
}

async function request(method, path, body, { raw = false, org: orgOverride } = {}) {
  const opts = { method, credentials: "include", headers: {} };
  const org = orgOverride || getOrg();
  if (org) opts.headers["X-Org-Id"] = org;
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch {
    throw new ApiError("Can't reach the server — check your connection.", 0);
  }
  if (raw && res.ok) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const d = data?.detail;
    if (res.status === 402) window.dispatchEvent(new CustomEvent("tameio:upgrade", { detail: d }));
    if (res.status === 403 && org && typeof d === "string" && d.includes("access to this business")) { setOrg(""); window.location.reload(); }
    if (typeof d === "string") throw new ApiError(d, res.status);
    if (d && typeof d === "object") throw new ApiError(d.message || "Request failed", res.status, d.errors || [], d);
    if (Array.isArray(data?.detail)) throw new ApiError("Some fields are invalid", res.status);
    throw new ApiError(res.status === 401 ? "Please sign in" : "Something went wrong", res.status);
  }
  return data;
}

export const api = {
  get: (p) => request("GET", p),
  post: (p, b) => request("POST", p, b ?? {}),
  put: (p, b) => request("PUT", p, b ?? {}),
  del: (p) => request("DELETE", p),
  upload: (p, formData) => request("POST", p, formData),
  blob: async (p) => (await request("GET", p, undefined, { raw: true })).blob(),
  /** Act inside a specific business (accountants working across clients). */
  as: (org) => ({
    get: (p) => request("GET", p, undefined, { org }),
    post: (p, b) => request("POST", p, b ?? {}, { org }),
    blob: async (p) => (await request("GET", p, undefined, { raw: true, org })).blob(),
  }),
};

export async function download(path, filename) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function openFile(path) {
  const blob = await api.blob(path);
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
