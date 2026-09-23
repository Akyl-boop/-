import { BarChart3, CircleDollarSign, Percent, Receipt, ShoppingBag, Undo2 } from "lucide-react";
import { Link } from "react-router";
import { BarChart } from "~/components/admin/bar-chart";
import { AdminPageHeader, Panel, StatCard } from "~/components/admin/page";
import { EmptyState } from "~/components/ui/empty-state";
import { useLocale, useT } from "~/i18n/react";
import { LOCALE_META } from "~/i18n/config";
import { ORDER_STATUSES } from "~/lib/domain";
import { cn, formatNumber } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import { orderTotals, revenueSeries, startOfDay, topProducts } from "~/server/admin/analytics.server";
import { adminContext } from "~/server/admin/context.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/analytics";

const RANGES = [7, 30, 90] as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const settings = await getSettings(db);
  const url = new URL(request.url);
  const days = RANGES.find((range) => String(range) === url.searchParams.get("days")) ?? 30;
  const tz = settings.general.timezone;
  const since = startOfDay(Date.now() - (days - 1) * 86_400_000, tz);
  const [series, totals, top] = await Promise.all([revenueSeries(db, days, tz, settings.general.currency), orderTotals(db, since), topProducts(db, since, locale, 10)]);
  const revenue = series.reduce((sum, point) => sum + point.revenue, 0);
  const paidOrders = series.reduce((sum, point) => sum + point.orders, 0);
  return { days, series, totals, top, revenue, paidOrders, currency: settings.general.currency };
}

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const d = loaderData;
  const money = (value: number) => formatMoney(value, d.currency, locale);
  const compact = (value: number) => new Intl.NumberFormat(LOCALE_META[locale].intl, { style: "currency", currency: d.currency, notation: "compact", maximumFractionDigits: 1 }).format(value / 100);
  const aov = d.paidOrders ? Math.round(d.revenue / d.paidOrders) : 0;
  const conversion = d.totals.total ? Math.round((d.totals.paid / d.totals.total) * 1000) / 10 : 0;
  const dayLabel = (key: string) => new Intl.DateTimeFormat(LOCALE_META[locale].intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.parse(`${key}T12:00:00Z`));
  const maxStatus = Math.max(1, ...ORDER_STATUSES.map((status) => d.totals.byStatus[status] ?? 0));

  return (
    <>
      <AdminPageHeader
        title={t("admin.analytics.title")}
        description={t("admin.analytics.description")}
        actions={
          <div className="inline-flex rounded-xl border border-line bg-panel-2/60 p-1">
            {RANGES.map((range) => (
              <Link key={range} to={`?days=${range}`} preventScrollReset className={cn("rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors", d.days === range ? "bg-panel-3 text-fg" : "text-fg-muted hover:text-fg")}>
                {t("admin.analytics.days", { count: range })}
              </Link>
            ))}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label={t("admin.analytics.revenue")} value={money(d.revenue)} icon={CircleDollarSign} tone="accent" />
        <StatCard label={t("admin.dashboard.paidOrders")} value={formatNumber(d.paidOrders, locale)} icon={ShoppingBag} tone="success" />
        <StatCard label={t("admin.analytics.aov")} value={money(aov)} icon={Receipt} />
        <StatCard label={t("admin.analytics.conversion")} value={`${conversion}%`} hint={t("admin.analytics.conversionHint", { paid: d.totals.paid, total: d.totals.total })} icon={Percent} />
        <StatCard label={t("status.refunded")} value={formatNumber(d.totals.byStatus.refunded ?? 0, locale)} icon={Undo2} tone="warning" />
      </div>

      <Panel className="mt-6" title={t("admin.dashboard.salesChart")} description={t("admin.dashboard.salesChartHint", { currency: d.currency })}>
        {d.revenue > 0 ? (
          <BarChart title={t("admin.dashboard.salesChart")} format={compact} height={260} data={d.series.map((point) => ({ key: point.day, label: dayLabel(point.day), value: point.revenue, detail: t("admin.dashboard.ordersCount", { count: point.orders }) }))} />
        ) : (
          <EmptyState icon={BarChart3} title={t("admin.empty.sales.title")} description={t("admin.empty.sales.text")} />
        )}
      </Panel>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_1.3fr]">
        <Panel title={t("admin.analytics.funnel")} description={t("admin.analytics.funnelHint")}>
          {d.totals.total === 0 ? (
            <EmptyState icon={ShoppingBag} title={t("admin.empty.orders.title")} description={t("admin.empty.orders.text")} />
          ) : (
            <ul className="space-y-3">
              {ORDER_STATUSES.map((status) => {
                const count = d.totals.byStatus[status] ?? 0;
                return (
                  <li key={status}>
                    <div className="flex justify-between text-[13px]">
                      <span className="text-fg-muted">{t(`status.${status}`)}</span>
                      <span className="tabular">{formatNumber(count, locale)}</span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-accent/10">
                      <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: count ? `${Math.max((count / maxStatus) * 100, 2)}%` : "0%" }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
        <Panel title={t("admin.dashboard.topProducts")} bodyClassName="p-0">
          {d.top.length === 0 ? (
            <EmptyState icon={BarChart3} title={t("admin.empty.top.title")} description={t("admin.empty.top.text")} />
          ) : (
            <div className="overflow-x-auto">
              <table className="data-table min-w-[480px]">
                <thead>
                  <tr>
                    <th>{t("admin.products.col.product")}</th>
                    <th className="text-right">{t("admin.analytics.units")}</th>
                    <th className="text-right">{t("admin.nav.orders")}</th>
                    <th className="text-right">{t("admin.analytics.revenue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.top.map((row, index) => (
                    <tr key={`${row.productId}-${index}`}>
                      <td className="max-w-[260px] truncate font-medium">{row.name}</td>
                      <td className="text-right tabular">{formatNumber(row.quantity, locale)}</td>
                      <td className="text-right tabular">{formatNumber(row.orders, locale)}</td>
                      <td className="text-right font-medium tabular">{money(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
