import type { Locale } from "~/i18n/config";
import { ORDER_STATUSES, type OrderStatus, type PaymentMethodId, type PaymentStatus } from "~/lib/domain";
import { parseLocalized, pickText } from "~/lib/localized";
import { queryAll, queryValue } from "../db.server";
import { likeTerm } from "./context.server";

export interface AdminOrderListItem {
  id: string;
  number: string;
  email: string;
  telegram: string | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethodId;
  total: number;
  currency: string;
  createdAt: number;
  paidAt: number | null;
  products: string;
  quantity: number;
  hasReference: boolean;
}

export interface OrderFilters {
  q?: string | null;
  status?: string | null;
  method?: string | null;
  from?: number | null;
  to?: number | null;
  customer?: string | null;
}

export async function listOrders(db: D1Database, locale: Locale, filters: OrderFilters, limit: number, offset: number) {
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filters.q) {
    where.push("(lower(o.number) LIKE ? ESCAPE '\\' OR lower(o.email) LIKE ? ESCAPE '\\' OR lower(COALESCE(o.telegram, '')) LIKE ? ESCAPE '\\')");
    const term = likeTerm(filters.q);
    params.push(term, term, term);
  }
  if (filters.status === "attention") {
    where.push("(o.status = 'processing' OR (o.status = 'waiting_payment' AND o.payment_method = 'manual_crypto'))");
  } else if (filters.status && (ORDER_STATUSES as readonly string[]).includes(filters.status)) {
    where.push("o.status = ?");
    params.push(filters.status);
  }
  if (filters.method) {
    where.push("o.payment_method = ?");
    params.push(filters.method);
  }
  if (filters.customer) {
    where.push("o.email = ? COLLATE NOCASE");
    params.push(filters.customer);
  }
  if (filters.from) {
    where.push("o.created_at >= ?");
    params.push(filters.from);
  }
  if (filters.to) {
    where.push("o.created_at < ?");
    params.push(filters.to);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total] = await Promise.all([
    queryAll<{
      id: string;
      number: string;
      email: string;
      telegram: string | null;
      status: OrderStatus;
      payment_status: PaymentStatus;
      payment_method: PaymentMethodId;
      total: number;
      currency: string;
      created_at: number;
      paid_at: number | null;
      products: string | null;
      quantity: number | null;
      has_reference: number;
    }>(
      db,
      `SELECT o.id, o.number, o.email, o.telegram, o.status, o.payment_status, o.payment_method, o.total, o.currency, o.created_at, o.paid_at,
         (SELECT json_group_array(product_name) FROM order_items WHERE order_id = o.id) AS products,
         (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS quantity,
         EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.tx_reference IS NOT NULL) AS has_reference
       FROM orders o ${clause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    ),
    queryValue<number>(db, `SELECT COUNT(*) FROM orders o ${clause}`, ...params),
  ]);
  const items: AdminOrderListItem[] = rows.map((row) => ({
    id: row.id,
    number: row.number,
    email: row.email,
    telegram: row.telegram,
    status: row.status,
    paymentStatus: row.payment_status,
    paymentMethod: row.payment_method,
    total: row.total,
    currency: row.currency,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    products: (JSON.parse(row.products ?? "[]") as string[]).map((name) => pickText(parseLocalized(name), locale)).join(", "),
    quantity: row.quantity ?? 0,
    hasReference: Boolean(row.has_reference),
  }));
  return { items, total: total ?? 0 };
}
