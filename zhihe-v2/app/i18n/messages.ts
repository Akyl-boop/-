import type { Locale } from "./config";
import { adminEn } from "./locales/admin.en";
import { adminRu } from "./locales/admin.ru";
import { adminZh } from "./locales/admin.zh";
import { storeEn } from "./locales/store.en";
import { storeRu } from "./locales/store.ru";
import { storeZh } from "./locales/store.zh";

export type StoreMessageKey = keyof typeof storeEn;
export type AdminMessageKey = keyof typeof adminEn;
export type MessageKey = StoreMessageKey | AdminMessageKey;
export type StoreDictionary = Record<StoreMessageKey, string>;
export type AdminDictionary = Record<AdminMessageKey, string>;

const store: Record<Locale, StoreDictionary> = { en: storeEn, ru: storeRu, zh: storeZh };
const admin: Record<Locale, AdminDictionary> = { en: adminEn, ru: adminRu, zh: adminZh };

export function storeMessages(locale: Locale): StoreDictionary {
  return store[locale];
}

export function adminMessages(locale: Locale): AdminDictionary {
  return admin[locale];
}
