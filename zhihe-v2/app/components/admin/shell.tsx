import {
  BarChart3,
  BookOpen,
  Boxes,
  ExternalLink,
  Image,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Percent,
  ScrollText,
  Settings,
  ShoppingBag,
  Tags,
  UserRound,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, Link, NavLink, useLocation, useNavigation } from "react-router";
import { LanguageSwitcher } from "~/components/store/language-switcher";
import { LogoMark } from "~/components/store/logo";
import { useT } from "~/i18n/react";
import type { AdminMessageKey } from "~/i18n/messages";
import { cn } from "~/lib/format";

interface NavItem {
  to: string;
  label: AdminMessageKey;
  icon: LucideIcon;
  end?: boolean;
  badge?: number;
  ownerOnly?: boolean;
}

export interface ShellProps {
  admin: { name: string; email: string; role: "owner" | "manager" };
  storeName: string;
  enabledLocales: string[];
  badges: { orders: number; lowStock: number };
  children: ReactNode;
}

export function AdminShell({ admin, storeName, enabledLocales, badges, children }: ShellProps) {
  const t = useT();
  const location = useLocation();
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  const groups: { title: AdminMessageKey; items: NavItem[] }[] = [
    {
      title: "admin.nav.group.store",
      items: [
        { to: "/admin", label: "admin.nav.dashboard", icon: LayoutDashboard, end: true },
        { to: "/admin/orders", label: "admin.nav.orders", icon: ShoppingBag, badge: badges.orders },
        { to: "/admin/analytics", label: "admin.nav.analytics", icon: BarChart3 },
      ],
    },
    {
      title: "admin.nav.group.catalog",
      items: [
        { to: "/admin/products", label: "admin.nav.products", icon: Package },
        { to: "/admin/categories", label: "admin.nav.categories", icon: Tags },
        { to: "/admin/inventory", label: "admin.nav.inventory", icon: Boxes, badge: badges.lowStock },
        { to: "/admin/instructions", label: "admin.nav.instructions", icon: BookOpen },
        { to: "/admin/media", label: "admin.nav.media", icon: Image },
      ],
    },
    {
      title: "admin.nav.group.customers",
      items: [
        { to: "/admin/customers", label: "admin.nav.customers", icon: Users },
        { to: "/admin/discounts", label: "admin.nav.discounts", icon: Percent },
      ],
    },
    {
      title: "admin.nav.group.system",
      items: [
        { to: "/admin/settings", label: "admin.nav.settings", icon: Settings, ownerOnly: true },
        { to: "/admin/audit", label: "admin.nav.audit", icon: ScrollText, ownerOnly: true },
      ],
    },
  ];

  const nav = (
    <nav className="flex flex-1 flex-col gap-6 overflow-y-auto px-3 py-5" aria-label="Admin">
      {groups.map((group) => {
        const items = group.items.filter((item) => !item.ownerOnly || admin.role === "owner");
        if (items.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="px-3 pb-2 text-[10.5px] font-semibold tracking-[0.14em] text-fg-subtle uppercase">{t(group.title)}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    prefetch="intent"
                    className={({ isActive }) =>
                      cn(
                        "group flex h-9 items-center gap-3 rounded-lg px-3 text-[13.5px] font-medium transition-colors",
                        isActive ? "bg-white/[0.06] text-fg shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)]" : "text-fg-muted hover:bg-white/[0.03] hover:text-fg",
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <item.icon className={cn("size-4 shrink-0", isActive ? "text-accent-strong" : "text-fg-subtle group-hover:text-fg-muted")} />
                        <span className="flex-1 truncate">{t(item.label)}</span>
                        {item.badge ? (
                          <span className="min-w-5 rounded-full bg-accent-soft px-1.5 text-center text-[11px] leading-5 font-semibold text-accent-strong tabular">{item.badge}</span>
                        ) : null}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );

  const brand = (
    <Link to="/admin" className="flex h-16 shrink-0 items-center gap-2.5 border-b border-line px-5">
      <LogoMark className="size-7" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{storeName}</span>
        <span className="block text-[11px] text-fg-subtle">{t("admin.brand.subtitle")}</span>
      </span>
    </Link>
  );

  return (
    <div className="min-h-dvh bg-canvas lg:pl-[248px]">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-line bg-panel/60 backdrop-blur-xl lg:flex">
        {brand}
        {nav}
        <AccountFooter admin={admin} />
      </aside>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 flex w-[280px] max-w-[85vw] animate-[rise_0.3s_var(--ease-out-soft)] flex-col border-r border-line bg-panel">
            <div className="flex items-center justify-between pr-3">
              {brand}
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} aria-label={t("common.close")}>
                <X className="size-4" />
              </button>
            </div>
            {nav}
            <AccountFooter admin={admin} />
          </aside>
        </div>
      ) : null}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-canvas/80 px-4 backdrop-blur-xl sm:px-6">
        <button type="button" className="btn btn-ghost btn-icon -ml-2 lg:hidden" onClick={() => setOpen(true)} aria-label={t("admin.nav.open")}>
          <Menu className="size-5" />
        </button>
        <div className="flex-1" />
        <LanguageSwitcher enabled={enabledLocales} />
        <a href="/" target="_blank" rel="noopener" className="btn btn-secondary btn-sm">
          <ExternalLink className="size-3.5" />
          <span className="hidden sm:inline">{t("admin.viewStore")}</span>
        </a>
      </header>

      <div className={cn("h-0.5 bg-accent transition-all duration-500", navigation.state !== "idle" ? "w-2/3 opacity-100" : "w-full opacity-0")} aria-hidden="true" style={{ position: "fixed", top: 0, left: 0, zIndex: 60 }} />

      <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</main>
    </div>
  );
}

function AccountFooter({ admin }: { admin: ShellProps["admin"] }) {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  return (
    <div ref={ref} className="relative border-t border-line p-3">
      {menu ? (
        <div className="absolute right-3 bottom-full left-3 mb-2 animate-pop overflow-hidden rounded-xl border border-line-strong bg-panel-2 p-1" style={{ boxShadow: "var(--shadow-pop)" }}>
          <Link to="/admin/account" className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-white/5 hover:text-fg">
            <UserRound className="size-4" />
            {t("admin.account.title")}
          </Link>
          <Form method="post" action="/admin/logout">
            <button type="submit" className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-fg-muted hover:bg-white/5 hover:text-danger">
              <LogOut className="size-4" />
              {t("admin.logout")}
            </button>
          </Form>
        </div>
      ) : null}
      <button type="button" onClick={() => setMenu((value) => !value)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.04]" aria-expanded={menu}>
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-deep text-xs font-semibold text-white">
          {admin.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{admin.name}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{admin.email}</span>
        </span>
      </button>
    </div>
  );
}
