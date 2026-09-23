import { CircleAlert, ShieldCheck } from "lucide-react";
import { Form, data, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { AuthCard } from "~/components/admin/auth-card";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { adminMessages } from "~/i18n/messages";
import { I18nProvider, useT } from "~/i18n/react";
import { translate } from "~/i18n/translate";
import { audit } from "~/server/audit.server";
import { adminCount, createAdmin, login } from "~/server/auth.server";
import { getRequestContext } from "~/server/context";
import { timingSafeEqual } from "~/server/crypto.server";
import { clientIp } from "~/server/http.server";
import { resolveLocale } from "~/server/locale.server";
import { hitRateLimit } from "~/server/rate-limit.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/setup";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  if ((await adminCount(env.DB)) > 0) throw redirect("/admin/login");
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  return { locale, messages: adminMessages(locale), configured: Boolean(env.ADMIN_SETUP_TOKEN && env.ADMIN_SETUP_TOKEN.length >= 16) };
}

export const meta: Route.MetaFunction = () => [{ title: "Setup" }, { name: "robots", content: "noindex, nofollow" }];

const schema = z.object({
  token: z.string().min(1).max(200),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(12).max(256),
});

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getRequestContext(context);
  const messages = adminMessages(resolveLocale(request, await getSettings(env.DB)));
  const t = (key: Parameters<typeof translate>[1]) => translate(messages, key);
  if ((await adminCount(env.DB)) > 0) throw redirect("/admin/login");
  const limit = await hitRateLimit(env.DB, `setup:${clientIp(request)}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) return data({ error: t("admin.login.locked") }, { status: 429 });
  const parsed = schema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return data({ error: t("admin.setup.invalid") }, { status: 400 });
  const expected = env.ADMIN_SETUP_TOKEN;
  if (!expected || expected.length < 16 || !timingSafeEqual(expected, parsed.data.token)) return data({ error: t("admin.setup.badToken") }, { status: 403 });

  await createAdmin(env.DB, { email: parsed.data.email, name: parsed.data.name, password: parsed.data.password, role: "owner" });
  const result = await login(env.DB, request, parsed.data.email, parsed.data.password);
  await audit(env.DB, request, null, { action: "admin.setup", entityType: "admin", summary: parsed.data.email });
  if (!result.ok) throw redirect("/admin/login");
  throw redirect("/admin", { headers: { "Set-Cookie": result.cookie } });
}

function SetupForm({ configured, error }: { configured: boolean; error?: string }) {
  const t = useT();
  const navigation = useNavigation();
  return (
    <AuthCard title={t("admin.setup.title")} description={t("admin.setup.description")}>
      {!configured ? (
        <div className="flex gap-2.5 rounded-xl border border-warning/25 bg-warning-soft px-3.5 py-3 text-[13px] text-warning">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {t("admin.setup.noToken")}
        </div>
      ) : (
        <Form method="post" className="space-y-4">
          {error ? (
            <div className="flex gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] text-danger" role="alert">
              <CircleAlert className="mt-0.5 size-4 shrink-0" />
              {error}
            </div>
          ) : null}
          <TextField label={t("admin.setup.token")} name="token" type="password" required autoComplete="off" hint={t("admin.setup.tokenHint")} />
          <TextField label={t("admin.setup.name")} name="name" required autoComplete="name" />
          <TextField label={t("admin.login.email")} name="email" type="email" required autoComplete="username" />
          <TextField label={t("admin.login.password")} name="password" type="password" required minLength={12} autoComplete="new-password" hint={t("admin.setup.passwordHint")} />
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={navigation.state !== "idle"}>
            <ShieldCheck className="size-4" />
            {t("admin.setup.submit")}
          </Button>
        </Form>
      )}
    </AuthCard>
  );
}

export default function Setup({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <I18nProvider locale={loaderData.locale} messages={loaderData.messages}>
      <SetupForm configured={loaderData.configured} error={actionData?.error} />
    </I18nProvider>
  );
}
