import { pickText } from "~/lib/localized";
import { parseSettingsSection, SETTINGS_SECTIONS, type PublicSettings, type SettingsSection, type StoreSettings } from "~/lib/settings";
import type { Locale } from "~/i18n/config";
import { parseJson, queryAll } from "./db.server";

const CACHE_TTL_MS = 15_000;
let cache: { value: StoreSettings; expiresAt: number } | null = null;

export async function getSettings(db: D1Database): Promise<StoreSettings> {
  if (cache && cache.expiresAt > Date.now()) return cache.value;
  const rows = await queryAll<{ key: string; value: string }>(db, "SELECT key, value FROM settings");
  const byKey = new Map(rows.map((row) => [row.key, parseJson<unknown>(row.value, {})]));
  const value = Object.fromEntries(
    SETTINGS_SECTIONS.map((section) => [section, parseSettingsSection(section, byKey.get(section))]),
  ) as StoreSettings;
  cache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
  return value;
}

export async function saveSettingsSection<K extends SettingsSection>(db: D1Database, section: K, value: StoreSettings[K]): Promise<void> {
  const parsed = parseSettingsSection(section, value);
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3")
    .bind(section, JSON.stringify(parsed), Date.now())
    .run();
  cache = null;
}

export function toPublicSettings(settings: StoreSettings, locale: Locale): PublicSettings {
  return {
    storeName: settings.general.storeName,
    tagline: pickText(settings.general.tagline, locale),
    logoUrl: settings.general.logoUrl,
    faviconUrl: settings.general.faviconUrl,
    currency: settings.general.currency,
    enabledLocales: settings.general.enabledLocales,
    telegram: settings.contact.telegram.replace(/^@/, ""),
    supportEmail: settings.contact.supportEmail,
    supportHours: pickText(settings.contact.supportHours, locale),
    social: settings.social,
    footerAbout: pickText(settings.footer.about, locale),
    footerLegal: pickText(settings.footer.legal, locale),
    announcement: pickText(settings.homepage.announcement, locale),
  };
}
