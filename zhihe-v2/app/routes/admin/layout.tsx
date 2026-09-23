import { Outlet, isRouteErrorResponse, useRouteError } from "react-router";
import { AdminShell } from "~/components/admin/shell";
import { adminMessages } from "~/i18n/messages";
import { I18nProvider, useT } from "~/i18n/react";
import { useRootData } from "~/lib/root-data";
import { adminContext } from "~/server/admin/context.server";
import type { Route } from "./+types/layout";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, admin, locale } = await adminContext(context, request);
  const [orders, lowStock] = await Promise.all([
    db.prepare("SELECT COUNT(*) AS n FROM orders WHERE status = 'processing' OR (status = 'waiting_payment' AND payment_method = 'manual_crypto' AND EXISTS (SELECT 1 FROM payments p WHERE p.order_id = orders.id AND p.tx_reference IS NOT NULL))").first<{ n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM products p WHERE p.is_active = 1 AND p.delivery_type = 'inventory'
         AND (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'available') <= 3`,
      )
      .first<{ n: number }>(),
  ]);
  return {
    admin: { name: admin.name, email: admin.email, role: admin.role },
    messages: adminMessages(locale),
    locale,
    badges: { orders: orders?.n ?? 0, lowStock: lowStock?.n ?? 0 },
  };
}

export const meta: Route.MetaFunction = () => [{ title: "Admin" }, { name: "robots", content: "noindex, nofollow" }];

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { settings } = useRootData();
  return (
    <I18nProvider locale={loaderData.locale} messages={loaderData.messages}>
      <AdminShell admin={loaderData.admin} storeName={settings.storeName} enabledLocales={settings.enabledLocales} badges={loaderData.badges}>
        <Outlet />
      </AdminShell>
    </I18nProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const t = useT();
  const status = isRouteErrorResponse(error) ? error.status : 500;
  if (!isRouteErrorResponse(error)) console.error(error);
  return (
    <div className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="font-mono text-sm text-accent-strong">{status}</p>
        <h1 className="mt-3 text-xl font-semibold">{status === 403 ? t("common.forbidden") : status === 404 ? t("common.notFound") : t("error.generic")}</h1>
        <a href="/admin" className="btn btn-secondary mt-6">
          {t("common.back")}
        </a>
      </div>
    </div>
  );
}
