import type { QuantityDiscount } from "~/lib/domain";
import { quantityDiscountPercent } from "~/lib/pricing";
import { bindList, queryFirst, queryValue } from "./db.server";

export interface PromoRow {
  id: string;
  code: string;
  description: string;
  type: "percent" | "fixed";
  value: number;
  currency: string | null;
  min_order_amount: number;
  max_uses: number | null;
  per_user_limit: number | null;
  starts_at: number | null;
  expires_at: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

export type PromoError =
  | "promo_not_found"
  | "promo_inactive"
  | "promo_not_started"
  | "promo_expired"
  | "promo_min_order"
  | "promo_not_applicable"
  | "promo_exhausted"
  | "promo_user_limit"
  | "promo_currency";

export interface Quote {
  currency: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  quantityDiscount: number;
  quantityDiscountPercent: number;
  promoDiscount: number;
  promoCode: string | null;
  total: number;
}

export function computeBaseQuote(unitPrice: number, quantity: number, currency: string, tiers: QuantityDiscount[]): Quote {
  const subtotal = unitPrice * quantity;
  const percent = quantityDiscountPercent(tiers, quantity);
  const quantityDiscount = Math.floor((subtotal * percent) / 100);
  return {
    currency,
    unitPrice,
    quantity,
    subtotal,
    quantityDiscount,
    quantityDiscountPercent: percent,
    promoDiscount: 0,
    promoCode: null,
    total: subtotal - quantityDiscount,
  };
}

export function promoDiscountAmount(promo: Pick<PromoRow, "type" | "value">, amount: number): number {
  const raw = promo.type === "percent" ? Math.floor((amount * Math.min(promo.value, 100)) / 100) : promo.value;
  return Math.max(0, Math.min(raw, amount));
}

export interface PromoContext {
  code: string;
  email: string | null;
  productId: string;
  categoryId: string | null;
  amount: number;
  currency: string;
  storeCurrency: string;
}

export type PromoResult = { ok: true; promo: PromoRow; discount: number } | { ok: false; error: PromoError };

export async function evaluatePromo(db: D1Database, context: PromoContext): Promise<PromoResult> {
  const code = context.code.trim();
  if (!code) return { ok: false, error: "promo_not_found" };
  const promo = await queryFirst<PromoRow>(db, "SELECT * FROM promo_codes WHERE code = ? COLLATE NOCASE", code);
  if (!promo) return { ok: false, error: "promo_not_found" };
  const now = Date.now();
  if (!promo.is_active) return { ok: false, error: "promo_inactive" };
  if (promo.starts_at && promo.starts_at > now) return { ok: false, error: "promo_not_started" };
  if (promo.expires_at && promo.expires_at <= now) return { ok: false, error: "promo_expired" };
  if (promo.type === "fixed" && (promo.currency ?? context.storeCurrency) !== context.currency) return { ok: false, error: "promo_currency" };
  if (context.amount < promo.min_order_amount) return { ok: false, error: "promo_min_order" };

  const scope = await db
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM promo_code_products WHERE promo_id = ?1) AS product_rules,
        (SELECT COUNT(*) FROM promo_code_categories WHERE promo_id = ?1) AS category_rules,
        (SELECT COUNT(*) FROM promo_code_products WHERE promo_id = ?1 AND product_id = ?2) AS product_match,
        (SELECT COUNT(*) FROM promo_code_categories WHERE promo_id = ?1 AND category_id = ?3) AS category_match`,
    )
    .bind(promo.id, context.productId, context.categoryId)
    .first<{ product_rules: number; category_rules: number; product_match: number; category_match: number }>();
  if (scope && scope.product_rules + scope.category_rules > 0 && scope.product_match + scope.category_match === 0) {
    return { ok: false, error: "promo_not_applicable" };
  }

  if (promo.max_uses !== null) {
    const used = (await queryValue<number>(db, "SELECT COUNT(*) FROM promo_redemptions WHERE promo_id = ? AND status != 'released'", promo.id)) ?? 0;
    if (used >= promo.max_uses) return { ok: false, error: "promo_exhausted" };
  }
  if (promo.per_user_limit !== null && context.email) {
    const used =
      (await queryValue<number>(
        db,
        "SELECT COUNT(*) FROM promo_redemptions WHERE promo_id = ? AND email = ? COLLATE NOCASE AND status != 'released'",
        promo.id,
        context.email,
      )) ?? 0;
    if (used >= promo.per_user_limit) return { ok: false, error: "promo_user_limit" };
  }
  const discount = promoDiscountAmount(promo, context.amount);
  if (discount <= 0) return { ok: false, error: "promo_not_applicable" };
  return { ok: true, promo, discount };
}

/**
 * Atomically records a redemption only while the promo is still under its
 * global and per-customer limits. Returns false if a limit was hit concurrently.
 */
export function redemptionStatement(db: D1Database, args: { id: string; promo: PromoRow; orderId: string; email: string; amount: number }): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO promo_redemptions (id, promo_id, order_id, email, amount, status, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, 'reserved', ?6
       WHERE (?7 IS NULL OR (SELECT COUNT(*) FROM promo_redemptions WHERE promo_id = ?2 AND status != 'released') < ?7)
         AND (?8 IS NULL OR (SELECT COUNT(*) FROM promo_redemptions WHERE promo_id = ?2 AND email = ?4 COLLATE NOCASE AND status != 'released') < ?8)`,
    )
    .bind(args.id, args.promo.id, args.orderId, args.email, args.amount, Date.now(), args.promo.max_uses, args.promo.per_user_limit);
}

export async function promoTargets(db: D1Database, promoIds: string[]) {
  if (promoIds.length === 0) return { products: [], categories: [] };
  const [products, categories] = await Promise.all([
    db.prepare(`SELECT promo_id, product_id FROM promo_code_products WHERE promo_id IN (${bindList(promoIds.length)})`).bind(...promoIds).all<{ promo_id: string; product_id: string }>(),
    db.prepare(`SELECT promo_id, category_id FROM promo_code_categories WHERE promo_id IN (${bindList(promoIds.length)})`).bind(...promoIds).all<{ promo_id: string; category_id: string }>(),
  ]);
  return { products: products.results, categories: categories.results };
}
