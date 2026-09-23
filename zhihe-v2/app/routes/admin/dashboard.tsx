import { AlertTriangle, ArrowRight, CircleDollarSign, Clock, Package, ShoppingBag, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { BarChart } from "~/components/admin/bar-chart";
import { OrdersTable } from "~/components/admin/orders-table";
import { AdminPageHeader, Panel, StatCard } from "~/components/admin/page";
import { EmptyState } from "~/components/ui/empty-state";
import { useLocale, useT } from "~/i18n/react";
import { LOCALE_META } from "~/i18n/config";
import { formatNumber } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import { lowStockProducts, orderTotals, revenueSeries, revenueSince, startOfDay, topProducts } from "~/server/admin/analytics.server";
import { adminContext } from "~/server/admin/context.server";
import { listOrders } from "~/server/admin/orders.server";
import { queryValue } from "~/server/db.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/dashboard";

const DAY = 86_400_000;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const settings = await getSettings(db);
  const tz = settings.general.timezone;
  const currency = settings.general.currency;
  const now = Date.now();
  const today = startOfDay(now, tz);
  const [allTime, day, week, month, series, totals, top, lowStock, recent, products] = await Promise.all([
    revenueSince(db, 0, currency),
    revenueSince(db, today, currency),
    revenueSince(db, startOfDay(now - 6 * DAY, tz), currency),
    revenueSince(db, startOfDay(now - 29 * DAY, tz), currency),
    revenueSeries(db, 30, tz, currency),
    orderTotals(db, null),
    topProducts(db, startOfDay(now - 29 * DAY, tz), locale),
    lowStockProducts(db, settings.notifications.lowStockThreshold, locale),
    listOrders(db, locale, {}, 8, 0),
    queryValue<number>(db, "SELECT COUNT(*) FROM products WHERE is_active = 1"),
  ]);
  return { currency, allTime, day, week, month, series, totals, top, lowStock, recent: recent.items, products: products ?? 0, threshold: settings.notifications.lowStockThreshold };
}

export default function Dashboard({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const d = loaderData;
  const money = (value: number) => formatMoney(value, d.currency, locale);
  const compact = (value: number) =>
    new Intl.NumberFormat(LOCALE_META[locale].intl, { style: "currency", currency: d.currency, notation: "compact", maximumFractionDigits: 1 }).format(value / 100);
  const hasSales = d.series.some((point) => point.revenue > 0);
  const dayLabel = (key: string) => new Intl.DateTimeFormat(LOCALE_META[locale].intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.parse(`${key}T12:00:00Z`));

  return (
    <>
      <AdminPageHeader title={t("admin.dashboard.title")} description={t("admin.dashboard.description")} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("admin.dashboard.revenueToday")} value={money(d.day.revenue)} hint={t("admin.dashboard.ordersCount", { count: d.day.orders })} icon={CircleDollarSign} tone="accent" />
        <StatCard label={t("admin.dashboard.revenue7")} value={money(d.week.revenue)} hint={t("admin.dashboard.ordersCount", { count: d.week.orders })} icon={TrendingUp} />
        <StatCard label={t("admin.dashboard.revenue30")} value={money(d.month.revenue)} hint={t("admin.dashboard.ordersCount", { count: d.month.orders })} icon={TrendingUp} />
        <StatCard label={t("admin.dashboard.revenueAll")} value={money(d.allTime.revenue)} hint={t("admin.dashboard.ordersCount", { count: d.allTime.orders })} icon={CircleDollarSign} tone="success" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("admin.dashboard.orders")} value={formatNumber(d.totals.total, locale)} icon={ShoppingBag} />
        <StatCard label={t("admin.dashboard.paidOrders")} value={formatNumber(d.totals.paid, locale)} icon={ShoppingBag} tone="success" />
        <StatCard label={t("admin.dashboard.pendingOrders")} value={formatNumber(d.totals.pending, locale)} icon={Clock} tone="warning" />
        <StatCard label={t("admin.dashboard.products")} value={formatNumber(d.products, locale)} hint={d.lowStock.length ? t("admin.dashboard.lowStockCount", { count: d.lowStock.length }) : undefined} icon={Package} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel title={t("admin.dashboard.salesChart")} description={t("admin.dashboard.salesChartHint", { currency: d.currency })}>
          {hasSales ? (
            <BarChart
              title={t("admin.dashboard.salesChart")}
              format={compact}
              data={d.series.map((point) => ({ key: point.day, label: dayLabel(point.day), value: point.revenue, detail: t("admin.dashboard.ordersCount", { count: point.orders }) }))}
            />
          ) : (
            <EmptyState icon={TrendingUp} title={t("admin.empty.sales.title")} description={t("admin.empty.sales.text")} />
          )}
        </Panel>

        <Panel title={t("admin.dashboard.topProducts")} description={t("admin.dashboard.last30")} bodyClassName="p-0">
          {d.top.length === 0 ? (
            <EmptyState icon={Package} title={t("admin.empty.top.title")} description={t("admin.empty.top.text")} />
          ) : (
            <ul className="divide-y divide-line">
              {d.top.map((product, index) => {
                const share = d.top[0] ? product.revenue / d.top[0].revenue : 0;
                return (
                  <li key={`${product.productId}-${index}`} className="px-5 py-3.5">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate font-medium">{product.name}</span>
                      <span className="shrink-0 tabular">{money(product.revenue)}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent/10">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(share * 100, 2)}%` }} />
                      </div>
                      <span className="w-16 shrink-0 text-right text-xs text-fg-subtle tabular">{t("admin.dashboard.sold", { count: product.quantity })}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title={t("admin.dashboard.recentOrders")}
          bodyClassName="p-0"
          actions={
            <Link to="/admin/orders" className="btn btn-ghost btn-sm">
              {t("admin.viewAll")}
              <ArrowRight className="size-3.5" />
            </Link>
          }
        >
          {d.recent.length === 0 ? <EmptyState icon={ShoppingBag} title={t("admin.empty.orders.title")} description={t("admin.empty.orders.text")} /> : <OrdersTable orders={d.recent} compact />}
        </Panel>

        <Panel title={t("admin.dashboard.lowStock")} description={t("admin.dashboard.lowStockHint", { count: d.threshold })} bodyClassName="p-0">
          {d.lowStock.length === 0 ? (
            <EmptyState icon={Package} title={t("admin.empty.lowStock.title")} description={t("admin.empty.lowStock.text")} />
          ) : (
            <ul className="divide-y divide-line">
              {d.lowStock.map((product) => (
                <li key={product.id}>
                  <Link to={`/admin/inventory?product=${product.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm transition-colors hover:bg-white/[0.02]">
                    <span className="flex min-w-0 items-center gap-2.5">
                      <AlertTriangle className={product.available === 0 ? "size-4 shrink-0 text-danger" : "size-4 shrink-0 text-warning"} />
                      <span className="truncate">{product.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-fg-muted tabular">{t("admin.dashboard.left", { count: product.available })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
