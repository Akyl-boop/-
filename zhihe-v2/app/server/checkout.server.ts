import type { Locale } from "~/i18n/config";
import type { PaymentMethodId } from "~/lib/domain";
import { parseLocalized, pickText } from "~/lib/localized";
import { getProductRowBySlug, parseQuantityDiscounts, SELLABLE_INVENTORY_SQL, type ProductRow, type VariantRow } from "./catalog.server";
import { newId, randomCode, randomToken } from "./crypto.server";
import { isUniqueViolation, queryFirst, queryValue } from "./db.server";
import { applyPayment, cancelUnpaidOrder } from "./fulfillment.server";
import { EVENT, eventStatement, getOrderById, orderAccessKey, type OrderRow } from "./orders.server";
import { getProvider } from "./payments/registry.server";
import { computeBaseQuote, evaluatePromo, redemptionStatement, type PromoError, type PromoRow, type Quote } from "./pricing.server";
import type { StoreSettings } from "~/lib/settings";

export type CheckoutError =
  | PromoError
  | "product_unavailable"
  | "variant_required"
  | "variant_unavailable"
  | "quantity_invalid"
  | "out_of_stock"
  | "payment_unavailable"
  | "payment_failed"
  | "rate_limited";

export interface CheckoutSelection {
  slug: string;
  variantId: string | null;
  quantity: number;
  promoCode: string | null;
  email: string | null;
}

interface ResolvedLine {
  product: ProductRow & { category_slug: string | null };
  variant: VariantRow | null;
  quantity: number;
  quote: Quote;
  promo: PromoRow | null;
  available: number | null;
}

async function availableUnits(db: D1Database, product: ProductRow, variant: VariantRow | null): Promise<number | null> {
  if (product.delivery_type === "inventory") {
    return (
      (await queryValue<number>(
        db,
        `SELECT COUNT(*) FROM inventory WHERE product_id = ? AND variant_id IS ? AND ${SELLABLE_INVENTORY_SQL}`,
        product.id,
        variant?.id ?? null,
        Date.now(),
      )) ?? 0
    );
  }
  if (product.delivery_type === "static") return null;
  if (variant) return variant.unlimited_stock ? null : variant.stock;
  return product.unlimited_stock ? null : product.stock;
}

/** Server-authoritative price calculation. The client never supplies amounts. */
export async function resolveCheckout(
  db: D1Database,
  settings: StoreSettings,
  selection: CheckoutSelection,
): Promise<{ ok: true; line: ResolvedLine } | { ok: false; error: CheckoutError; line?: ResolvedLine }> {
  const product = await getProductRowBySlug(db, selection.slug);
  if (!product) return { ok: false, error: "product_unavailable" };

  const variantCount = (await queryValue<number>(db, "SELECT COUNT(*) FROM product_variants WHERE product_id = ? AND is_active = 1", product.id)) ?? 0;
  let variant: VariantRow | null = null;
  if (variantCount > 0) {
    if (!selection.variantId) return { ok: false, error: "variant_required" };
    variant = await queryFirst<VariantRow>(db, "SELECT * FROM product_variants WHERE id = ? AND product_id = ? AND is_active = 1", selection.variantId, product.id);
    if (!variant) return { ok: false, error: "variant_unavailable" };
  }

  const maxQuantity = Math.max(product.max_quantity, product.min_quantity);
  const quantity = selection.quantity;
  if (!Number.isInteger(quantity) || quantity < product.min_quantity || quantity > maxQuantity) return { ok: false, error: "quantity_invalid" };

  const unitPrice = variant?.price ?? product.price;
  const quote = computeBaseQuote(unitPrice, quantity, product.currency, parseQuantityDiscounts(product.quantity_discounts));
  const available = await availableUnits(db, product, variant);
  const line: ResolvedLine = { product, variant, quantity, quote, promo: null, available };
  if (available !== null && available < quantity) return { ok: false, error: "out_of_stock", line };

  if (selection.promoCode?.trim()) {
    const result = await evaluatePromo(db, {
      code: selection.promoCode,
      email: selection.email,
      productId: product.id,
      categoryId: product.category_id,
      amount: quote.total,
      currency: product.currency,
      storeCurrency: settings.general.currency,
    });
    if (!result.ok) return { ok: false, error: result.error, line };
    line.promo = result.promo;
    quote.promoDiscount = result.discount;
    quote.promoCode = result.promo.code;
    quote.total = Math.max(0, quote.total - result.discount);
  }
  return { ok: true, line };
}

export interface CreateOrderInput extends CheckoutSelection {
  email: string;
  telegram: string | null;
  paymentMethod: PaymentMethodId;
  locale: Locale;
  ip: string;
  userAgent: string;
}

export type CreateOrderResult =
  | { ok: true; order: OrderRow; accessKey: string; payUrl: string | null }
  | { ok: false; error: CheckoutError };

function orderNumber(): string {
  return `ZH-${new Date().getUTCFullYear()}-${randomCode(6)}`;
}

export async function createOrder(env: Env, ctx: ExecutionContext, settings: StoreSettings, input: CreateOrderInput): Promise<CreateOrderResult> {
  const db = env.DB;
  const resolved = await resolveCheckout(db, settings, input);
  if (!resolved.ok) return { ok: false, error: resolved.error };
  const { line } = resolved;
  const { product, variant, quote } = line;

  const isFree = quote.total === 0;
  const provider = getProvider(isFree ? "free" : input.paymentMethod);
  if (!provider || (!isFree && (!provider.isAvailable(env, settings) || provider.id === "free"))) return { ok: false, error: "payment_unavailable" };

  const now = Date.now();
  const ttlMinutes = provider.automatic ? Number(env.ORDER_TTL_MINUTES || 60) : Number(env.MANUAL_ORDER_TTL_HOURS || 24) * 60;
  const expiresAt = now + Math.max(15, ttlMinutes) * 60_000;
  const orderId = newId();
  const itemId = newId();
  const discountTotal = quote.quantityDiscount + quote.promoDiscount;
  const finiteStock = product.delivery_type === "manual" && line.available !== null;

  const customer = await db
    .prepare(
      `INSERT INTO customers (id, email, telegram, locale, orders_count, first_seen_at, last_order_at) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
       ON CONFLICT(email) DO UPDATE SET orders_count = orders_count + 1, last_order_at = ?5, telegram = COALESCE(?3, telegram), locale = ?4
       RETURNING id`,
    )
    .bind(newId(), input.email, input.telegram, input.locale, now)
    .first<{ id: string }>();

  const statements: D1PreparedStatement[] = [];
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = orderNumber();
    try {
      await db
        .prepare(
          `INSERT INTO orders (id, number, access_salt, customer_id, email, telegram, locale, status, payment_method, payment_status, currency,
             subtotal, discount_total, total, promo_code_id, promo_code, ip, user_agent, expires_at, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, 'unpaid', ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)`,
        )
        .bind(
          orderId,
          number,
          randomToken(16),
          customer?.id ?? null,
          input.email,
          input.telegram,
          input.locale,
          provider.id,
          product.currency,
          quote.subtotal,
          discountTotal,
          quote.total,
          line.promo?.id ?? null,
          line.promo?.code ?? null,
          input.ip,
          input.userAgent,
          expiresAt,
          now,
        )
        .run();
      break;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt === 4) throw error;
    }
  }

  statements.push(
    db
      .prepare(
        `INSERT INTO order_items (id, order_id, product_id, variant_id, instruction_id, product_name, variant_name, product_slug, delivery_type,
           unit_price, quantity, discount, total, stock_reserved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        itemId,
        orderId,
        product.id,
        variant?.id ?? null,
        product.instruction_id,
        product.name,
        variant?.name ?? null,
        product.slug,
        product.delivery_type,
        quote.unitPrice,
        quote.quantity,
        discountTotal,
        quote.total,
        finiteStock ? 1 : 0,
      ),
    eventStatement(db, orderId, EVENT.created, { actor: "customer", at: now }),
  );

  const reserveIndex = statements.length;
  if (product.delivery_type === "inventory") {
    statements.push(
      db
        .prepare(
          `UPDATE inventory SET status = 'reserved', order_id = ?1, order_item_id = ?2, reserved_until = ?3
           WHERE id IN (
             SELECT id FROM inventory WHERE product_id = ?4 AND variant_id IS ?5
               AND (status = 'available' OR (status = 'reserved' AND reserved_until < ?6))
             ORDER BY created_at, id LIMIT ?7
           )`,
        )
        .bind(orderId, itemId, expiresAt, product.id, variant?.id ?? null, now, quote.quantity),
    );
  } else if (finiteStock) {
    statements.push(
      variant
        ? db.prepare("UPDATE product_variants SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1").bind(quote.quantity, variant.id)
        : db.prepare("UPDATE products SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1").bind(quote.quantity, product.id),
    );
  }
  const promoIndex = statements.length;
  if (line.promo) {
    statements.push(redemptionStatement(db, { id: newId(), promo: line.promo, orderId, email: input.email, amount: quote.promoDiscount }));
  }

  const results = await db.batch(statements);
  const reserved = product.delivery_type === "inventory" || finiteStock ? (results[reserveIndex]?.meta.changes ?? 0) : null;
  const promoApplied = line.promo ? (results[promoIndex]?.meta.changes ?? 0) === 1 : true;
  const stockOk = reserved === null || (product.delivery_type === "inventory" ? reserved === quote.quantity : reserved === 1);

  if (!stockOk || !promoApplied) {
    // Roll back the stock that did get reserved, then drop the order.
    await db.batch([
      db
        .prepare("UPDATE inventory SET status = 'available', order_id = NULL, order_item_id = NULL, reserved_until = NULL WHERE order_id = ? AND status = 'reserved'")
        .bind(orderId),
      ...(finiteStock && reserved === 1
        ? [
            variant
              ? db.prepare("UPDATE product_variants SET stock = stock + ? WHERE id = ?").bind(quote.quantity, variant.id)
              : db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?").bind(quote.quantity, product.id),
          ]
        : []),
      db.prepare("DELETE FROM orders WHERE id = ?").bind(orderId),
      db.prepare("UPDATE customers SET orders_count = MAX(orders_count - 1, 0) WHERE id = ?").bind(customer?.id ?? null),
    ]);
    return { ok: false, error: stockOk ? "promo_exhausted" : "out_of_stock" };
  }

  const order = (await getOrderById(db, orderId)) as OrderRow;
  const accessKey = await orderAccessKey(env, order);
  const productName = pickText(parseLocalized(product.name), input.locale);
  const variantName = variant ? pickText(parseLocalized(variant.name), input.locale) : "";

  if (isFree) {
    await db.prepare("INSERT INTO payments (id, order_id, provider, status, amount, currency, created_at, updated_at) VALUES (?, ?, 'free', 'created', 0, ?, ?, ?)").bind(newId(), orderId, order.currency, now, now).run();
    const applied = await applyPayment(env, ctx, { orderId, actor: "system", reference: "100% discount" });
    return { ok: true, order: applied.order ?? order, accessKey, payUrl: null };
  }

  try {
    const returnUrl = `${env.SITE_URL.replace(/\/$/, "")}/order/${order.number}?key=${encodeURIComponent(accessKey)}`;
    const payment = await provider.create({
      env,
      settings,
      returnUrl,
      order: {
        id: orderId,
        number: order.number,
        total: order.total,
        currency: order.currency,
        description: `${settings.general.storeName} · ${order.number} · ${productName}${variantName ? ` (${variantName})` : ""} × ${quote.quantity}`,
        expiresAt,
      },
    });
    await db.batch([
      db
        .prepare(
          `INSERT INTO payments (id, order_id, provider, provider_ref, status, amount, currency, pay_url, details, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId(), orderId, provider.id, payment.providerRef, order.total, order.currency, payment.payUrl, JSON.stringify(payment.details), now, now),
      db.prepare("UPDATE orders SET status = 'waiting_payment', payment_status = 'pending', updated_at = ? WHERE id = ? AND status = 'pending'").bind(now, orderId),
      eventStatement(db, orderId, EVENT.paymentPending, { actor: "system", at: now + 1 }),
    ]);
    return { ok: true, order: { ...order, status: "waiting_payment" }, accessKey, payUrl: payment.payUrl };
  } catch (error) {
    console.error("payment creation failed", error instanceof Error ? error.message : error);
    await cancelUnpaidOrder(env, orderId, { actor: "system", reason: "failed", message: "payment_provider_error" });
    return { ok: false, error: "payment_failed" };
  }
}
