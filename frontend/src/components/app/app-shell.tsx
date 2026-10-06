"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronsUpDown, LogOut, Menu, Moon, Search, Sun, User, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Dropdown, DropdownContent, DropdownItem, DropdownLabel, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Avatar, Kbd, Spinner, Tooltip } from "@/components/ui/misc";
import { useEventStream } from "@/hooks/use-events";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { CommandPalette, CommandPaletteCtx } from "./command-palette";
import { NotificationBell } from "./notification-bell";
import { BrandMark, SidebarNav } from "./sidebar";

function SearchTrigger() {
  const { open } = React.useContext(CommandPaletteCtx);
  return (
    <button type="button" onClick={open}
      className="group flex h-8 w-full max-w-[420px] items-center gap-2 rounded-[9px] border border-border bg-surface-2/50 px-2.5 text-[13px] text-fg-3 transition-colors hover:border-border-strong hover:text-fg-2">
      <Search className="size-4" />
      <span className="flex-1 truncate text-left">Search or jump to…</span>
      <span className="hidden items-center gap-0.5 sm:flex"><Kbd>⌘</Kbd><Kbd>K</Kbd></span>
    </button>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { admin, loading, brand } = useSession();
  const { theme, toggle } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const live = useEventStream(!!admin);

  React.useEffect(() => {
    if (!loading && !admin) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, admin, router, pathname]);

  const logout = React.useCallback(async () => {
    try { await api.post("/auth/logout"); } catch { /* already logged out */ }
    qc.clear();
    router.replace("/login");
  }, [qc, router]);

  if (loading || !admin) {
    return <div className="flex h-dvh items-center justify-center"><Spinner className="size-5" /></div>;
  }

  const userMenu = (
    <Dropdown>
      <DropdownTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2.5 rounded-[9px] p-1.5 text-left transition-colors hover:bg-hover">
          <Avatar name={admin.name} size={28} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{admin.name}</div>
            <div className="truncate text-[11.5px] text-fg-3">{admin.role.name}</div>
          </div>
          <ChevronsUpDown className="size-3.5 text-fg-3" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start" side="top" className="w-[220px]">
        <DropdownLabel>{admin.email}</DropdownLabel>
        <DropdownItem icon={<User />} onSelect={() => router.push("/profile")}>Account & security</DropdownItem>
        <DropdownItem icon={theme === "dark" ? <Sun /> : <Moon />} onSelect={toggle}>{theme === "dark" ? "Light theme" : "Dark theme"}</DropdownItem>
        <DropdownSeparator />
        <DropdownItem icon={<LogOut />} danger onSelect={logout}>Sign out</DropdownItem>
      </DropdownContent>
    </Dropdown>
  );

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center px-4">
        <Link href="/" onClick={onNavigate}><BrandMark name={brand?.dashboard_name} /></Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pt-1"><SidebarNav onNavigate={onNavigate} /></div>
      <div className="shrink-0 border-t border-border p-2">{userMenu}</div>
    </div>
  );

  return (
    <CommandPalette onLogout={logout}>
      <div className="flex min-h-dvh">
        <aside className="fixed inset-y-0 left-0 z-30 hidden w-[232px] border-r border-border bg-bg lg:block">{sidebar()}</aside>
        <DialogPrimitive.Root open={mobileOpen} onOpenChange={setMobileOpen}>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 animate-fade-in bg-black/50 lg:hidden" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-50 w-[260px] animate-[slide-in_200ms_ease-out_reverse] border-r border-border bg-bg lg:hidden">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
              <DialogPrimitive.Close className="absolute right-3 top-4 rounded-md p-1 text-fg-3 hover:bg-hover"><X className="size-4" /></DialogPrimitive.Close>
              {sidebar(() => setMobileOpen(false))}
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
        <div className="flex min-w-0 flex-1 flex-col lg:pl-[232px]">
          <header className="glass sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border px-4 sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button>
            <SearchTrigger />
            <div className="ml-auto flex items-center gap-1">
              <Tooltip content={live ? "Live updates connected" : "Reconnecting live updates…"}>
                <span className="mr-1 hidden items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11.5px] text-fg-3 sm:flex">
                  <span className={cn("size-1.5 rounded-full", live ? "bg-success shadow-[0_0_8px_var(--success)]" : "bg-warning")} />
                  {live ? "Live" : "Offline"}
                </span>
              </Tooltip>
              <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">{theme === "dark" ? <Sun /> : <Moon />}</Button>
              <NotificationBell />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8"><React.Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}>{children}</React.Suspense></main>
        </div>
      </div>
    </CommandPalette>
  );
}
