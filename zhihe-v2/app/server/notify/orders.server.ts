import { parseLocalized, pickText } from "~/lib/localized";
import { formatMoney } from "~/lib/money";
import { queryAll } from "../db.server";
import type { OrderItemRow, OrderRow } from "../orders.server";
import { getSettings } from "../settings.server";
import { escapeTelegramHtml, notifyAdminTelegram } from "./telegram.server";

/** Optional admin ping for freshly created (unpaid) orders. */
export async function notifyNewOrder(env: Env, order: OrderRow): Promise<void> {
  try {
    const settings = await getSettings(env.DB);
    if (!settings.notifications.telegramNewOrder) return;
    const items = await queryAll<OrderItemRow>(env.DB, "SELECT * FROM order_items WHERE order_id = ?", order.id);
    const product = items.map((item) => `${escapeTelegramHtml(pickText(parseLocalized(item.product_name), "en"))} × ${item.quantity}`).join("\n");
    await notifyAdminTelegram(
      env,
      [
        "<b>New order</b> — awaiting payment",
        `Order: <code>${order.number}</code>`,
        `Product: ${product}`,
        `Amount: ${escapeTelegramHtml(formatMoney(order.total, order.currency, "en"))}`,
        `Customer: ${escapeTelegramHtml(order.email)}${order.telegram ? ` (@${escapeTelegramHtml(order.telegram)})` : ""}`,
        `Payment: ${order.payment_method}`,
      ].join("\n"),
    );
  } catch (error) {
    console.warn("new order notification failed", error);
  }
}
