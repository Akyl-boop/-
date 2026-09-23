import { isLocale, type Locale } from "~/i18n/config";
import { PAYABLE_STATUSES } from "~/lib/domain";
import { parseLocalized, pickText } from "~/lib/localized";
import { formatMoney } from "~/lib/money";
import { bindList, queryAll, queryFirst } from "./db.server";
import { emailLayout, escapeHtml, sendEmail } from "./notify/email.server";
import { escapeTelegramHtml, notifyAdminTelegram } from "./notify/telegram.server";
import { EVENT, eventStatement, getOrderById, orderLink, type OrderItemRow, type OrderRow } from "./orders.server";
import { serverT } from "./locale.server";
import { getSettings } from "./settings.server";

type Actor = string;

function defer(ctx: ExecutionContext | null, task: Promise<unknown>): void {
  const safe = task.catch((error: unknown) => console.error("background task failed", error));
  if (ctx) ctx.waitUntil(safe);
}

const PAYABLE_SQL = PAYABLE_STATUSES.map((status) => `'${status}'`).join(", ");

export interface ApplyPaymentResult {
  applied: boolean;
  order: OrderRow | null;
}

/**
 * Marks an order paid exactly once and triggers delivery. The conditional
 * UPDATE is the idempotency guard: concurrent webhooks, retries or repeated
 * admin clicks can only ever win it once.
 */
export async function applyPayment(
  env: Env,
  ctx: ExecutionContext | null,
  args: { orderId: string; paymentId?: string | null; actor: Actor; reference?: string | null },
): Promise<ApplyPaymentResult> {
  const db = env.DB;
  const now = Date.now();
  const claim = await db
    .prepare(
      `UPDATE orders SET status = 'paid', payment_status = 'paid', paid_at = COALESCE(paid_at, ?1), expires_at = NULL, updated_at = ?1
       WHERE id = ?2 AND status IN (${PAYABLE_SQL})`,
    )
    .bind(now, args.orderId)
    .run();
  if ((claim.meta.changes ?? 0) === 0) {
    return { applied: false, order: await getOrderById(db, args.orderId) };
  }

  const order = await getOrderById(db, args.orderId);
  if (!order) return { applied: false, order: null };

  const statements: D1PreparedStatement[] = [
    eventStatement(db, order.id, EVENT.paymentReceived, { actor: args.actor, message: args.reference ?? "" }),
    db.prepare("UPDATE promo_redemptions SET status = 'redeemed' WHERE order_id = ?").bind(order.id),
    db
      .prepare("UPDATE customers SET paid_orders_count = paid_orders_count + 1, total_spent = total_spent + ? WHERE id = ?")
      .bind(order.total, order.customer_id),
  ];
  if (args.paymentId) {
    statements.push(
      db
        .prepare("UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, ?1), updated_at = ?1, tx_reference = COALESCE(?2, tx_reference) WHERE id = ?3")
        .bind(now, args.reference ?? null, args.paymentId),
    );
  } else {
    statements.push(
      db
        .prepare("UPDATE payments SET status = 'paid', paid_at = COALESCE(paid_at, ?1), updated_at = ?1 WHERE order_id = ?2 AND status IN ('created', 'pending', 'expired')")
        .bind(now, order.id),
    );
  }
  // A late payment on an expired order must re-take the finite stock released at cancellation.
  const items = await queryAll<OrderItemRow>(db, "SELECT * FROM order_items WHERE order_id = ?", order.id);
  for (const item of items) {
    if (item.stock_reserved || item.delivery_type === "inventory" || !item.product_id) continue;
    statements.push(...stockStatements(db, item, -1));
    statements.push(db.prepare("UPDATE order_items SET stock_reserved = 1 WHERE id = ?").bind(item.id));
  }
  await db.batch(statements);

  const fresh = await deliverOrder(env, ctx, order.id, args.actor);
  defer(ctx, notifyPaidOrder(env, order.id));
  return { applied: true, order: fresh };
}

/** Adjusts finite (non-inventory) stock. direction -1 takes stock, +1 returns it. */
function stockStatements(db: D1Database, item: OrderItemRow, direction: 1 | -1): D1PreparedStatement[] {
  const delta = direction * item.quantity;
  if (item.variant_id) {
    return [
      db
        .prepare("UPDATE product_variants SET stock = MAX(stock + ?, 0) WHERE id = ? AND unlimited_stock = 0")
        .bind(delta, item.variant_id),
    ];
  }
  return [
    db
      .prepare("UPDATE products SET stock = MAX(stock + ?, 0) WHERE id = ? AND unlimited_stock = 0 AND delivery_type = 'manual'")
      .bind(delta, item.product_id),
  ];
}

/**
 * Idempotent delivery. Inventory is assigned as "quantity minus already sold
 * to this line", so re-running can never hand out a second unit. Only runs for
 * orders that are actually paid.
 */
export async function deliverOrder(env: Env, ctx: ExecutionContext | null, orderId: string, actor: Actor = "system"): Promise<OrderRow | null> {
  const db = env.DB;
  const now = Date.now();
  const items = await queryAll<OrderItemRow>(db, "SELECT * FROM order_items WHERE order_id = ?", orderId);
  const paidGuard = "EXISTS (SELECT 1 FROM orders WHERE id = ?1 AND status IN ('paid', 'processing'))";
  const statements: D1PreparedStatement[] = [];

  for (const item of items) {
    if (item.delivery_type === "inventory") {
      statements.push(
        db
          .prepare(`UPDATE inventory SET status = 'sold', sold_at = ?2, reserved_until = NULL WHERE order_item_id = ?3 AND status = 'reserved' AND ${paidGuard}`)
          .bind(orderId, now, item.id),
        db
          .prepare(
            `UPDATE inventory SET status = 'sold', order_id = ?1, order_item_id = ?3, sold_at = ?2, reserved_until = NULL
             WHERE ${paidGuard} AND id IN (
               SELECT id FROM inventory
               WHERE product_id = ?4 AND variant_id IS ?5
                 AND (status = 'available' OR (status = 'reserved' AND reserved_until < ?2))
               ORDER BY created_at, id
               LIMIT MAX(0, ?6 - (SELECT COUNT(*) FROM inventory WHERE order_item_id = ?3 AND status = 'sold'))
             )`,
          )
          .bind(orderId, now, item.id, item.product_id, item.variant_id, item.quantity),
        db
          .prepare(
            `UPDATE order_items SET delivered_quantity = (SELECT COUNT(*) FROM inventory WHERE order_item_id = ?1 AND status = 'sold')
             WHERE id = ?1`,
          )
          .bind(item.id),
      );
    } else if (item.delivery_type === "static") {
      statements.push(
        db
          .prepare(
            `UPDATE order_items SET delivery_content = (SELECT static_delivery FROM products WHERE id = ?3), delivered_quantity = quantity
             WHERE id = ?2 AND delivered_quantity < quantity AND ${paidGuard}`,
          )
          .bind(orderId, item.id, item.product_id),
      );
    }
    statements.push(
      db.prepare("UPDATE order_items SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND delivered_quantity >= quantity").bind(now, item.id),
    );
  }
  if (statements.length > 0) await db.batch(statements);

  const refreshed = await queryAll<OrderItemRow>(db, "SELECT * FROM order_items WHERE order_id = ?", orderId);
  const complete = refreshed.length > 0 && refreshed.every((item) => item.delivered_quantity >= item.quantity);
  const anyDelivered = refreshed.some((item) => item.delivered_quantity > 0);

  if (complete) {
    const result = await db
      .prepare(
        `UPDATE orders SET status = 'completed', delivered_at = COALESCE(delivered_at, ?1), completed_at = COALESCE(completed_at, ?1), updated_at = ?1
         WHERE id = ?2 AND status IN ('paid', 'processing')`,
      )
      .bind(now, orderId)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      await db.batch([eventStatement(db, orderId, EVENT.delivered, { actor, at: now }), eventStatement(db, orderId, EVENT.completed, { actor, at: now + 1 })]);
      defer(ctx, notifyDelivered(env, orderId));
    }
  } else {
    const result = await db
      .prepare("UPDATE orders SET status = 'processing', delivered_at = CASE WHEN ?1 THEN COALESCE(delivered_at, ?2) ELSE delivered_at END, updated_at = ?2 WHERE id = ?3 AND status = 'paid'")
      .bind(anyDelivered ? 1 : 0, now, orderId)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      const shortage = refreshed.some((item) => item.delivery_type === "inventory" && item.delivered_quantity < item.quantity);
      const statements = [eventStatement(db, orderId, EVENT.awaitingFulfillment, { actor })];
      if (shortage) statements.push(eventStatement(db, orderId, EVENT.shortage, { actor, internal: true }));
      await db.batch(statements);
    }
  }
  return getOrderById(db, orderId);
}

/** Admin fulfilment for manual products. Only fills lines that are not yet delivered. */
export async function deliverManually(env: Env, ctx: ExecutionContext | null, orderId: string, itemId: string, content: string, actor: Actor): Promise<boolean> {
  const db = env.DB;
  const result = await db
    .prepare(
      `UPDATE order_items SET delivery_content = ?1, delivered_quantity = quantity, delivered_at = COALESCE(delivered_at, ?2)
       WHERE id = ?3 AND order_id = ?4 AND delivery_type != 'inventory'
         AND EXISTS (SELECT 1 FROM orders WHERE id = ?4 AND status IN ('paid', 'processing', 'completed'))`,
    )
    .bind(content, Date.now(), itemId, orderId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return false;
  await deliverOrder(env, ctx, orderId, actor);
  return true;
}

/** Releases every hold of an unpaid order: inventory reservations, finite stock and promo usage. */
function releaseStatements(db: D1Database, orderId: string, items: OrderItemRow[]): D1PreparedStatement[] {
  const statements = [
    db
      .prepare("UPDATE inventory SET status = 'available', order_id = NULL, order_item_id = NULL, reserved_until = NULL WHERE order_id = ? AND status = 'reserved'")
      .bind(orderId),
    db.prepare("UPDATE promo_redemptions SET status = 'released' WHERE order_id = ? AND status = 'reserved'").bind(orderId),
  ];
  for (const item of items) {
    if (!item.stock_reserved || item.delivery_type === "inventory" || !item.product_id) continue;
    statements.push(...stockStatements(db, item, 1));
    statements.push(db.prepare("UPDATE order_items SET stock_reserved = 0 WHERE id = ?").bind(item.id));
  }
  return statements;
}

export async function cancelUnpaidOrder(
  env: Env,
  orderId: string,
  options: { actor: Actor; reason: "cancelled" | "expired" | "failed"; message?: string },
): Promise<boolean> {
  const db = env.DB;
  const now = Date.now();
  const status = options.reason === "failed" ? "failed" : "cancelled";
  const paymentStatus = options.reason === "failed" ? "failed" : "unpaid";
  const result = await db
    .prepare(
      `UPDATE orders SET status = ?1, payment_status = ?2, cancelled_at = ?3, expires_at = NULL, updated_at = ?3
       WHERE id = ?4 AND status IN ('pending', 'waiting_payment')`,
    )
    .bind(status, paymentStatus, now, orderId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return false;
  const items = await queryAll<OrderItemRow>(db, "SELECT * FROM order_items WHERE order_id = ?", orderId);
  const eventType = options.reason === "expired" ? EVENT.expired : options.reason === "failed" ? EVENT.failed : EVENT.cancelled;
  await db.batch([
    ...releaseStatements(db, orderId, items),
    db
      .prepare("UPDATE payments SET status = ?1, updated_at = ?2 WHERE order_id = ?3 AND status IN ('created', 'pending')")
      .bind(options.reason === "failed" ? "failed" : "expired", now, orderId),
    eventStatement(db, orderId, eventType, { actor: options.actor, message: options.message }),
  ]);
  return true;
}

/** Refund bookkeeping. Delivered units stay sold — they were already handed over. */
export async function markRefunded(env: Env, orderId: string, actor: Actor, message: string): Promise<boolean> {
  const db = env.DB;
  const now = Date.now();
  const order = await getOrderById(db, orderId);
  if (!order || !["paid", "processing", "completed"].includes(order.status)) return false;
  const result = await db
    .prepare("UPDATE orders SET status = 'refunded', payment_status = 'refunded', updated_at = ?1 WHERE id = ?2 AND status IN ('paid', 'processing', 'completed')")
    .bind(now, orderId)
    .run();
  if ((result.meta.changes ?? 0) === 0) return false;
  await db.batch([
    db.prepare("UPDATE payments SET status = 'refunded', updated_at = ? WHERE order_id = ? AND status = 'paid'").bind(now, orderId),
    db
      .prepare("UPDATE customers SET paid_orders_count = MAX(paid_orders_count - 1, 0), total_spent = MAX(total_spent - ?, 0) WHERE id = ?")
      .bind(order.total, order.customer_id),
    eventStatement(db, orderId, EVENT.refunded, { actor, message }),
  ]);
  return true;
}

/** Cron: cancel unpaid orders past their hold, reconciling API payments first. */
export async function expireStaleOrders(env: Env, reconcile: (order: OrderRow) => Promise<boolean>): Promise<number> {
  const stale = await queryAll<OrderRow>(
    env.DB,
    "SELECT * FROM orders WHERE status IN ('pending', 'waiting_payment') AND expires_at IS NOT NULL AND expires_at < ? LIMIT 50",
    Date.now(),
  );
  let expired = 0;
  for (const order of stale) {
    if (await reconcile(order)) continue;
    if (await cancelUnpaidOrder(env, order.id, { actor: "system", reason: "expired" })) expired++;
  }
  return expired;
}

async function orderSummary(env: Env, orderId: string) {
  const order = await getOrderById(env.DB, orderId);
  if (!order) return null;
  const items = await queryAll<OrderItemRow>(env.DB, "SELECT * FROM order_items WHERE order_id = ?", orderId);
  const locale: Locale = isLocale(order.locale) ? order.locale : "en";
  const lines = items.map((item) => {
    const name = pickText(parseLocalized(item.product_name), "en");
    const variant = item.variant_name ? pickText(parseLocalized(item.variant_name), "en") : "";
    return { name: variant ? `${name} — ${variant}` : name, quantity: item.quantity, delivered: item.delivered_quantity };
  });
  const localizedLines = items.map((item) => {
    const name = pickText(parseLocalized(item.product_name), locale);
    const variant = item.variant_name ? pickText(parseLocalized(item.variant_name), locale) : "";
    return variant ? `${name} — ${variant}` : name;
  });
  return { order, items, lines, locale, localizedLines };
}

async function notifyPaidOrder(env: Env, orderId: string): Promise<void> {
  const summary = await orderSummary(env, orderId);
  if (!summary) return;
  const settings = await getSettings(env.DB);
  const { order, lines } = summary;
  if (settings.notifications.telegramPaidOrder) {
    const product = lines.map((line) => `${escapeTelegramHtml(line.name)} × ${line.quantity}`).join("\n");
    const pending = lines.some((line) => line.delivered < line.quantity);
    await notifyAdminTelegram(
      env,
      [
        `<b>New paid order</b>${pending ? " — needs fulfilment" : ""}`,
        `Order: <code>${order.number}</code>`,
        `Product: ${product}`,
        `Quantity: ${lines.reduce((sum, line) => sum + line.quantity, 0)}`,
        `Amount: ${escapeTelegramHtml(formatMoney(order.total, order.currency, "en"))}`,
        `Customer: ${escapeTelegramHtml(order.email)}${order.telegram ? ` (@${escapeTelegramHtml(order.telegram)})` : ""}`,
        `Payment: ${order.payment_method}`,
        `${env.SITE_URL.replace(/\/$/, "")}/admin/orders/${order.id}`,
      ].join("\n"),
    );
  }
  await notifyLowStock(env, summary.items, settings.notifications.telegramLowStock, settings.notifications.lowStockThreshold);
}

async function notifyLowStock(env: Env, items: OrderItemRow[], enabled: boolean, threshold: number): Promise<void> {
  if (!enabled) return;
  const productIds = [...new Set(items.filter((item) => item.delivery_type === "inventory" && item.product_id).map((item) => item.product_id as string))];
  if (productIds.length === 0) return;
  const rows = await queryAll<{ id: string; name: string; available: number }>(
    env.DB,
    `SELECT p.id, p.name, (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'available') AS available
     FROM products p WHERE p.id IN (${bindList(productIds.length)})`,
    ...productIds,
  );
  const low = rows.filter((row) => row.available <= threshold);
  if (low.length === 0) return;
  await notifyAdminTelegram(
    env,
    ["<b>Low stock</b>", ...low.map((row) => `${escapeTelegramHtml(pickText(parseLocalized(row.name), "en"))}: ${row.available} left`)].join("\n"),
  );
}

async function notifyDelivered(env: Env, orderId: string): Promise<void> {
  const summary = await orderSummary(env, orderId);
  if (!summary) return;
  const settings = await getSettings(env.DB);
  if (!settings.notifications.emailCustomers) return;
  const { order, locale, localizedLines } = summary;
  const link = await orderLink(env, order);
  const heading = serverT(locale, "email.delivered.heading", { number: order.number });
  const body = `<p>${escapeHtml(serverT(locale, "email.delivered.body"))}</p><p><strong>${localizedLines.map(escapeHtml).join("<br>")}</strong></p><p>${escapeHtml(serverT(locale, "email.delivered.hint"))}</p>`;
  await sendEmail(env, {
    to: order.email,
    subject: serverT(locale, "email.delivered.subject", { number: order.number, store: settings.general.storeName }),
    html: emailLayout(settings.general.storeName, heading, body, { label: serverT(locale, "email.cta.openOrder"), url: link }),
    text: `${heading}\n\n${localizedLines.join("\n")}\n\n${link}`,
  });
}

export { notifyDelivered };

export async function sendOrderLinkEmail(env: Env, order: OrderRow): Promise<boolean> {
  const settings = await getSettings(env.DB);
  const locale: Locale = isLocale(order.locale) ? order.locale : "en";
  const url = await orderLink(env, order);
  const heading = serverT(locale, "email.created.heading", { number: order.number });
  const body = `<p>${escapeHtml(serverT(locale, "email.created.body"))}</p><p style="font-size:13px;color:#9a9db0">${escapeHtml(serverT(locale, "email.created.keep"))}</p>`;
  return sendEmail(env, {
    to: order.email,
    subject: serverT(locale, "email.created.subject", { number: order.number, store: settings.general.storeName }),
    html: emailLayout(settings.general.storeName, heading, body, { label: serverT(locale, "email.cta.openOrder"), url }),
    text: `${heading}\n\n${url}`,
  });
}

export async function findOrderItem(db: D1Database, orderId: string, itemId: string): Promise<OrderItemRow | null> {
  return queryFirst<OrderItemRow>(db, "SELECT * FROM order_items WHERE id = ? AND order_id = ?", itemId, orderId);
}
