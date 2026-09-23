import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, matchAcceptLanguage, type Locale } from "~/i18n/config";
import { storeMessages } from "~/i18n/messages";
import { translate, type TranslateVars } from "~/i18n/translate";
import type { StoreMessageKey } from "~/i18n/messages";
import type { StoreSettings } from "~/lib/settings";

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function resolveLocale(request: Request, settings: StoreSettings): Locale {
  const enabled = settings.general.enabledLocales;
  const allowed = (value: unknown): value is Locale => isLocale(value) && enabled.includes(value);
  const query = new URL(request.url).searchParams.get("lang");
  if (allowed(query)) return query;
  const cookie = readCookie(request, LOCALE_COOKIE);
  if (allowed(cookie)) return cookie;
  const accepted = matchAcceptLanguage(request.headers.get("accept-language"));
  if (allowed(accepted)) return accepted;
  if (allowed(settings.general.defaultLocale)) return settings.general.defaultLocale;
  return enabled[0] ?? DEFAULT_LOCALE;
}

export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
}

export function serverT(locale: Locale, key: StoreMessageKey, vars?: TranslateVars): string {
  return translate(storeMessages(locale), key, vars);
}
