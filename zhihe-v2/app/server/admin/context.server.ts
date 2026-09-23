import type { RouterContextProvider } from "react-router";
import type { Locale } from "~/i18n/config";
import { adminMessages, storeMessages, type MessageKey } from "~/i18n/messages";
import { translate, type TranslateVars } from "~/i18n/translate";
import { requireAdmin, type AdminRole, type AdminUser } from "../auth.server";
import { getRequestContext } from "../context";
import { resolveLocale } from "../locale.server";
import { getSettings } from "../settings.server";

export interface AdminContext {
  env: Env;
  ctx: ExecutionContext;
  db: D1Database;
  admin: AdminUser;
  locale: Locale;
  t: (key: MessageKey, vars?: TranslateVars) => string;
}

export async function adminContext(context: Readonly<RouterContextProvider>, request: Request, role?: AdminRole): Promise<AdminContext> {
  const { env, ctx } = getRequestContext(context);
  const admin = await requireAdmin(env.DB, request, role);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const messages = { ...storeMessages(locale), ...adminMessages(locale) };
  return { env, ctx, db: env.DB, admin, locale, t: (key, vars) => translate(messages, key, vars) };
}

export type ActionResult = { ok: true; message?: string; redirectTo?: string; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function ok(message?: string, extra: { redirectTo?: string; id?: string } = {}): ActionResult {
  return { ok: true, message, ...extra };
}

export function fail(error: string, fieldErrors?: Record<string, string>): ActionResult {
  return { ok: false, error, fieldErrors };
}

export function pageParams(url: URL, pageSize = 25) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function likeTerm(value: string): string {
  return `%${value.replace(/[%_\\]/g, (m) => `\\${m}`).toLowerCase()}%`;
}
