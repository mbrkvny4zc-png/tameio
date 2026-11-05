import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  BarChart3, Bookmark, Building2, CalendarClock, Calculator, ClipboardList, FileSignature, FileText, Gauge, Handshake, Inbox, Landmark, LayoutDashboard,
  MessageSquareText, Package, PackageCheck, Receipt, Search, Settings, ShieldCheck, ShoppingCart, Truck, Users,
} from "lucide-react";
import { api } from "@/lib/api";
import { translate as tr } from "@/lib/i18n";
import { useOrg } from "@/lib/org";

// Icons a pin can carry (kept small so we don't bundle the whole icon set).
export const ICONS = { LayoutDashboard, MessageSquareText, FileText, Users, FileSignature, Package, PackageCheck, ClipboardList, Receipt, Inbox, Truck,
  ShoppingCart, Landmark, BarChart3, ShieldCheck, CalendarClock, Settings, Calculator, Handshake, Gauge, Building2, Search, Bookmark };
export const iconName = (Icon) => Object.keys(ICONS).find((k) => ICONS[k] === Icon) || "Bookmark";
export const PIN_TYPE_ICON = { client: "Users", invoice: "FileText", product: "Package", supplier: "Truck", search: "Search", page: "Bookmark", link: "Bookmark" };

const Ctx = createContext(null);
const EMPTY = { nav: { hidden: [], order: {}, main: [], more: [] }, dashboard: { widgets: [] }, pins: [], can_edit: false };

export function LayoutProvider({ children }) {
  const { current } = useOrg();
  const [layout, setLayout] = useState(EMPTY);
  const load = useCallback(() => api.get("/layout").then(setLayout).catch(() => setLayout(EMPTY)), []);
  useEffect(() => { if (current?.id) load(); }, [current?.id, load]);

  const addPin = useCallback(async (pin) => {
    try {
      const r = await api.post("/layout/pins", pin);
      setLayout((l) => ({ ...l, pins: r.pins }));
      toast.success(r.added ? tr("Pinned “{name}”", { name: pin.label }) : tr("Already pinned"));
    } catch (e) { toast.error(e.message); }
  }, []);
  const removePin = useCallback(async (id) => {
    const r = await api.del(`/layout/pins/${id}`).catch(() => null);
    if (r) setLayout((l) => ({ ...l, pins: r.pins }));
  }, []);
  const savePins = useCallback(async (items) => {
    const r = await api.put("/layout/pins", { items });
    setLayout((l) => ({ ...l, pins: r.pins }));
  }, []);
  const saveOrg = useCallback(async (body) => { const r = await api.put("/layout", body); setLayout(r); return r; }, []);
  const resetOrg = useCallback(async (part) => { const r = await api.del(`/layout?part=${part}`); setLayout(r); return r; }, []);
  const value = useMemo(() => ({ layout, addPin, removePin, savePins, saveOrg, resetOrg, reload: load }), [layout, addPin, removePin, savePins, saveOrg, resetOrg, load]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLayout = () => useContext(Ctx) || { layout: EMPTY, addPin: () => {}, removePin: () => {}, savePins: () => {}, saveOrg: () => {}, resetOrg: () => {} };

/** Apply the business's saved menu layout to the default menu. */
export function applyNav(nav, saved) {
  const hidden = new Set(saved?.hidden || []);
  const toMain = new Set(saved?.main || []);
  const toMore = new Set(saved?.more || []);
  return nav.map((g) => {
    const all = [...g.items, ...(g.more || [])];
    const order = saved?.order?.[g.key || "top"] || [];
    const rank = (it) => { const i = order.indexOf(it.to); return i < 0 ? 1000 + all.indexOf(it) : i; };
    const sorted = [...all].sort((a, b) => rank(a) - rank(b)).filter((it) => !hidden.has(it.to));
    const isMore = (it) => (toMain.has(it.to) ? false : toMore.has(it.to) ? true : (g.more || []).includes(it));
    return { ...g, items: sorted.filter((it) => !isMore(it)), more: sorted.filter(isMore) };
  }).filter((g) => g.items.length || g.more.length);
}
