import { LOCALE_META, type Locale } from "~/i18n/config";

export function formatDateTime(timestamp: number | null | undefined, locale: Locale, timeZone?: string): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(LOCALE_META[locale].intl, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(timestamp);
}

export function formatDate(timestamp: number | null | undefined, locale: Locale, timeZone?: string): string {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat(LOCALE_META[locale].intl, { dateStyle: "medium", timeZone }).format(timestamp);
}

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(LOCALE_META[locale].intl).format(value);
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
