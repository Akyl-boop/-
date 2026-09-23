export const LOCALES = ["en", "ru", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "zh_lang";

export const LOCALE_META: Record<Locale, { label: string; name: string; htmlLang: string; intl: string; ogLocale: string }> = {
  en: { label: "EN", name: "English", htmlLang: "en", intl: "en-US", ogLocale: "en_US" },
  ru: { label: "RU", name: "Русский", htmlLang: "ru", intl: "ru-RU", ogLocale: "ru_RU" },
  zh: { label: "中文", name: "简体中文", htmlLang: "zh-CN", intl: "zh-CN", ogLocale: "zh_CN" },
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function matchAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag = "", q] = part.trim().split(";q=");
      return { tag: tag.toLowerCase(), q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}
