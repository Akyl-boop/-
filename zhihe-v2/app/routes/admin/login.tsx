import { CircleAlert, LogIn } from "lucide-react";
import { Form, data, redirect, useNavigation } from "react-router";
import { AuthCard } from "~/components/admin/auth-card";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { adminMessages } from "~/i18n/messages";
import { I18nProvider, useT } from "~/i18n/react";
import { translate } from "~/i18n/translate";
import { adminCount, getAdmin, login } from "~/server/auth.server";
import { getRequestContext } from "~/server/context";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/login";

function safeNext(value: string | null): string {
  return value && value.startsWith("/admin") && !value.startsWith("//") ? value : "/admin";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  if (await getAdmin(env.DB, request)) throw redirect("/admin");
  if ((await adminCount(env.DB)) === 0) throw redirect("/admin/setup");
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  return { locale, messages: adminMessages(locale) };
}

export const meta: Route.MetaFunction = () => [{ title: "Sign in" }, { name: "robots", content: "noindex, nofollow" }];

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const messages = adminMessages(resolveLocale(request, settings));
  const form = await request.formData();
  const email = String(form.get("email") ?? "").slice(0, 254);
  const password = String(form.get("password") ?? "").slice(0, 256);
  if (!email || !password) return data({ error: translate(messages, "admin.login.invalid") }, { status: 400 });
  const result = await login(env.DB, request, email, password);
  if (!result.ok) {
    return data({ error: translate(messages, result.error === "locked" ? "admin.login.locked" : "admin.login.invalid") }, { status: result.error === "locked" ? 429 : 401 });
  }
  throw redirect(safeNext(new URL(request.url).searchParams.get("next")), { headers: { "Set-Cookie": result.cookie } });
}

function LoginForm({ error }: { error?: string }) {
  const t = useT();
  const navigation = useNavigation();
  return (
    <AuthCard title={t("admin.login.title")} description={t("admin.login.description")}>
      <Form method="post" className="space-y-4">
        {error ? (
          <div className="flex gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] text-danger" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        ) : null}
        <TextField label={t("admin.login.email")} name="email" type="email" autoComplete="username" required autoFocus />
        <TextField label={t("admin.login.password")} name="password" type="password" autoComplete="current-password" required />
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={navigation.state !== "idle"}>
          <LogIn className="size-4" />
          {t("admin.login.submit")}
        </Button>
      </Form>
    </AuthCard>
  );
}

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <I18nProvider locale={loaderData.locale} messages={loaderData.messages}>
      <LoginForm error={actionData?.error} />
    </I18nProvider>
  );
}
