import { ArrowUpRight, Search, Users } from "lucide-react";
import { Form, Link, useSubmit } from "react-router";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { EmptyState } from "~/components/ui/empty-state";
import { Pagination } from "~/components/ui/pagination";
import { useLocale, useT } from "~/i18n/react";
import { formatDate, formatNumber } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import { adminContext, likeTerm, pageParams } from "~/server/admin/context.server";
import { queryAll, queryValue } from "~/server/db.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/customers";

const SORTS = { recent: "last_order_at DESC", spent: "total_spent DESC", orders: "paid_orders_count DESC" } as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await adminContext(context, request);
  const settings = await getSettings(db);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const sortKey = (url.searchParams.get("sort") ?? "recent") as keyof typeof SORTS;
  const sort = SORTS[sortKey] ?? SORTS.recent;
  const { page, pageSize, offset } = pageParams(url, 30);
  const clause = q ? "WHERE lower(email) LIKE ? ESCAPE '\\' OR lower(COALESCE(telegram, '')) LIKE ? ESCAPE '\\'" : "";
  const params = q ? [likeTerm(q), likeTerm(q)] : [];
  const [customers, total] = await Promise.all([
    queryAll<{ id: string; email: string; telegram: string | null; locale: string | null; orders_count: number; paid_orders_count: number; total_spent: number; first_seen_at: number; last_order_at: number }>(
      db,
      `SELECT * FROM customers ${clause} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    ),
    queryValue<number>(db, `SELECT COUNT(*) FROM customers ${clause}`, ...params),
  ]);
  return { customers, total: total ?? 0, page, pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)), currency: settings.general.currency, params: { q, sort: sortKey } };
}

export default function Customers({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const submit = useSubmit();
  const { customers, total, page, pageCount, currency, params } = loaderData;
  return (
    <>
      <AdminPageHeader title={t("admin.customers.title")} description={t("admin.customers.description", { count: total })} />
      <Form method="get" className="mb-4 grid gap-2 sm:grid-cols-[1fr_220px]" onChange={(event) => submit(event.currentTarget, { replace: true })}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input name="q" defaultValue={params.q} placeholder={t("admin.customers.search")} className="input pl-9" aria-label={t("admin.customers.search")} />
        </div>
        <select name="sort" defaultValue={params.sort} className="input" aria-label={t("admin.sort")}>
          <option value="recent">{t("admin.customers.sort.recent")}</option>
          <option value="spent">{t("admin.customers.sort.spent")}</option>
          <option value="orders">{t("admin.customers.sort.orders")}</option>
        </select>
      </Form>
      <TableShell footer={<Pagination page={page} pageCount={pageCount} total={total} />}>
        {customers.length === 0 ? (
          <EmptyState icon={Users} title={t("admin.empty.customers.title")} description={t("admin.empty.customers.text")} />
        ) : (
          <table className="data-table min-w-[720px]">
            <thead>
              <tr>
                <th>{t("admin.customers.col.customer")}</th>
                <th className="text-right">{t("admin.customers.col.orders")}</th>
                <th className="text-right">{t("admin.customers.col.spent")}</th>
                <th>{t("admin.customers.col.first")}</th>
                <th>{t("admin.customers.col.last")}</th>
                <th>
                  <span className="sr-only">{t("admin.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {customers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <p className="font-medium">{customer.email}</p>
                    <p className="text-xs text-fg-subtle">
                      {customer.telegram ? `@${customer.telegram}` : "—"}
                      {customer.locale ? ` · ${customer.locale.toUpperCase()}` : ""}
                    </p>
                  </td>
                  <td className="text-right tabular">
                    {formatNumber(customer.paid_orders_count, locale)}
                    <span className="text-fg-subtle"> / {formatNumber(customer.orders_count, locale)}</span>
                  </td>
                  <td className="text-right font-medium tabular">{formatMoney(customer.total_spent, currency, locale)}</td>
                  <td className="text-xs text-fg-subtle">{formatDate(customer.first_seen_at, locale)}</td>
                  <td className="text-xs text-fg-subtle">{formatDate(customer.last_order_at, locale)}</td>
                  <td className="text-right">
                    <Link to={`/admin/orders?customer=${encodeURIComponent(customer.email)}`} className="btn btn-ghost btn-sm">
                      {t("admin.nav.orders")}
                      <ArrowUpRight className="size-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableShell>
    </>
  );
}
