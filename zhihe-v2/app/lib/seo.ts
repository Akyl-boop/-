import type { MetaDescriptor } from "react-router";
import { LOCALE_META, LOCALES, type Locale } from "~/i18n/config";
import type { RootData } from "./root-data";
import { translate } from "~/i18n/translate";
import type { StoreMessageKey } from "~/i18n/messages";

interface MatchLike {
  id: string;
  loaderData?: unknown;
}

export function rootData(matches: readonly (MatchLike | undefined)[]): RootData | undefined {
  return matches.find((match) => match?.id === "root")?.loaderData as RootData | undefined;
}

export function metaT(root: RootData | undefined, key: StoreMessageKey, vars?: Record<string, string | number>): string {
  return root ? translate(root.messages, key, vars) : key;
}

interface SeoInput {
  title: string;
  description?: string;
  path: string;
  image?: string | null;
  type?: "website" | "product" | "article";
  noindex?: boolean;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

export function seo(root: RootData | undefined, input: SeoInput): MetaDescriptor[] {
  const siteUrl = root?.siteUrl ?? "";
  const storeName = root?.settings.storeName ?? "ZHIHE AI";
  const locale: Locale = root?.locale ?? "en";
  const title = input.title === storeName ? storeName : `${input.title} — ${storeName}`;
  const description = (input.description || root?.settings.tagline || "").slice(0, 300);
  const canonical = `${siteUrl}${input.path}`;
  const image = input.image ? (input.image.startsWith("http") ? input.image : `${siteUrl}${input.image}`) : `${siteUrl}/og.png`;
  const enabled = (root?.settings.enabledLocales ?? LOCALES) as Locale[];

  const tags: MetaDescriptor[] = [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: locale === "en" ? canonical : `${canonical}${canonical.includes("?") ? "&" : "?"}lang=${locale}` },
    { property: "og:site_name", content: storeName },
    { property: "og:type", content: input.type === "product" ? "product" : "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: canonical },
    { property: "og:image", content: image },
    { property: "og:locale", content: LOCALE_META[locale].ogLocale },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
  if (!input.noindex) {
    for (const alternate of enabled) {
      tags.push({
        tagName: "link",
        rel: "alternate",
        hrefLang: LOCALE_META[alternate].htmlLang,
        href: alternate === "en" ? canonical : `${canonical}${canonical.includes("?") ? "&" : "?"}lang=${alternate}`,
      });
    }
    tags.push({ tagName: "link", rel: "alternate", hrefLang: "x-default", href: canonical });
  }
  if (input.noindex) tags.push({ name: "robots", content: "noindex, nofollow" });
  if (input.jsonLd) tags.push({ "script:ld+json": input.jsonLd });
  return tags;
}
