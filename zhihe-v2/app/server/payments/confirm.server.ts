import { formatMoney } from "~/lib/money";
import { queryFirst } from "../db.server";
import { applyPayment } from "../fulfillment.server";
import { escapeTelegramHtml, notifyAdminTelegram } from "../notify/telegram.server";
import { EVENT, eventStatement, type OrderRow, type PaymentRow } from "../orders.server";
import { getSettings } from "../settings.server";
import { invoiceToRemote, verifyCryptoBotSignature, type CryptoBotUpdate } from "./cryptobot.server";
import { getProvider } from "./registry.server";
import type { RemotePayment } from "./types";

function matchesPayment(remote: RemotePayment, payment: PaymentRow): boolean {
  if (remote.status !== "paid") return false;
  if (remote.orderId && remote.orderId !== payment.order_id) return false;
  if (remote.currency !== null && remote.currency !== payment.currency) return false;
  if (remote.amount !== null && remote.amount < payment.amount) return false;
  return true;
}

export type WebhookOutcome = { status: number; body: string };

export async function handleCryptoBotWebhook(env: Env, ctx: ExecutionContext, request: Request): Promise<WebhookOutcome> {
  const raw = await request.text();
  if (raw.length > 64_000) return { status: 413, body: "payload too large" };
  const valid = await verifyCryptoBotSignature(env, raw, request.headers.get("crypto-pay-api-signature"));
  if (!valid) return { status: 401, body: "invalid signature" };

  let update: CryptoBotUpdate;
  try {
    update = JSON.parse(raw) as CryptoBotUpdate;
  } catch {
    return { status: 400, body: "invalid json" };
  }
  const eventId = `cryptobot:${update.update_id}`;
  const seen = await queryFirst<{ id: string }>(env.DB, "SELECT id FROM webhook_events WHERE id = ?", eventId);
  if (seen) return { status: 200, body: "duplicate" };
  if (update.update_type !== "invoice_paid" || !update.payload) {
    await recordWebhook(env, eventId, "ignored");
    return { status: 200, body: "ignored" };
  }

  const payment = await queryFirst<PaymentRow>(
    env.DB,
    "SELECT * FROM payments WHERE provider = 'cryptobot' AND provider_ref = ?",
    String(update.payload.invoice_id),
  );
  if (!payment) {
    await recordWebhook(env, eventId, "unknown_invoice");
    return { status: 200, body: "unknown invoice" };
  }
  const remote = invoiceToRemote(update.payload);
  if (!matchesPayment(remote, payment)) {
    await recordWebhook(env, eventId, "mismatch");
    await env.DB.batch([eventStatement(env.DB, payment.order_id, EVENT.note, { actor: "webhook", internal: true, message: "CryptoBot webhook did not match payment amount/currency" })]);
    return { status: 200, body: "mismatch" };
  }
  const reference = update.payload.paid_asset ? `${update.payload.paid_amount ?? ""} ${update.payload.paid_asset}`.trim() : `invoice ${payment.provider_ref}`;
  const result = await applyPayment(env, ctx, { orderId: payment.order_id, paymentId: payment.id, actor: "webhook:cryptobot", reference });
  await recordWebhook(env, eventId, result.applied ? "applied" : "already_processed");
  return { status: 200, body: "ok" };
}

async function recordWebhook(env: Env, id: string, result: string): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO webhook_events (id, provider, received_at, result) VALUES (?, 'cryptobot', ?, ?)").bind(id, Date.now(), result).run();
}

/** Pulls the provider's view of an order's payment. Returns true if the order became paid. */
export async function reconcileOrderPayment(env: Env, ctx: ExecutionContext | null, order: OrderRow): Promise<boolean> {
  if (order.status !== "waiting_payment" && order.status !== "pending") return false;
  const payment = await queryFirst<PaymentRow>(
    env.DB,
    "SELECT * FROM payments WHERE order_id = ? AND provider_ref IS NOT NULL ORDER BY created_at DESC LIMIT 1",
    order.id,
  );
  if (!payment?.provider_ref) return false;
  const provider = getProvider(payment.provider);
  if (!provider?.fetchRemote) return false;
  try {
    const remote = await provider.fetchRemote(env, payment.provider_ref);
    if (!remote || !matchesPayment(remote, payment)) return false;
    const result = await applyPayment(env, ctx, { orderId: order.id, paymentId: payment.id, actor: `reconcile:${provider.id}` });
    return result.applied;
  } catch (error) {
    console.warn("reconcile failed", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function submitManualPayment(env: Env, ctx: ExecutionContext, order: OrderRow, reference: string): Promise<boolean> {
  if (order.status !== "waiting_payment" || order.payment_method !== "manual_crypto") return false;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE payments SET tx_reference = ?, updated_at = ? WHERE order_id = ? AND provider = 'manual_crypto' AND status = 'pending'").bind(reference, now, order.id),
    eventStatement(env.DB, order.id, EVENT.paymentSubmitted, { actor: "customer", message: reference }),
  ]);
  ctx.waitUntil(
    (async () => {
      const settings = await getSettings(env.DB);
      if (!settings.notifications.telegramNewOrder && !settings.notifications.telegramPaidOrder) return;
      await notifyAdminTelegram(
        env,
        [
          "<b>Manual payment submitted</b> — verify and approve",
          `Order: <code>${order.number}</code>`,
          `Amount: ${escapeTelegramHtml(formatMoney(order.total, order.currency, "en"))}`,
          `Reference: <code>${escapeTelegramHtml(reference)}</code>`,
          `${env.SITE_URL.replace(/\/$/, "")}/admin/orders/${order.id}`,
        ].join("\n"),
      );
    })(),
  );
  return true;
}
