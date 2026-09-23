import { expireStaleOrders } from "./fulfillment.server";
import type { OrderRow } from "./orders.server";
import { reconcileOrderPayment } from "./payments/confirm.server";

/** Periodic housekeeping (cron): expire unpaid orders, release holds, prune stale rows. */
export async function runMaintenance(env: Env, ctx: ExecutionContext): Promise<void> {
  const now = Date.now();
  const expired = await expireStaleOrders(env, (order) => reconcileOrderPayment(env, ctx, order));
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE inventory SET status = 'available', order_id = NULL, order_item_id = NULL, reserved_until = NULL
       WHERE status = 'reserved' AND reserved_until < ?1
         AND (order_id IS NULL OR order_id NOT IN (SELECT id FROM orders WHERE status IN ('paid', 'processing', 'completed', 'refunded')))`,
    ).bind(now),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now),
    env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM webhook_events WHERE received_at < ?").bind(now - 30 * 24 * 60 * 60 * 1000),
  ]);
  if (expired > 0) console.log(`maintenance: expired ${expired} unpaid orders`);

  // Reconcile API payments still waiting, in case a webhook was missed.
  const waiting = await env.DB.prepare(
    "SELECT * FROM orders WHERE status = 'waiting_payment' AND payment_method = 'cryptobot' AND updated_at < ? ORDER BY created_at DESC LIMIT 20",
  )
    .bind(now - 2 * 60 * 1000)
    .all<OrderRow>();
  for (const order of waiting.results) {
    await reconcileOrderPayment(env, ctx, order);
  }
}
