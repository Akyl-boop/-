import { Menu, Receipt, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useT } from "~/i18n/react";
import type { StoreMessageKey } from "~/i18n/messages";
import { cn } from "~/lib/format";
import type { PublicSettings } from "~/lib/settings";
import { LanguageSwitcher } from "./language-switcher";
import { Logo } from "./logo";

export const NAV_ITEMS: { to: string; label: StoreMessageKey; end?: boolean }[] = [
  { to: "/", label: "nav.home", end: true },
  { to: "/catalog", label: "nav.catalog" },
  { to: "/how-it-works", label: "nav.howItWorks" },
  { to: "/instructions", label: "nav.instructions" },
  { to: "/faq", label: "nav.faq" },
  { to: "/support", label: "nav.support" },
];

export function Header({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    document.documentElement.style.overflow = open ? "hidden" : "";
    return () => {
      document.documentElement.style.overflow = "";
    };
  }, [open]);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b transition-[background-color,border-color] duration-300",
        scrolled || open ? "border-line bg-canvas/80 backdrop-blur-xl backdrop-saturate-150" : "border-transparent bg-transparent",
      )}
    >
      <div className="page-container flex h-16 items-center gap-6">
        <Link to="/" className="shrink-0 rounded-lg" aria-label={settings.storeName}>
          <Logo name={settings.storeName} logoUrl={settings.logoUrl} />
        </Link>

        <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
          {NAV_ITEMS.slice(1).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn("rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors", isActive ? "text-fg" : "text-fg-muted hover:text-fg")
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <LanguageSwitcher enabled={settings.enabledLocales} />
          <Link to="/orders" className="btn btn-secondary btn-sm hidden sm:inline-flex">
            <Receipt className="size-3.5" />
            {t("nav.myOrders")}
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-icon lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? t("common.close") : t("nav.menu")}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-menu" className="fixed inset-x-0 top-16 bottom-0 z-40 animate-fade-in overflow-y-auto border-t border-line bg-canvas/95 backdrop-blur-xl lg:hidden">
          <nav className="page-container flex flex-col py-4" aria-label="Mobile">
            {[...NAV_ITEMS, { to: "/orders", label: "nav.myOrders" as StoreMessageKey }].map((item, index) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={{ animationDelay: `${index * 25}ms` }}
                className={({ isActive }) =>
                  cn(
                    "animate-rise flex items-center justify-between border-b border-line py-4 text-lg font-medium tracking-tight",
                    isActive ? "text-fg" : "text-fg-muted",
                  )
                }
              >
                {t(item.label)}
              </NavLink>
            ))}
            <div className="mt-6 flex items-center justify-between">
              <span className="text-sm text-fg-subtle">{t("nav.language")}</span>
              <LanguageSwitcher enabled={settings.enabledLocales} />
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  );
}
