import { LOCALES } from "~/i18n/config";
import type { LocalizedText } from "./localized";

export function formString(form: FormData, name: string, max = 10_000): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function formBool(form: FormData, name: string): boolean {
  const value = form.get(name);
  return value === "on" || value === "true" || value === "1";
}

export function formInt(form: FormData, name: string, fallback = 0): number {
  const value = Number.parseInt(formString(form, name), 10);
  return Number.isFinite(value) ? value : fallback;
}

/** Reads `${name}.en`, `${name}.ru`, `${name}.zh` fields. */
export function formLocalized(form: FormData, name: string, max = 20_000): LocalizedText {
  const out: LocalizedText = {};
  for (const locale of LOCALES) {
    const value = formString(form, `${name}.${locale}`, max);
    if (value) out[locale] = value;
  }
  return out;
}

export function formJson<T>(form: FormData, name: string, fallback: T): T {
  const raw = form.get(name);
  if (typeof raw !== "string" || !raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
