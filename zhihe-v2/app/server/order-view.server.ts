import type { Locale } from "~/i18n/config";
import type { OrderStatus, PaymentMethodId, PaymentStatus, Wallet } from "~/lib/domain";
import { pickBlocks, type InstructionBlock } from "~/lib/instructions";
import { parseInstructionContent } from "~/lib/instructions-schema";
import { parseLocalized, pickText } from "~/lib/localized";
import { parseJson, bindList, queryAll } from "./db.server";
import type { OrderBundle } from "./orders.server";

export interface CustomerOrderView {
  number: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod: PaymentMethodId;
  email: string;
  telegram: string | null;
  currency: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  promoCode: string | null;
  createdAt: number;
  paidAt: number | null;
  deliveredAt: number | null;
  expiresAt: number | null;
  items: {
    id: string;
    name: string;
    variant: string | null;
    slug: string | null;
    quantity: number;
    unitPrice: number;
    total: number;
    deliveryType: string;
    deliveredQuantity: number;
    units: string[];
    content: string | null;
    instruction: { title: string; slug: string; blocks: InstructionBlock[] } | null;
  }[];
  payment: {
    payUrl: string | null;
    wallets: Wallet[];
    reference: string | null;
    network: string | null;
  } | null;
  timeline: { type: string; at: number }[];
}

const PUBLIC_EVENTS = new Set(["created", "payment_pending", "payment_submitted", "payment_received", "delivered", "awaiting_fulfillment", "completed", "cancelled", "expired", "refunded", "failed"]);

export async function buildCustomerOrderView(db: D1Database, bundle: OrderBundle, locale: Locale): Promise<CustomerOrderView> {
  const { order, items, payments, events, units } = bundle;
  const delivered = ["paid", "processing", "completed", "refunded"].includes(order.status);
  const instructionIds = [...new Set(items.map((item) => item.instruction_id).filter((id): id is string => Boolean(id)))];
  const instructions = instructionIds.length
    ? await queryAll<{ id: string; slug: string; title: string; content: string }>(
        db,
        `SELECT id, slug, title, content FROM instructions WHERE id IN (${bindList(instructionIds.length)})`,
        ...instructionIds,
      )
    : [];
  const payment = payments.find((row) => row.status === "pending" || row.status === "created") ?? payments[0] ?? null;
  const details = parseJson<{ wallets?: Wallet[]; network?: string }>(payment?.details, {});

  return {
    number: order.number,
    status: order.status,
    paymentStatus: order.payment_status,
    paymentMethod: order.payment_method,
    email: order.email,
    telegram: order.telegram,
    currency: order.currency,
    subtotal: order.subtotal,
    discountTotal: order.discount_total,
    total: order.total,
    promoCode: order.promo_code,
    createdAt: order.created_at,
    paidAt: order.paid_at,
    deliveredAt: order.delivered_at,
    expiresAt: order.status === "waiting_payment" || order.status === "pending" ? order.expires_at : null,
    items: items.map((item) => {
      const instruction = instructions.find((row) => row.id === item.instruction_id);
      return {
        id: item.id,
        name: pickText(parseLocalized(item.product_name), locale),
        variant: item.variant_name ? pickText(parseLocalized(item.variant_name), locale) : null,
        slug: item.product_slug,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        total: item.total,
        deliveryType: item.delivery_type,
        deliveredQuantity: item.delivered_quantity,
        units: delivered ? units.filter((unit) => unit.order_item_id === item.id).map((unit) => unit.content) : [],
        content: delivered ? item.delivery_content : null,
        instruction:
          delivered && instruction
            ? { title: pickText(parseLocalized(instruction.title), locale), slug: instruction.slug, blocks: pickBlocks(parseInstructionContent(instruction.content), locale) }
            : null,
      };
    }),
    payment: payment
      ? {
          payUrl: order.status === "waiting_payment" ? payment.pay_url : null,
          wallets: order.status === "waiting_payment" ? (details.wallets ?? []) : [],
          reference: payment.tx_reference,
          network: details.network ?? null,
        }
      : null,
    timeline: events.filter((event) => !event.is_internal && PUBLIC_EVENTS.has(event.type)).map((event) => ({ type: event.type, at: event.created_at })),
  };
}
