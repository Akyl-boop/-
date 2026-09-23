import { z } from "zod";
import { DELIVERY_TYPES, type FaqItem, type QuantityDiscount } from "~/lib/domain";
import { parseLocalized, isLocalizedEmpty, type LocalizedText } from "~/lib/localized";
import { SUPPORTED_CURRENCIES } from "~/lib/money";
import { slugify } from "~/lib/format";
import type { ProductRow, VariantRow } from "../catalog.server";
import { newId } from "../crypto.server";
import { isUniqueViolation, parseJson, bindList, queryAll, queryFirst, queryValue } from "../db.server";

const localized = z.object({ en: z.string().max(20_000).optional(), ru: z.string().max(20_000).optional(), zh: z.string().max(20_000).optional() }).default({});
const money = z.number().int().min(0).max(100_000_000);

export const productInputSchema = z.object({
  slug: z.string().trim().max(80).default(""),
  categoryId: z.string().nullable().default(null),
  instructionId: z.string().nullable().default(null),
  name: localized,
  shortDescription: localized,
  description: localized,
  thumbnailUrl: z.string().trim().max(2000).nullable().default(null),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#7c6cff"),
  price: money,
  oldPrice: money.nullable().default(null),
  currency: z.enum(SUPPORTED_CURRENCIES).default("USD"),
  stock: z.number().int().min(0).max(10_000_000).default(0),
  unlimitedStock: z.boolean().default(false),
  minQuantity: z.number().int().min(1).max(1000).default(1),
  maxQuantity: z.number().int().min(1).max(1000).default(10),
  isActive: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isPopular: z.boolean().default(false),
  sortPriority: z.number().int().min(-100_000).max(100_000).default(0),
  deliveryType: z.enum(DELIVERY_TYPES).default("inventory"),
  deliveryTime: localized,
  staticDelivery: z.string().max(20_000).nullable().default(null),
  warranty: localized,
  requirements: localized,
  regionRestrictions: localized,
  tags: z.string().max(500).default(""),
  seoTitle: localized,
  seoDescription: localized,
  faq: z.array(z.object({ question: localized, answer: localized })).max(50).default([]),
  quantityDiscounts: z
    .array(z.object({ minQuantity: z.number().int().min(2).max(1000), percent: z.number().int().min(1).max(90) }))
    .max(10)
    .default([]),
  gallery: z.array(z.object({ url: z.string().trim().min(1).max(2000), alt: z.string().max(200).default("") })).max(20).default([]),
  variants: z
    .array(
      z.object({
        id: z.string().max(64).optional(),
        name: localized,
        sku: z.string().max(80).nullable().default(null),
        price: money,
        oldPrice: money.nullable().default(null),
        stock: z.number().int().min(0).max(10_000_000).default(0),
        unlimitedStock: z.boolean().default(false),
        isActive: z.boolean().default(true),
      }),
    )
    .max(30)
    .default([]),
  related: z.array(z.string().max(64)).max(12).default([]),
});

export type ProductInput = z.infer<typeof productInputSchema>;

export interface ProductEditData extends ProductInput {
  id: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  inventory: { available: number; reserved: number; sold: number };
}

export function emptyProduct(currency: string): ProductEditData {
  return {
    ...productInputSchema.parse({ price: 0, currency: SUPPORTED_CURRENCIES.includes(currency as never) ? currency : "USD" }),
    id: null,
    createdAt: null,
    updatedAt: null,
    inventory: { available: 0, reserved: 0, sold: 0 },
  };
}

export async function getProductForEdit(db: D1Database, id: string): Promise<ProductEditData | null> {
  const row = await queryFirst<ProductRow>(db, "SELECT * FROM products WHERE id = ?", id);
  if (!row) return null;
  const [variants, images, related, inventory] = await Promise.all([
    queryAll<VariantRow>(db, "SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order", id),
    queryAll<{ url: string; alt: string }>(db, "SELECT url, alt FROM product_images WHERE product_id = ? ORDER BY sort_order", id),
    queryAll<{ related_id: string }>(db, "SELECT related_id FROM product_related WHERE product_id = ? ORDER BY sort_order", id),
    queryAll<{ status: string; n: number }>(db, "SELECT status, COUNT(*) AS n FROM inventory WHERE product_id = ? GROUP BY status", id),
  ]);
  const count = (status: string) => inventory.find((entry) => entry.status === status)?.n ?? 0;
  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.category_id,
    instructionId: row.instruction_id,
    name: parseLocalized(row.name),
    shortDescription: parseLocalized(row.short_description),
    description: parseLocalized(row.description),
    thumbnailUrl: row.thumbnail_url,
    accent: row.accent,
    price: row.price,
    oldPrice: row.old_price,
    currency: row.currency as ProductInput["currency"],
    stock: row.stock,
    unlimitedStock: Boolean(row.unlimited_stock),
    minQuantity: row.min_quantity,
    maxQuantity: row.max_quantity,
    isActive: Boolean(row.is_active),
    isFeatured: Boolean(row.is_featured),
    isPopular: Boolean(row.is_popular),
    sortPriority: row.sort_priority,
    deliveryType: row.delivery_type,
    deliveryTime: parseLocalized(row.delivery_time),
    staticDelivery: row.static_delivery,
    warranty: parseLocalized(row.warranty),
    requirements: parseLocalized(row.requirements),
    regionRestrictions: parseLocalized(row.region_restrictions),
    tags: row.tags,
    seoTitle: parseLocalized(row.seo_title),
    seoDescription: parseLocalized(row.seo_description),
    faq: parseJson<FaqItem[]>(row.faq, []),
    quantityDiscounts: parseJson<QuantityDiscount[]>(row.quantity_discounts, []),
    gallery: images,
    variants: variants.map((variant) => ({
      id: variant.id,
      name: parseLocalized(variant.name),
      sku: variant.sku,
      price: variant.price,
      oldPrice: variant.old_price,
      stock: variant.stock,
      unlimitedStock: Boolean(variant.unlimited_stock),
      isActive: Boolean(variant.is_active),
    })),
    related: related.map((entry) => entry.related_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    inventory: { available: count("available"), reserved: count("reserved"), sold: count("sold") },
  };
}

const json = (value: LocalizedText | unknown) => JSON.stringify(value ?? {});

export type SaveProductResult = { ok: true; id: string } | { ok: false; error: "name_required" | "slug_taken" | "variant_name_required" };

export async function saveProduct(db: D1Database, id: string | null, input: ProductInput): Promise<SaveProductResult> {
  if (isLocalizedEmpty(input.name)) return { ok: false, error: "name_required" };
  if (input.variants.some((variant) => isLocalizedEmpty(variant.name))) return { ok: false, error: "variant_name_required" };
  const productId = id ?? newId();
  const now = Date.now();
  const slug = slugify(input.slug || input.name.en || input.name.ru || input.name.zh || "") || productId.slice(0, 8);
  const maxQuantity = Math.max(input.maxQuantity, input.minQuantity);
  const oldPrice = input.oldPrice && input.oldPrice > input.price ? input.oldPrice : null;
  const discounts = [...input.quantityDiscounts].sort((a, b) => a.minQuantity - b.minQuantity);

  const values = [
    slug,
    input.categoryId || null,
    input.instructionId || null,
    json(input.name),
    json(input.shortDescription),
    json(input.description),
    input.thumbnailUrl || null,
    input.accent,
    input.price,
    oldPrice,
    input.currency,
    input.stock,
    input.unlimitedStock ? 1 : 0,
    input.minQuantity,
    maxQuantity,
    input.isActive ? 1 : 0,
    input.isFeatured ? 1 : 0,
    input.isPopular ? 1 : 0,
    input.sortPriority,
    input.deliveryType,
    json(input.deliveryTime),
    input.staticDelivery || null,
    json(input.warranty),
    json(input.requirements),
    json(input.regionRestrictions),
    input.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .join(", "),
    json(input.seoTitle),
    json(input.seoDescription),
    JSON.stringify(input.faq.filter((item) => !isLocalizedEmpty(item.question))),
    JSON.stringify(discounts),
  ];

  const statements: D1PreparedStatement[] = [];
  if (id) {
    statements.push(
      db
        .prepare(
          `UPDATE products SET slug = ?, category_id = ?, instruction_id = ?, name = ?, short_description = ?, description = ?, thumbnail_url = ?, accent = ?,
             price = ?, old_price = ?, currency = ?, stock = ?, unlimited_stock = ?, min_quantity = ?, max_quantity = ?, is_active = ?, is_featured = ?,
             is_popular = ?, sort_priority = ?, delivery_type = ?, delivery_time = ?, static_delivery = ?, warranty = ?, requirements = ?,
             region_restrictions = ?, tags = ?, seo_title = ?, seo_description = ?, faq = ?, quantity_discounts = ?, updated_at = ?
           WHERE id = ?`,
        )
        .bind(...values, now, productId),
    );
  } else {
    statements.push(
      db
        .prepare(
          `INSERT INTO products (slug, category_id, instruction_id, name, short_description, description, thumbnail_url, accent, price, old_price, currency,
             stock, unlimited_stock, min_quantity, max_quantity, is_active, is_featured, is_popular, sort_priority, delivery_type, delivery_time,
             static_delivery, warranty, requirements, region_restrictions, tags, seo_title, seo_description, faq, quantity_discounts, id, created_at, updated_at)
           VALUES (${bindList(33)})`,
        )
        .bind(...values, productId, now, now),
    );
  }

  // Variants: update in place, add new, archive removed ones that have history, delete the rest.
  const existing = id ? await queryAll<{ id: string; used: number }>(
    db,
    `SELECT v.id, (SELECT COUNT(*) FROM inventory i WHERE i.variant_id = v.id) + (SELECT COUNT(*) FROM order_items oi WHERE oi.variant_id = v.id) AS used
     FROM product_variants v WHERE v.product_id = ?`,
    productId,
  ) : [];
  const keep = new Set<string>();
  input.variants.forEach((variant, index) => {
    const variantOld = variant.oldPrice && variant.oldPrice > variant.price ? variant.oldPrice : null;
    const known = variant.id && existing.some((row) => row.id === variant.id);
    if (known && variant.id) {
      keep.add(variant.id);
      statements.push(
        db
          .prepare("UPDATE product_variants SET name = ?, sku = ?, price = ?, old_price = ?, stock = ?, unlimited_stock = ?, is_active = ?, sort_order = ? WHERE id = ? AND product_id = ?")
          .bind(json(variant.name), variant.sku || null, variant.price, variantOld, variant.stock, variant.unlimitedStock ? 1 : 0, variant.isActive ? 1 : 0, index, variant.id, productId),
      );
    } else {
      statements.push(
        db
          .prepare("INSERT INTO product_variants (id, product_id, name, sku, price, old_price, stock, unlimited_stock, is_active, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(newId(), productId, json(variant.name), variant.sku || null, variant.price, variantOld, variant.stock, variant.unlimitedStock ? 1 : 0, variant.isActive ? 1 : 0, index),
      );
    }
  });
  for (const row of existing) {
    if (keep.has(row.id)) continue;
    statements.push(
      row.used > 0
        ? db.prepare("UPDATE product_variants SET is_active = 0, sort_order = 999 WHERE id = ?").bind(row.id)
        : db.prepare("DELETE FROM product_variants WHERE id = ?").bind(row.id),
    );
  }

  statements.push(db.prepare("DELETE FROM product_images WHERE product_id = ?").bind(productId));
  input.gallery.forEach((image, index) => {
    statements.push(db.prepare("INSERT INTO product_images (id, product_id, url, alt, sort_order) VALUES (?, ?, ?, ?, ?)").bind(newId(), productId, image.url, image.alt, index));
  });
  statements.push(db.prepare("DELETE FROM product_related WHERE product_id = ?").bind(productId));
  [...new Set(input.related)]
    .filter((relatedId) => relatedId !== productId)
    .forEach((relatedId, index) => {
      statements.push(
        db.prepare("INSERT OR IGNORE INTO product_related (product_id, related_id, sort_order) SELECT ?, id, ? FROM products WHERE id = ?").bind(productId, index, relatedId),
      );
    });

  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "slug_taken" };
    throw error;
  }
  return { ok: true, id: productId };
}

export async function duplicateProduct(db: D1Database, id: string): Promise<string | null> {
  const source = await getProductForEdit(db, id);
  if (!source) return null;
  let slug = `${source.slug}-copy`;
  for (let n = 2; await queryValue<string>(db, "SELECT id FROM products WHERE slug = ?", slug); n++) slug = `${source.slug}-copy-${n}`;
  const name: LocalizedText = {};
  for (const [locale, text] of Object.entries(source.name)) if (text) name[locale as keyof LocalizedText] = `${text} (copy)`;
  const result = await saveProduct(db, null, {
    ...source,
    slug,
    name,
    isActive: false,
    variants: source.variants.map(({ id: _omit, ...variant }) => variant),
  });
  return result.ok ? result.id : null;
}

export type DeleteProductResult = { ok: true } | { ok: false; error: "has_open_orders" | "not_found" };

export async function deleteProduct(db: D1Database, id: string): Promise<DeleteProductResult> {
  const exists = await queryValue<string>(db, "SELECT id FROM products WHERE id = ?", id);
  if (!exists) return { ok: false, error: "not_found" };
  const open = await queryValue<number>(
    db,
    `SELECT COUNT(*) FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = ? AND o.status IN ('pending', 'waiting_payment', 'paid', 'processing')`,
    id,
  );
  if (open && open > 0) return { ok: false, error: "has_open_orders" };
  // Unsold units are removed with the product; sold units stay attached to their orders.
  await db.batch([
    db.prepare("DELETE FROM inventory WHERE product_id = ? AND status != 'sold'").bind(id),
    db.prepare("DELETE FROM products WHERE id = ?").bind(id),
  ]);
  return { ok: true };
}
