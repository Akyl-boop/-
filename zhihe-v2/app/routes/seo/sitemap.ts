import { LOCALE_META, type Locale } from "~/i18n/config";
import { getRequestContext } from "~/server/context";
import { queryAll } from "~/server/db.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/sitemap";

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const site = env.SITE_URL.replace(/\/$/, "");
  const settings = await getSettings(env.DB);
  const locales = settings.general.enabledLocales as Locale[];
  const [products, categories, guides] = await Promise.all([
    queryAll<{ slug: string; updated_at: number }>(env.DB, "SELECT slug, updated_at FROM products WHERE is_active = 1"),
    queryAll<{ slug: string; updated_at: number }>(env.DB, "SELECT slug, updated_at FROM categories WHERE is_active = 1"),
    queryAll<{ slug: string; updated_at: number }>(env.DB, "SELECT slug, updated_at FROM instructions WHERE is_published = 1"),
  ]);
  const entries: { path: string; updated?: number; priority: string }[] = [
    { path: "/", priority: "1.0" },
    { path: "/catalog", priority: "0.9" },
    { path: "/how-it-works", priority: "0.5" },
    { path: "/instructions", priority: "0.6" },
    { path: "/faq", priority: "0.5" },
    { path: "/support", priority: "0.4" },
    ...categories.map((row) => ({ path: `/catalog/${row.slug}`, updated: row.updated_at, priority: "0.8" })),
    ...products.map((row) => ({ path: `/product/${row.slug}`, updated: row.updated_at, priority: "0.8" })),
    ...guides.map((row) => ({ path: `/instructions/${row.slug}`, updated: row.updated_at, priority: "0.6" })),
  ];
  const href = (path: string, locale: Locale) => (locale === "en" ? `${site}${path}` : `${site}${path}?lang=${locale}`);
  const urls = entries
    .map((entry) => {
      const alternates = locales
        .map((locale) => `<xhtml:link rel="alternate" hreflang="${LOCALE_META[locale].htmlLang}" href="${escapeXml(href(entry.path, locale))}"/>`)
        .join("");
      const lastmod = entry.updated ? `<lastmod>${new Date(entry.updated).toISOString()}</lastmod>` : "";
      return `<url><loc>${escapeXml(`${site}${entry.path}`)}</loc>${lastmod}<priority>${entry.priority}</priority>${alternates}</url>`;
    })
    .join("");
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
