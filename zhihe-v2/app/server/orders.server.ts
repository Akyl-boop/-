import type { DeliveryType, OrderStatus, PaymentMethodId, PaymentStatus } from "~/lib/domain";
import { hmacSha256Hex, newId, timingSafeEqual, toBase64Url } from "./crypto.server";
import { queryAll, queryFirst } from "./db.server";

export interface OrderRow {
  id: string;
  number: string;
  access_salt: string;
  customer_id: string | null;
  email: string;
  telegram: string | null;
  locale: string;
  status: OrderStatus;
  payment_method: PaymentMethodId;
  payment_status: PaymentStatus;
  currency: string;
  subtotal: number;
  discount_total: number;
  total: number;
  promo_code_id: string | null;
  promo_code: string | null;
  customer_note: string | null;
  admin_note: string;
  ip: string | null;
  user_agent: string | null;
  expires_at: number | null;
  paid_at: number | null;
  delivered_at: number | null;
  completed_at: number | null;
  cancelled_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  instruction_id: string | null;
  product_name: string;
  variant_name: string | null;
  product_slug: string | null;
  delivery_type: DeliveryType;
  unit_price: number;
  quantity: number;
  discount: number;
  total: number;
  stock_reserved: number;
  delivered_quantity: number;
  delivery_content: string | null;
  delivered_at: number | null;
}

export interface PaymentRow {
  id: string;
  order_id: string;
  provider: PaymentMethodId;
  provider_ref: string | null;
  status: "created" | "pending" | "paid" | "expired" | "failed" | "refunded";
  amount: number;
  currency: string;
  pay_url: string | null;
  tx_reference: string | null;
  details: string;
  created_at: number;
  updated_at: number;
  paid_at: number | null;
}

export interface OrderEventRow {
  id: string;
  order_id: string;
  type: string;
  actor: string;
  message: string;
  is_internal: number;
  created_at: number;
}

export interface DeliveredUnit {
  id: string;
  order_item_id: string;
  content: string;
  sold_at: number | null;
}

export interface OrderBundle {
  order: OrderRow;
  items: OrderItemRow[];
  payments: PaymentRow[];
  events: OrderEventRow[];
  units: DeliveredUnit[];
}

export const EVENT = {
  created: "created",
  paymentPending: "payment_pending",
  paymentSubmitted: "payment_submitted",
  paymentReceived: "payment_received",
  delivered: "delivered",
  awaitingFulfillment: "awaiting_fulfillment",
  completed: "completed",
  cancelled: "cancelled",
  expired: "expired",
  refunded: "refunded",
  failed: "failed",
  note: "note",
  statusChanged: "status_changed",
  deliveryResent: "delivery_resent",
  shortage: "stock_shortage",
} as const;

export function eventStatement(
  db: D1Database,
  orderId: string,
  type: string,
  options: { actor?: string; message?: string; internal?: boolean; at?: number } = {},
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO order_events (id, order_id, type, actor, message, is_internal, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), orderId, type, options.actor ?? "system", options.message ?? "", options.internal ? 1 : 0, options.at ?? Date.now());
}

export async function getOrderById(db: D1Database, id: string): Promise<OrderRow | null> {
  return queryFirst<OrderRow>(db, "SELECT * FROM orders WHERE id = ?", id);
}

function linkSecret(env: Env): Uint8Array {
  const secret = env.ORDER_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error("ORDER_LINK_SECRET must be set (at least 32 characters)");
  return new TextEncoder().encode(secret);
}

/** Order access keys are HMAC(secret, id:salt). Rotating the salt revokes old links. */
export async function orderAccessKey(env: Env, order: Pick<OrderRow, "id" | "access_salt">): Promise<string> {
  const hex = await hmacSha256Hex(linkSecret(env), `${order.id}:${order.access_salt}`);
  const bytes = new Uint8Array(hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
  return toBase64Url(bytes.slice(0, 24));
}

/** Resolves an order only when the caller presents its secret access key. */
export async function getOrderByAccessKey(env: Env, number: string, key: string | null): Promise<OrderRow | null> {
  if (!key || key.length < 20 || key.length > 100) return null;
  const order = await queryFirst<OrderRow>(env.DB, "SELECT * FROM orders WHERE number = ?", number.toUpperCase());
  if (!order) return null;
  const expected = await orderAccessKey(env, order);
  return timingSafeEqual(expected, key) ? order : null;
}

export async function orderLink(env: Env, order: Pick<OrderRow, "id" | "number" | "access_salt">): Promise<string> {
  const key = await orderAccessKey(env, order);
  return `${env.SITE_URL.replace(/\/$/, "")}/order/${order.number}?key=${encodeURIComponent(key)}`;
}

export async function loadOrderBundle(db: D1Database, order: OrderRow): Promise<OrderBundle> {
  const [items, payments, events, units] = await Promise.all([
    queryAll<OrderItemRow>(db, "SELECT * FROM order_items WHERE order_id = ?", order.id),
    queryAll<PaymentRow>(db, "SELECT * FROM payments WHERE order_id = ? ORDER BY created_at DESC", order.id),
    queryAll<OrderEventRow>(db, "SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, rowid", order.id),
    queryAll<DeliveredUnit>(
      db,
      "SELECT id, order_item_id, content, sold_at FROM inventory WHERE order_id = ? AND status = 'sold' ORDER BY sold_at, id",
      order.id,
    ),
  ]);
  return { order, items, payments, events, units };
}
