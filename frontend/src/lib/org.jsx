import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, getOrg, setOrg } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const OrgCtx = createContext(null);

export function OrgProvider({ children }) {
  const { user } = useAuth();
  const [orgs, setOrgs] = useState(null);
  const load = useCallback(async () => {
    if (!user) { setOrgs(null); return; }
    try { setOrgs(await api.get("/orgs")); } catch { setOrgs([]); }
  }, [user]);
  useEffect(() => { load(); }, [load]);

  const selected = getOrg();
  const current = orgs && (orgs.find((o) => o.id === selected) || orgs.find((o) => o.is_default) || orgs[0]);
  const switchTo = (id, path) => {
    setOrg(id);
    window.location.assign(path || "/app");
  };
  const isAccountant = user?.account_type === "accountant" || !!orgs?.some((o) => o.role === "accountant");
  return <OrgCtx.Provider value={{ orgs, current, switchTo, reload: load, isAccountant }}>{children}</OrgCtx.Provider>;
}

export const useOrg = () => useContext(OrgCtx);
