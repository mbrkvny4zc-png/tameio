// Thin fetch wrapper. Cookies carry the session; errors become readable messages.
const BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "") + "/api";

export class ApiError extends Error {
  constructor(message, status, details = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, body, { raw = false } = {}) {
  const opts = { method, credentials: "include", headers: {} };
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
