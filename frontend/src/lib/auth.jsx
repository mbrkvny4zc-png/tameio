import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, setOrg } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out

  const refresh = useCallback(async () => {
    try { setUser((await api.get("/auth/me")).user); } catch { setUser(null); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password, code) => setUser((await api.post("/auth/login", { email, password, ...(code ? { code } : {}) })).user);
  const signup = async (payload) => setUser((await api.post("/auth/signup", payload)).user);
  const logout = async () => { try { await api.post("/auth/logout"); } finally { setOrg(""); setUser(null); } };

  return <AuthCtx.Provider value={{ user, login, signup, logout, refresh }}>{children}</AuthCtx.Provider>;
}

export const useAuth = () => useContext(AuthCtx);
