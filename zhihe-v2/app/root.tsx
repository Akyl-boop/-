import type { RootData } from "./lib/root-data";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";
import type { Route } from "./+types/root";
import "./app.css";
import { ToastProvider } from "./components/ui/toast";
import { LOCALE_META, type Locale } from "./i18n/config";
import { storeMessages } from "./i18n/messages";
import { I18nProvider } from "./i18n/react";
import { getRequestContext } from "./server/context";
import { resolveLocale } from "./server/locale.server";
import { getSettings, toPublicSettings } from "./server/settings.server";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env, nonce } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  return {
    locale,
    nonce,
    messages: storeMessages(locale),
    settings: toPublicSettings(settings, locale),
    siteUrl: env.SITE_URL.replace(/\/$/, ""),
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const data = useRouteLoaderData("root") as RootData | undefined;
  const locale: Locale = data?.locale ?? "en";
  const favicon = data?.settings.faviconUrl || "/favicon.svg";
  return (
    <html lang={LOCALE_META[locale].htmlLang} className="bg-canvas">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#07080c" />
        <link rel="icon" href={favicon} />
        <Meta />
        <Links nonce={data?.nonce} />
      </head>
      <body>
        {children}
        <ScrollRestoration nonce={data?.nonce} />
        <Scripts nonce={data?.nonce} />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  return (
    <I18nProvider locale={loaderData.locale} messages={loaderData.messages}>
      <ToastProvider>
        <Outlet />
      </ToastProvider>
    </I18nProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (!isRouteErrorResponse(error)) console.error(error);
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-sm text-accent-strong">{status}</p>
        <h1 className="mt-3 text-2xl font-semibold text-fg">{status === 404 ? "Page not found" : "Something went wrong"}</h1>
        <p className="mt-2 text-sm text-fg-muted">{status === 404 ? "The page you are looking for does not exist." : "Please try again in a moment."}</p>
        <a href="/" className="btn btn-secondary mt-6">
          Home
        </a>
      </div>
    </main>
  );
}
