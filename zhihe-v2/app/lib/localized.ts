import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/i18n/config";

export type LocalizedText = Partial<Record<Locale, string>>;

export function pickText(value: LocalizedText | null | undefined, locale: Locale): string {
  if (!value) return "";
  const direct = value[locale]?.trim();
  if (direct) return direct;
  const fallback = value[DEFAULT_LOCALE]?.trim();
  if (fallback) return fallback;
  for (const candidate of LOCALES) {
    const text = value[candidate]?.trim();
    if (text) return text;
  }
  return "";
}

export function isLocalizedEmpty(value: LocalizedText | null | undefined): boolean {
  return !value || LOCALES.every((locale) => !value[locale]?.trim());
}

export function parseLocalized(raw: string | null | undefined): LocalizedText {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: LocalizedText = {};
      for (const locale of LOCALES) {
        const text = (parsed as Record<string, unknown>)[locale];
        if (typeof text === "string") out[locale] = text;
      }
      return out;
    }
    return typeof parsed === "string" ? { [DEFAULT_LOCALE]: parsed } : {};
  } catch {
    return { [DEFAULT_LOCALE]: raw };
  }
}
