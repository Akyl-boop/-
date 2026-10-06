"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  Boxes, CreditCard, FilePlus2, LifeBuoy, LogOut, Megaphone, Moon, Package, Search, Settings2, ShoppingBag, Sun, Tag, User,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Kbd, Spinner } from "@/components/ui/misc";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { NAV } from "@/lib/nav";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

interface Hit { id: string | number; title: string; subtitle?: string; href: string }
type Results = Record<"orders" | "customers" | "products" | "payments" | "tickets" | "inventory", Hit[]>;

const groupMeta: Record<keyof Results, { label: string; icon: React.ReactNode }> = {
  orders: { label: "Orders", icon: <ShoppingBag /> },
  customers: { label: "Customers", icon: <User /> },
  products: { label: "Products", icon: <Package /> },
  payments: { label: "Payments", icon: <CreditCard /> },
  tickets: { label: "Support tickets", icon: <LifeBuoy /> },
  inventory: { label: "Inventory", icon: <Boxes /> },
};

const SETTINGS_SECTIONS = ["general", "branding", "bot", "checkout", "features", "localization", "referrals", "maintenance", "security", "backups"];

export const CommandPaletteCtx = React.createContext<{ open: () => void }>({ open: () => {} });

export function CommandPalette({ children, onLogout }: { children: React.ReactNode; onLogout: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const router = useRouter();
  const { can } = useSession();
  const { theme, toggle } = useTheme();
  const debounced = useDebounce(q.trim(), 220);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  React.useEffect(() => { if (!open) setQ(""); }, [open]);

  const search = useQuery({
    queryKey: ["search", debounced], enabled: open && debounced.length >= 2,
    queryFn: () => api.get<Results>("/search", { q: debounced }), staleTime: 10_000,
  });

  const go = (href: string) => { setOpen(false); router.push(href); };
  const run = (fn: () => void) => { setOpen(false); fn(); };

  const commands = [
    can("products.edit") && { label: "Create product", icon: <FilePlus2 />, run: () => go("/products/new"), keywords: "new add" },
    can("promo.manage") && { label: "Create promo code", icon: <Tag />, run: () => go("/promo-codes?new=1"), keywords: "discount coupon" },
    can("broadcasts.send") && { label: "New broadcast", icon: <Megaphone />, run: () => go("/marketing?new=1"), keywords: "campaign message" },
    can("inventory.manage") && { label: "Add inventory", icon: <Boxes />, run: () => go("/inventory?add=1"), keywords: "stock keys import" },
    can("settings.edit") && { label: "Maintenance mode", icon: <Wrench />, run: () => go("/settings?tab=maintenance"), keywords: "offline" },
    { label: theme === "dark" ? "Switch to light theme" : "Switch to dark theme", icon: theme === "dark" ? <Sun /> : <Moon />, run: () => run(toggle), keywords: "appearance" },
    { label: "Account & security", icon: <User />, run: () => go("/profile"), keywords: "password 2fa sessions" },
    { label: "Sign out", icon: <LogOut />, run: () => run(onLogout), keywords: "logout" },
  ].filter(Boolean) as { label: string; icon: React.ReactNode; run: () => void; keywords: string }[];

  const results = search.data;
  const hasResults = results && Object.values(results).some((v) => v.length);

  return (
    <CommandPaletteCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] animate-fade-in bg-black/50 backdrop-blur-[2px]" />
          <DialogPrimitive.Content className="fixed left-1/2 top-[12vh] z-[81] w-[calc(100vw-24px)] max-w-[640px] -translate-x-1/2 animate-pop-in overflow-hidden rounded-[16px] border border-border-strong bg-elevated shadow-[var(--shadow-lg)]">
            <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Search orders, customers, products and run commands</DialogPrimitive.Description>
            <Command loop shouldFilter={!debounced || debounced.length < 2 ? true : false} className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-fg-3">
              <div className="flex items-center gap-2.5 border-b border-border px-4">
                <Search className="size-4 text-fg-3" />
                <Command.Input value={q} onValueChange={setQ} autoFocus placeholder="Search orders, customers, products, tx hashes… or type a command"
                  className="h-12 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-fg-3" />
                {search.isFetching ? <Spinner /> : <Kbd>Esc</Kbd>}
              </div>
              <Command.List className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5 [&_[cmdk-item]]:flex [&_[cmdk-item]]:h-9 [&_[cmdk-item]]:cursor-default [&_[cmdk-item]]:items-center [&_[cmdk-item]]:gap-2.5 [&_[cmdk-item]]:rounded-[8px] [&_[cmdk-item]]:px-2.5 [&_[cmdk-item]]:text-[13px] [&_[cmdk-item]]:text-fg-2 [&_[cmdk-item][data-selected=true]]:bg-hover [&_[cmdk-item][data-selected=true]]:text-fg [&_[cmdk-item]_svg]:size-4 [&_[cmdk-item]_svg]:text-fg-3">
                <Command.Empty className="px-3 py-8 text-center text-[13px] text-fg-3">
                  {search.isFetching ? "Searching…" : "No results"}
                </Command.Empty>
                {debounced.length >= 2 && hasResults
                  ? (Object.keys(groupMeta) as (keyof Results)[]).map((k) =>
                    results![k]?.length ? (
                      <Command.Group key={k} heading={groupMeta[k].label}>
                        {results![k].map((h) => (
                          <Command.Item key={`${k}-${h.id}`} value={`${k}-${h.id}-${h.title}`} onSelect={() => go(h.href)}>
                            {groupMeta[k].icon}
                            <span className="truncate text-fg">{h.title}</span>
                            {h.subtitle ? <span className="ml-auto truncate text-xs text-fg-3">{h.subtitle}</span> : null}
                          </Command.Item>
                        ))}
                      </Command.Group>
                    ) : null)
                  : null}
                <Command.Group heading="Commands">
                  {commands.map((c) => (
                    <Command.Item key={c.label} value={`${c.label} ${c.keywords}`} onSelect={c.run}>{c.icon}{c.label}</Command.Item>
                  ))}
                </Command.Group>
                <Command.Group heading="Go to">
                  {NAV.flatMap((g) => g.items).filter((i) => !i.perm || can(i.perm)).map((i) => (
                    <Command.Item key={i.href} value={`go ${i.label} ${i.keywords ?? ""}`} onSelect={() => go(i.href)}>
                      <i.icon />{i.label}
                    </Command.Item>
                  ))}
                  {can("settings.edit") ? SETTINGS_SECTIONS.map((s) => (
                    <Command.Item key={s} value={`settings ${s}`} onSelect={() => go(`/settings?tab=${s}`)}>
                      <Settings2 />Settings › <span className="capitalize">{s}</span>
                    </Command.Item>
                  )) : null}
                </Command.Group>
              </Command.List>
              <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-[11.5px] text-fg-3">
                <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
                <span className="flex items-center gap-1"><Kbd>↵</Kbd> open</span>
                <span className="ml-auto flex items-center gap-1"><Kbd>⌘</Kbd><Kbd>K</Kbd> toggle</span>
              </div>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </CommandPaletteCtx.Provider>
  );
}
