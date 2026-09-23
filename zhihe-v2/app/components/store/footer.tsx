import { Link } from "react-router";
import { useT } from "~/i18n/react";
import type { PublicSettings } from "~/lib/settings";
import { Logo } from "./logo";

function socialLinks(settings: PublicSettings) {
  const social = settings.social;
  return [
    { label: "Telegram", href: social.telegramChannel },
    { label: "X", href: social.x },
    { label: "Instagram", href: social.instagram },
    { label: "YouTube", href: social.youtube },
    { label: "VK", href: social.vk },
  ].filter((link) => /^https?:\/\//.test(link.href));
}

export function Footer({ settings }: { settings: PublicSettings }) {
  const t = useT();
  const year = new Date().getFullYear();
  const socials = socialLinks(settings);
  const columns = [
    {
      title: t("footer.store"),
      links: [
        { to: "/catalog", label: t("nav.catalog") },
        { to: "/how-it-works", label: t("nav.howItWorks") },
        { to: "/orders", label: t("nav.myOrders") },
      ],
    },
    {
      title: t("footer.help"),
      links: [
        { to: "/instructions", label: t("nav.instructions") },
        { to: "/faq", label: t("nav.faq") },
        { to: "/support", label: t("nav.support") },
      ],
    },
  ];

  return (
    <footer className="mt-24 border-t border-line bg-panel/40">
      <div className="page-container grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1.2fr]">
        <div className="max-w-sm">
          <Logo name={settings.storeName} logoUrl={settings.logoUrl} />
          <p className="mt-4 text-sm leading-6 text-fg-muted">{settings.footerAbout}</p>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <h2 className="eyebrow">{column.title}</h2>
            <ul className="mt-4 space-y-2.5">
              {column.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className="text-sm text-fg-muted transition-colors hover:text-fg">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div>
          <h2 className="eyebrow">{t("footer.contact")}</h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {settings.telegram ? (
              <li>
                <a href={`https://t.me/${settings.telegram}`} className="text-fg-muted transition-colors hover:text-fg" rel="noopener noreferrer" target="_blank">
                  Telegram · @{settings.telegram}
                </a>
              </li>
            ) : null}
            {settings.supportEmail ? (
              <li>
                <a href={`mailto:${settings.supportEmail}`} className="text-fg-muted transition-colors hover:text-fg">
                  {settings.supportEmail}
                </a>
              </li>
            ) : null}
            {settings.supportHours ? <li className="text-fg-subtle">{settings.supportHours}</li> : null}
          </ul>
          {socials.length > 0 ? (
            <div className="mt-5 flex flex-wrap gap-2">
              {socials.map((link) => (
                <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-line-strong hover:text-fg">
                  {link.label}
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="page-container flex flex-col gap-2 py-6 text-xs text-fg-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {year} {settings.storeName}. {t("footer.rights")}
          </p>
          <p>{settings.footerLegal}</p>
        </div>
      </div>
    </footer>
  );
}
