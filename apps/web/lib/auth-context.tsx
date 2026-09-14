"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicUser } from "@takwimu/shared";
import { authApi, setAccessToken } from "./api";

export interface AuthContextValue {
  loading: boolean;
  user: PublicUser | null;
  ssoEnabled: { google: boolean; microsoft: boolean };
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  loading: true,
  user: null,
  ssoEnabled: { google: false, microsoft: false },
  refresh: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [ssoEnabled, setSsoEnabled] = useState({ google: false, microsoft: false });

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await authApi.me();
      setUser(res.user);
      setSsoEnabled(res.sso);
    } catch {
      setUser(null);
      setSsoEnabled({ google: false, microsoft: false });
      setAccessToken(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const logout = async () => {
    await authApi.logout();
    setUser(null);
    setAccessToken(null);
    window.location.href = "/";
  };

  return (
    <AuthContext.Provider value={{ loading, user, ssoEnabled, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}