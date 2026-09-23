import { Download, Search, ShoppingBag } from "lucide-react";
import { Form, useSubmit } from "react-router";
import { OrdersTable } from "~/components/admin/orders-table";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { EmptyState } from "~/components/ui/empty-state";
import { Pagination } from "~/components/ui/pagination";
import { useT } from "~/i18n/react";
import { ORDER_STATUSES, PAYMENT_METHODS } from "~/lib/domain";
import { adminContext, pageParams } from "~/server/admin/context.server";
import { listOrders } from "~/server/admin/orders.server";
import type { Route } from "./+types/orders";

function parseDate(value: string | null, endOfDay = false): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) ? time + (endOfDay ? 86_400_000 : 0) : null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const url = new URL(request.url);
  const filters = {
    q: url.searchParams.get("q")?.trim().slice(0, 100) || null,
    status: url.searchParams.get("status") || null,
    method: url.searchParams.get("method") || null,
    customer: url.searchParams.get("customer") || null,
    from: parseDate(url.searchParams.get("from")),
    to: parseDate(url.searchParams.get("to"), true),
  };
  if (url.searchParams.get("export") === "csv") {
    const { items } = await listOrders(db, locale, filters, 5000, 0);
    const escape = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = [
      ["number", "created_at", "status", "payment_status", "method", "email", "telegram", "products", "quantity", "total", "currency", "paid_at"].join(","),
      ...items.map((order) =>
        [order.number, new Date(order.createdAt).toISOString(), order.status, order.paymentStatus, order.paymentMethod, order.email, order.telegram, order.products, order.quantity, (order.total / 100).toFixed(2), order.currency, order.paidAt ? new Date(order.paidAt).toISOString() : ""]
          .map(escape)
          .join(","),
      ),
    ];
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.csv"` } });
  }
  const { page, pageSize, offset } = pageParams(url);
  const { items, total } = await listOrders(db, locale, filters, pageSize, offset);
  return { items, total, page, pageCount: Math.max(1, Math.ceil(total / pageSize)), params: Object.fromEntries(url.searchParams) };
}

export default function Orders({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const submit = useSubmit();
  const { items, total, page, pageCount, params } = loaderData;
  const exportParams = new URLSearchParams(params);
  exportParams.set("export", "csv");
  exportParams.delete("page");

  return (
    <>
      <AdminPageHeader
        title={t("admin.orders.title")}
        description={t("admin.orders.description", { count: total })}
        actions={
          <a href={`/admin/orders?${exportParams.toString()}`} className="btn btn-secondary btn-sm">
            <Download className="size-3.5" />
            CSV
          </a>
        }
      />
      <Form method="get" className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-[1fr_180px_180px_150px_150px]" onChange={(event) => submit(event.currentTarget, { replace: true })}>
        <div className="relative col-span-2 lg:col-span-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input name="q" defaultValue={params.q ?? ""} placeholder={t("admin.orders.search")} className="input pl-9" aria-label={t("admin.orders.search")} />
        </div>
        <select name="status" defaultValue={params.status ?? ""} className="input" aria-label={t("admin.orders.col.status")}>
          <option value="">{t("admin.orders.allStatuses")}</option>
          <option value="attention">{t("admin.orders.needsAttention")}</option>
          {ORDER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`status.${status}`)}
            </option>
          ))}
        </select>
        <select name="method" defaultValue={params.method ?? ""} className="input" aria-label={t("admin.orders.col.method")}>
          <option value="">{t("admin.orders.allMethods")}</option>
          {PAYMENT_METHODS.map((method) => (
            <option key={method} value={method}>
              {t(`payment.method.${method}`)}
            </option>
          ))}
        </select>
        <input type="date" name="from" defaultValue={params.from ?? ""} className="input" aria-label={t("admin.filters.from")} />
        <input type="date" name="to" defaultValue={params.to ?? ""} className="input" aria-label={t("admin.filters.to")} />
        {params.customer ? <input type="hidden" name="customer" value={params.customer} /> : null}
      </Form>
      <TableShell footer={<Pagination page={page} pageCount={pageCount} total={total} />}>
        {items.length === 0 ? <EmptyState icon={ShoppingBag} title={t("admin.empty.orders.title")} description={t("admin.empty.filtered")} /> : <OrdersTable orders={items} />}
      </TableShell>
    </>
  );
}
