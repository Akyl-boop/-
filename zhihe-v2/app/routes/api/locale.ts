import { data } from "react-router";
import { isLocale } from "~/i18n/config";
import { getRequestContext } from "~/server/context";
import { localeCookie } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/locale";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const form = await request.formData();
  const locale = form.get("locale");
  if (!isLocale(locale) || !settings.general.enabledLocales.includes(locale)) return data({ ok: false }, { status: 400 });
  return data({ ok: true }, { headers: { "Set-Cookie": localeCookie(locale) } });
}
