"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { NAV } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

export function BrandMark({ name }: { name?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative flex size-7 items-center justify-center overflow-hidden rounded-[8px] bg-accent text-accent-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_4px_14px_-4px_var(--accent)]">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 19V5l14 14V5" />
        </svg>
      </div>
      <span className="truncate text-[14px] font-semibold tracking-[-0.02em]">{name ?? "Nexa"}</span>
    </div>
  );
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { can } = useSession();
  const tickets = useQuery({
    queryKey: ["tickets", "badge"], enabled: can("support.view"), refetchInterval: 60_000,
    queryFn: () => api.get<{ unread: number }>("/support/tickets", { page_size: 1 }),
  });
  const pending = useQuery({
    queryKey: ["orders", "badge"], enabled: can("orders.view"), refetchInterval: 60_000,
    queryFn: () => api.get<{ total: number }>("/orders", { page_size: 1, status: "awaiting_confirmation,processing" }),
  });
  const badges: Record<string, number | undefined> = { "/support": tickets.data?.unread, "/orders": pending.data?.total };

  return (
    <nav className="flex flex-col gap-5 px-3 pb-6">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.perm || can(i.perm));
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-fg-3/80">{group.label}</div>
            <ul className="flex flex-col gap-px">
              {items.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname === item.href || pathname.startsWith(item.href + "/");
                const badge = badges[item.href];
                return (
                  <li key={item.href}>
                    <Link href={item.href} onClick={onNavigate}
                      className={cn("group relative flex h-8 items-center gap-2.5 rounded-[8px] px-2 text-[13px] font-medium text-fg-2 transition-colors hover:bg-hover hover:text-fg",
                        active && "bg-active text-fg")}>
                      {active ? <span className="absolute -left-3 top-1.5 h-5 w-[3px] rounded-r-full bg-accent" /> : null}
                      <item.icon className={cn("size-4 shrink-0 text-fg-3 transition-colors group-hover:text-fg-2", active && "text-accent group-hover:text-accent")} strokeWidth={2} />
                      <span className="truncate">{item.label}</span>
                      {badge ? (
                        <span className="ml-auto rounded-full bg-accent/15 px-1.5 text-[11px] font-semibold tabular text-accent">{badge > 99 ? "99+" : badge}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
