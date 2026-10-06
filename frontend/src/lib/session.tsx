"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { api } from "./api";
import type { Admin } from "./types";
import { setCurrency } from "./utils";

interface PublicSettings {
  store_name: string; dashboard_name: string; accent: string; default_theme: "dark" | "light";
  logo_media_id?: string | null; favicon_media_id?: string | null; currency: string; currency_symbol?: string | null; timezone?: string;
}

const SessionCtx = React.createContext<{ admin: Admin | null; loading: boolean; can: (p: string) => boolean; brand?: PublicSettings; refresh: () => void }>({
  admin: null, loading: true, can: () => false, refresh: () => {},
});

export function usePublicSettings() {
  return useQuery({ queryKey: ["settings", "public"], queryFn: () => api.get<PublicSettings>("/settings/public"), staleTime: 60_000 });
}

export function applyAccent(accent?: string) {
  if (typeof document === "undefined" || !accent || !/^#[0-9a-f]{6}$/i.test(accent)) return;
  const root = document.documentElement;
  root.style.setProperty("--accent", accent);
  const n = parseInt(accent.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  root.style.setProperty("--accent-fg", lum > 0.62 ? "#0b0b0d" : "#ffffff");
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["auth", "me"], queryFn: () => api.get<Admin>("/auth/me"), retry: false, staleTime: 60_000 });
  const brand = usePublicSettings();
  React.useEffect(() => {
    if (brand.data) {
      applyAccent(brand.data.accent);
      setCurrency(brand.data.currency, brand.data.currency_symbol);
      document.title = brand.data.dashboard_name || "Dashboard";
    }
  }, [brand.data]);
  const admin = me.data ?? null;
  const perms = React.useMemo(() => new Set(admin?.permissions ?? []), [admin]);
  const value = React.useMemo(() => ({
    admin, loading: me.isLoading, brand: brand.data,
    can: (p: string) => !!admin && (admin.is_owner || perms.has(p)),
    refresh: () => qc.invalidateQueries({ queryKey: ["auth", "me"] }),
  }), [admin, me.isLoading, brand.data, perms, qc]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  return React.useContext(SessionCtx);
}
