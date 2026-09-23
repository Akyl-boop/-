import { Wrench } from "lucide-react";
import { isRouteErrorResponse, Link, Outlet, useRouteError } from "react-router";
import { useT } from "~/i18n/react";
import { Footer } from "~/components/store/footer";
import { Header } from "~/components/store/header";
import { LogoMark } from "~/components/store/logo";
import { pickText } from "~/lib/localized";
import { useRootData } from "~/lib/root-data";
import { getAdmin } from "~/server/auth.server";
import { getRequestContext } from "~/server/context";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/layout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  if (settings.general.maintenanceMode && !(await getAdmin(env.DB, request))) {
    const locale = resolveLocale(request, settings);
    return { maintenance: pickText(settings.general.maintenanceMessage, locale) };
  }
  return { maintenance: null };
}

export default function StoreLayout({ loaderData }: Route.ComponentProps) {
  const { settings } = useRootData();
  if (loaderData.maintenance) {
    return (
      <main className="grid min-h-dvh place-items-center px-6">
        <div className="max-w-md text-center">
          <LogoMark className="mx-auto size-10" />
          <div className="mx-auto mt-8 grid size-11 place-items-center rounded-xl border border-line-strong bg-panel-2">
            <Wrench className="size-5 text-fg-muted" />
          </div>
          <h1 className="mt-5 text-xl font-semibold">{settings.storeName}</h1>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{loaderData.maintenance}</p>
          {settings.telegram ? (
            <a className="btn btn-secondary mt-6" href={`https://t.me/${settings.telegram}`}>
              Telegram · @{settings.telegram}
            </a>
          ) : null}
        </div>
      </main>
    );
  }
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px]" aria-hidden="true">
        <div className="absolute top-[-280px] left-1/2 h-[560px] w-[1100px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,108,255,0.16),transparent)]" />
      </div>
      {settings.announcement ? <div className="border-b border-line bg-accent-soft px-4 py-2 text-center text-[13px] text-fg">{settings.announcement}</div> : null}
      <Header settings={settings} />
      <main className="flex-1">
        <Outlet />
      </main>
      <Footer settings={settings} />
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const t = useT();
  const { settings } = useRootData();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (!isRouteErrorResponse(error)) console.error(error);
  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <Header settings={settings} />
      <main className="page-container grid flex-1 place-items-center py-24 text-center">
        <div>
          <p className="font-mono text-sm text-accent-strong">{status}</p>
          <h1 className="text-gradient mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{status === 404 ? t("notFound.title") : t("error.generic")}</h1>
          {status === 404 ? <p className="mx-auto mt-3 max-w-md text-[15px] text-fg-muted">{t("notFound.text")}</p> : null}
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/catalog" className="btn btn-primary">
              {t("home.cta.catalog")}
            </Link>
            <Link to="/" className="btn btn-secondary">
              {t("nav.home")}
            </Link>
          </div>
        </div>
      </main>
      <Footer settings={settings} />
    </div>
  );
}
