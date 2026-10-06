"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, CheckCheck, CircleCheck, Info, OctagonAlert } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { EmptyState, Popover, PopoverContent, PopoverTrigger, Segmented, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { cn, timeAgo } from "@/lib/utils";

export interface NotificationRow {
  id: number; type: string; severity: string; title: string; body?: string | null; link?: string | null; created_at: string; read: boolean;
}

export const severityIcon: Record<string, React.ReactNode> = {
  info: <Info className="size-4 text-info" />, success: <CircleCheck className="size-4 text-success" />,
  warning: <AlertTriangle className="size-4 text-warning" />, critical: <OctagonAlert className="size-4 text-danger" />,
};

export function NotificationBell() {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const count = useQuery({ queryKey: ["notifications", "count"], queryFn: () => api.get<{ unread: number }>("/notifications/unread-count"), refetchInterval: 60_000 });
  const list = useQuery({
    queryKey: ["notifications", "list", filter], enabled: open,
    queryFn: () => api.get<{ items: NotificationRow[]; unread: number }>("/notifications", { page_size: 30, unread: filter === "unread" || undefined }),
  });
  const markRead = useMutation({
    mutationFn: (ids: number[] | null) => api.post("/notifications/read", { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const unread = count.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell />
          {unread > 0 ? (
            <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-4 text-accent-fg ring-2 ring-bg">
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(400px,calc(100vw-24px))] p-0">
        <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
          <span className="text-[13px] font-semibold">Notifications</span>
          <div className="flex items-center gap-1.5">
            <Segmented value={filter} onChange={setFilter} options={[{ value: "all", label: "All" }, { value: "unread", label: "Unread" }]} />
            <Button size="icon-sm" variant="ghost" aria-label="Mark all as read" title="Mark all as read" onClick={() => markRead.mutate(null)} disabled={!unread}>
              <CheckCheck />
            </Button>
          </div>
        </div>
        <div className="max-h-[420px] overflow-y-auto p-1">
          {list.isLoading ? (
            <div className="space-y-3 p-3">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : !list.data?.items.length ? (
            <EmptyState icon={<Bell />} title={filter === "unread" ? "All caught up" : "No notifications yet"} className="py-10" />
          ) : (
            list.data.items.map((n) => {
              const inner = (
                <div className={cn("flex gap-3 rounded-[9px] px-2.5 py-2.5 transition-colors hover:bg-hover", !n.read && "bg-accent/[0.05]")}>
                  <div className="mt-0.5">{severityIcon[n.severity] ?? severityIcon.info}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className={cn("truncate text-[13px]", n.read ? "text-fg-2" : "font-medium text-fg")}>{n.title}</p>
                      <span className="shrink-0 text-[11px] text-fg-3">{timeAgo(n.created_at)}</span>
                    </div>
                    {n.body ? <p className="mt-0.5 line-clamp-2 text-[12.5px] text-fg-3">{n.body}</p> : null}
                  </div>
                  {!n.read ? <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" /> : null}
                </div>
              );
              const onClick = () => { if (!n.read) markRead.mutate([n.id]); setOpen(false); };
              return n.link ? <Link key={n.id} href={n.link} onClick={onClick} className="block">{inner}</Link> : <button key={n.id} type="button" onClick={onClick} className="block w-full text-left">{inner}</button>;
            })
          )}
        </div>
        <div className="border-t border-border p-1.5">
          <Link href="/notifications" onClick={() => setOpen(false)} className="flex h-8 items-center justify-center rounded-[8px] text-[12.5px] font-medium text-fg-2 hover:bg-hover hover:text-fg">
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
