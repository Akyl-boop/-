"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import * as React from "react";

/** Filters stored in the URL (shareable links, back button works). */
export function useUrlState<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const state = React.useMemo(() => {
    const out = { ...defaults } as Record<string, string>;
    for (const k of Object.keys(defaults)) {
      const v = sp.get(k);
      if (v !== null) out[k] = v;
    }
    return out as T;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp]);
  const set = React.useCallback((patch: Partial<T>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === "" || v === defaults[k]) next.delete(k);
      else next.set(k, String(v));
    }
    if (!("page" in patch) && "page" in defaults) next.delete("page");
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, router, pathname]);
  return [state, set];
}
