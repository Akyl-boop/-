import { ChevronRight, Hourglass } from "lucide-react";
import { Link } from "react-router";
import { OrderStatusBadge } from "~/components/ui/status-badge";
import { useLocale, useT } from "~/i18n/react";
import { formatDateTime } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import type { AdminOrderListItem } from "~/server/admin/orders.server";

export function OrdersTable({ orders, compact = false }: { orders: AdminOrderListItem[]; compact?: boolean }) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <ul className="divide-y divide-line md:hidden">
        {orders.map((order) => (
          <li key={order.id}>
            <Link to={`/admin/orders/${order.id}`} className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-white/[0.02]">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[13px] font-semibold">{order.number}</span>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mt-1 truncate text-xs text-fg-subtle">
                  {order.products} · {order.email}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular">{formatMoney(order.total, order.currency, locale)}</p>
                <p className="text-[11px] text-fg-subtle">{formatDateTime(order.createdAt, locale)}</p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
            </Link>
          </li>
        ))}
      </ul>
      <table className="data-table hidden md:table">
        <thead>
          <tr>
            <th>{t("admin.orders.col.order")}</th>
            {!compact ? <th>{t("admin.orders.col.customer")}</th> : null}
            <th>{t("admin.orders.col.product")}</th>
            <th>{t("admin.orders.col.status")}</th>
            {!compact ? <th>{t("admin.orders.col.method")}</th> : null}
            <th className="text-right">{t("admin.orders.col.total")}</th>
            {!compact ? <th className="text-right">{t("admin.orders.col.created")}</th> : null}
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="cursor-pointer">
              <td>
                <Link to={`/admin/orders/${order.id}`} className="font-mono text-[13px] font-semibold whitespace-nowrap hover:text-accent-strong">
                  {order.number}
                </Link>
                {compact ? <p className="max-w-[200px] truncate text-xs text-fg-subtle">{order.email}</p> : null}
              </td>
              {!compact ? (
                <td className="max-w-[220px]">
                  <p className="truncate">{order.email}</p>
                  {order.telegram ? <p className="truncate text-xs text-fg-subtle">@{order.telegram}</p> : null}
                </td>
              ) : null}
              <td className="max-w-[240px]">
                <p className="truncate text-fg-muted">{order.products}</p>
                <p className="text-xs text-fg-subtle">× {order.quantity}</p>
              </td>
              <td>
                <div className="flex items-center gap-1.5">
                  <OrderStatusBadge status={order.status} />
                  {order.hasReference && order.status === "waiting_payment" ? <Hourglass className="size-3.5 text-info" aria-label={t("admin.orders.referenceSubmitted")} /> : null}
                </div>
              </td>
              {!compact ? <td className="whitespace-nowrap text-fg-muted">{t(`payment.method.${order.paymentMethod}`)}</td> : null}
              <td className="text-right font-medium tabular">{formatMoney(order.total, order.currency, locale)}</td>
              {!compact ? <td className="text-right text-xs whitespace-nowrap text-fg-subtle">{formatDateTime(order.createdAt, locale)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
