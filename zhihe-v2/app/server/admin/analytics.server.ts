import { REVENUE_STATUSES } from "~/lib/domain";
import { parseLocalized, pickText } from "~/lib/localized";
import type { Locale } from "~/i18n/config";
import { queryAll, queryFirst } from "../db.server";

const REVENUE_SQL = REVENUE_STATUSES.map((status) => `'${status}'`).join(", ");
const DAY = 86_400_000;

/** yyyy-mm-dd of a timestamp in the store's time zone. */
export function dayKey(timestamp: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(timestamp);
  } catch {
    return new Date(timestamp).toISOString().slice(0, 10);
  }
}

function zoneOffset(timestamp: number, timeZone: string): number {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(timestamp)
        .map((part) => [part.type, Number(part.value)]),
    ) as Record<string, number>;
    return Date.UTC(parts.year ?? 1970, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0) - Math.floor(timestamp / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Unix ms at 00:00 of the store-local day containing `timestamp`. */
export function startOfDay(timestamp: number, timeZone: string): number {
  const midnightUtc = Date.parse(`${dayKey(timestamp, timeZone)}T00:00:00Z`);
  return midnightUtc - zoneOffset(midnightUtc, timeZone);
}

export interface RevenuePoint {
  day: string;
  revenue: number;
  orders: number;
}

export async function revenueSeries(db: D1Database, days: number, timeZone: string, currency: string): Promise<RevenuePoint[]> {
  const now = Date.now();
  const since = startOfDay(now - (days - 1) * DAY, timeZone);
  const rows = await queryAll<{ paid_at: number; total: number }>(
    db,
    `SELECT paid_at, total FROM orders WHERE paid_at >= ? AND status IN (${REVENUE_SQL}) AND currency = ?`,
    since,
    currency,
  );
  const buckets = new Map<string, RevenuePoint>();
  for (let i = 0; i < days; i++) {
    const key = dayKey(since + i * DAY + DAY / 2, timeZone);
    buckets.set(key, { day: key, revenue: 0, orders: 0 });
  }
  for (const row of rows) {
    const bucket = buckets.get(dayKey(row.paid_at, timeZone));
    if (!bucket) continue;
    bucket.revenue += row.total;
    bucket.orders += 1;
  }
  return [...buckets.values()];
}

export async function revenueSince(db: D1Database, since: number, currency: string): Promise<{ revenue: number; orders: number }> {
  const row = await queryFirst<{ revenue: number | null; orders: number }>(
    db,
    `SELECT SUM(total) AS revenue, COUNT(*) AS orders FROM orders WHERE paid_at >= ? AND status IN (${REVENUE_SQL}) AND currency = ?`,
    since,
    currency,
  );
  return { revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 };
}

export async function orderTotals(db: D1Database, since: number | null) {
  const where = since ? "WHERE created_at >= ?" : "";
  const rows = await queryAll<{ status: string; n: number }>(db, `SELECT status, COUNT(*) AS n FROM orders ${where} GROUP BY status`, ...(since ? [since] : []));
  const byStatus = Object.fromEntries(rows.map((row) => [row.status, row.n])) as Record<string, number>;
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  const paid = REVENUE_STATUSES.reduce((sum, status) => sum + (byStatus[status] ?? 0), 0) + (byStatus.refunded ?? 0);
  return { total, paid, byStatus, pending: (byStatus.pending ?? 0) + (byStatus.waiting_payment ?? 0) };
}

export async function topProducts(db: D1Database, since: number | null, locale: Locale, limit = 5) {
  const rows = await queryAll<{ product_id: string | null; name: string; quantity: number; revenue: number; orders: number }>(
    db,
    `SELECT oi.product_id, MAX(oi.product_name) AS name, SUM(oi.quantity) AS quantity, SUM(oi.total) AS revenue, COUNT(DISTINCT oi.order_id) AS orders
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE o.status IN (${REVENUE_SQL}) ${since ? "AND o.paid_at >= ?" : ""}
     GROUP BY COALESCE(oi.product_id, oi.product_name) ORDER BY revenue DESC LIMIT ${Math.min(limit, 50)}`,
    ...(since ? [since] : []),
  );
  return rows.map((row) => ({ productId: row.product_id, name: pickText(parseLocalized(row.name), locale), quantity: row.quantity, revenue: row.revenue, orders: row.orders }));
}

export async function lowStockProducts(db: D1Database, threshold: number, locale: Locale) {
  const rows = await queryAll<{ id: string; name: string; available: number }>(
    db,
    `SELECT p.id, p.name, (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'available') AS available
     FROM products p WHERE p.is_active = 1 AND p.delivery_type = 'inventory'
     ORDER BY available ASC LIMIT 50`,
  );
  return rows.filter((row) => row.available <= threshold).map((row) => ({ id: row.id, name: pickText(parseLocalized(row.name), locale), available: row.available }));
}
