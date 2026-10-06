"use client";

import { BrandMark } from "@/components/app/sidebar";
import { useSession } from "@/lib/session";

export function AuthFrame({ children }: { children: React.ReactNode }) {
  const { brand } = useSession();
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-1/2 top-[-20%] h-[520px] w-[920px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_22%,transparent),transparent)] blur-2xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_70%)] opacity-60" />
      </div>
      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex justify-center"><BrandMark name={brand?.dashboard_name} /></div>
        <div className="hairline-top overflow-hidden rounded-[18px] border border-border bg-elevated/90 p-7 shadow-[var(--shadow-lg)] backdrop-blur">
          {children}
        </div>
        <p className="mt-6 text-center text-[12px] text-fg-3">{brand?.store_name ?? "Nexa"} · Secure admin access</p>
      </div>
    </div>
  );
}
