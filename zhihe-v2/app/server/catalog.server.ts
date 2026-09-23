import type { Locale } from "~/i18n/config";
import {
  CATEGORY_ICONS,
  type CategoryIcon,
  type CategorySummary,
  type DeliveryType,
  type FaqItem,
  type ProductCardData,
  type ProductDetailData,
  type QuantityDiscount,
  type VariantData,
} from "~/lib/domain";
import { parseLocalized, pickText } from "~/lib/localized";
import { bool, parseJson, bindList, queryAll, queryFirst } from "./db.server";

export interface ProductRow {
  id: string;
  slug: string;
  category_id: string | null;
  instruction_id: string | null;
  name: string;
  short_description: string;
  description: string;
  thumbnail_url: string | null;
  accent: string;
  price: number;
  old_price: number | null;
  currency: string;
  stock: number;
  unlimited_stock: number;
  min_quantity: number;
  max_quantity: number;
  is_active: number;
  is_featured: number;
  is_popular: number;
  sort_priority: number;
  delivery_type: DeliveryType;
  delivery_time: string;
  static_delivery: string | null;
  warranty: string;
  requirements: string;
  region_restrictions: string;
  tags: string;
  seo_title: string;
  seo_description: string;
  faq: string;
  quantity_discounts: string;
  created_at: number;
  updated_at: number;
}

export interface VariantRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  price: number;
  old_price: number | null;
  stock: number;
  unlimited_stock: number;
  is_active: number;
  sort_order: number;
}

export interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  is_active: number;
  created_at: number;
  updated_at: number;
}

type ProductListRow = ProductRow & { category_slug: string | null; category_name: string | null };

/** Inventory counted as sellable: available, or reserved by an order whose hold has expired. */
export const SELLABLE_INVENTORY_SQL = "(status = 'available' OR (status = 'reserved' AND reserved_until < ?))";

export function toCategoryIcon(value: string): CategoryIcon {
  return (CATEGORY_ICONS as readonly string[]).includes(value) ? (value as CategoryIcon) : "box";
}

export function parseQuantityDiscounts(raw: string): QuantityDiscount[] {
  return parseJson<QuantityDiscount[]>(raw, [])
    .filter((tier) => Number.isInteger(tier.minQuantity) && tier.minQuantity > 1 && tier.percent > 0 && tier.percent < 100)
    .sort((a, b) => a.minQuantity - b.minQuantity);
}

type StockKey = `${string}:${string}`;

/** Inventory-backed stock per product/variant ("productId:variantId" or "productId:"). */
async function inventoryCounts(db: D1Database, productIds: string[]): Promise<Map<StockKey, number>> {
  const counts = new Map<StockKey, number>();
  if (productIds.length === 0) return counts;
  const rows = await queryAll<{ product_id: string; variant_id: string | null; n: number }>(
    db,
    `SELECT product_id, variant_id, COUNT(*) AS n FROM inventory
     WHERE product_id IN (${bindList(productIds.length)}) AND ${SELLABLE_INVENTORY_SQL}
     GROUP BY product_id, variant_id`,
    ...productIds,
    Date.now(),
  );
  for (const row of rows) counts.set(`${row.product_id}:${row.variant_id ?? ""}`, row.n);
  return counts;
}

export async function activeVariants(db: D1Database, productIds: string[]): Promise<Map<string, VariantRow[]>> {
  const map = new Map<string, VariantRow[]>();
  if (productIds.length === 0) return map;
  const rows = await queryAll<VariantRow>(
    db,
    `SELECT * FROM product_variants WHERE is_active = 1 AND product_id IN (${bindList(productIds.length)}) ORDER BY sort_order, price`,
    ...productIds,
  );
  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    list.push(row);
    map.set(row.product_id, list);
  }
  return map;
}

function variantStock(product: ProductRow, variant: VariantRow, counts: Map<StockKey, number>): number | null {
  if (product.delivery_type === "inventory") return counts.get(`${product.id}:${variant.id}`) ?? 0;
  if (product.delivery_type === "static" || bool(variant.unlimited_stock)) return null;
  return variant.stock;
}

function productStock(product: ProductRow, counts: Map<StockKey, number>): number | null {
  if (product.delivery_type === "inventory") return counts.get(`${product.id}:`) ?? 0;
  if (product.delivery_type === "static" || bool(product.unlimited_stock)) return null;
  return product.stock;
}

function sumStock(values: Array<number | null>): number | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

async function buildCards(db: D1Database, rows: ProductListRow[], locale: Locale): Promise<ProductCardData[]> {
  const ids = rows.map((row) => row.id);
  const [counts, variants] = await Promise.all([inventoryCounts(db, ids), activeVariants(db, ids)]);
  return rows.map((row) => {
    const productVariants = variants.get(row.id) ?? [];
    const cheapest = productVariants.reduce<VariantRow | null>((min, v) => (!min || v.price < min.price ? v : min), null);
    const stock = productVariants.length
      ? sumStock(productVariants.map((variant) => variantStock(row, variant, counts)))
      : productStock(row, counts);
    return {
      id: row.id,
      slug: row.slug,
      name: pickText(parseLocalized(row.name), locale),
      shortDescription: pickText(parseLocalized(row.short_description), locale),
      thumbnailUrl: row.thumbnail_url,
      accent: row.accent,
      price: cheapest?.price ?? row.price,
      oldPrice: cheapest ? cheapest.old_price : row.old_price,
      currency: row.currency,
      hasVariants: productVariants.length > 0,
      categoryName: row.category_name ? pickText(parseLocalized(row.category_name), locale) : null,
      categorySlug: row.category_slug,
      isFeatured: bool(row.is_featured),
      isPopular: bool(row.is_popular),
      stock,
      deliveryType: row.delivery_type,
      deliveryTime: pickText(parseLocalized(row.delivery_time), locale),
    };
  });
}

const PRODUCT_SELECT = `SELECT p.*, c.slug AS category_slug, c.name AS category_name
  FROM products p LEFT JOIN categories c ON c.id = p.category_id`;

export type ProductSort = "featured" | "price_asc" | "price_desc" | "newest" | "name";

export interface ProductQuery {
  categorySlug?: string | null;
  search?: string | null;
  sort?: ProductSort;
  featured?: boolean;
  popular?: boolean;
  limit?: number;
  excludeIds?: string[];
}

export async function listProducts(db: D1Database, locale: Locale, query: ProductQuery = {}): Promise<ProductCardData[]> {
  const where = ["p.is_active = 1", "(c.id IS NULL OR c.is_active = 1)"];
  const params: Array<string | number> = [];
  if (query.categorySlug) {
    where.push("c.slug = ?");
    params.push(query.categorySlug);
  }
  if (query.featured) where.push("p.is_featured = 1");
  if (query.popular) where.push("p.is_popular = 1");
  if (query.search) {
    const term = `%${query.search.replace(/[%_\\]/g, (m) => `\\${m}`).toLowerCase()}%`;
    where.push("(lower(p.name) LIKE ? ESCAPE '\\' OR lower(p.short_description) LIKE ? ESCAPE '\\' OR lower(p.tags) LIKE ? ESCAPE '\\')");
    params.push(term, term, term);
  }
  if (query.excludeIds?.length) {
    where.push(`p.id NOT IN (${bindList(query.excludeIds.length)})`);
    params.push(...query.excludeIds);
  }
  const order: Record<ProductSort, string> = {
    featured: "p.is_featured DESC, p.sort_priority DESC, p.created_at DESC",
    price_asc: "p.price ASC",
    price_desc: "p.price DESC",
    newest: "p.created_at DESC",
    name: "lower(p.name) ASC",
  };
  const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
  const rows = await queryAll<ProductListRow>(
    db,
    `${PRODUCT_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order[query.sort ?? "featured"]} LIMIT ${limit}`,
    ...params,
  );
  const cards = await buildCards(db, rows, locale);
  if (query.sort === "price_asc") cards.sort((a, b) => a.price - b.price);
  if (query.sort === "price_desc") cards.sort((a, b) => b.price - a.price);
  if (query.sort === "name") cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards;
}

export async function listCategories(db: D1Database, locale: Locale): Promise<CategorySummary[]> {
  const rows = await queryAll<CategoryRow & { product_count: number }>(
    db,
    `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
     FROM categories c WHERE c.is_active = 1 ORDER BY c.sort_order, c.created_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: pickText(parseLocalized(row.name), locale),
    description: pickText(parseLocalized(row.description), locale),
    icon: toCategoryIcon(row.icon),
    productCount: row.product_count,
  }));
}

export async function getProductRowBySlug(db: D1Database, slug: string): Promise<ProductListRow | null> {
  return queryFirst<ProductListRow>(db, `${PRODUCT_SELECT} WHERE p.slug = ? AND p.is_active = 1 AND (c.id IS NULL OR c.is_active = 1)`, slug);
}

export async function getProductDetail(db: D1Database, slug: string, locale: Locale): Promise<ProductDetailData | null> {
  const row = await getProductRowBySlug(db, slug);
  if (!row) return null;
  const [[card], images, variants, counts, instruction] = await Promise.all([
    buildCards(db, [row], locale),
    queryAll<{ url: string; alt: string }>(db, "SELECT url, alt FROM product_images WHERE product_id = ? ORDER BY sort_order", row.id),
    activeVariants(db, [row.id]),
    inventoryCounts(db, [row.id]),
    row.instruction_id
      ? queryFirst<{ slug: string; title: string }>(db, "SELECT slug, title FROM instructions WHERE id = ? AND is_published = 1", row.instruction_id)
      : Promise.resolve(null),
  ]);
  if (!card) return null;
  const variantData: VariantData[] = (variants.get(row.id) ?? []).map((variant) => ({
    id: variant.id,
    name: pickText(parseLocalized(variant.name), locale),
    price: variant.price,
    oldPrice: variant.old_price,
    stock: variantStock(row, variant, counts),
  }));
  const faq = parseJson<FaqItem[]>(row.faq, [])
    .map((item) => ({ question: pickText(item.question, locale), answer: pickText(item.answer, locale) }))
    .filter((item) => item.question && item.answer);
  const name = card.name;
  return {
    ...card,
    description: pickText(parseLocalized(row.description), locale),
    gallery: images,
    variants: variantData,
    warranty: pickText(parseLocalized(row.warranty), locale),
    requirements: pickText(parseLocalized(row.requirements), locale),
    regionRestrictions: pickText(parseLocalized(row.region_restrictions), locale),
    tags: row.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    seoTitle: pickText(parseLocalized(row.seo_title), locale) || name,
    seoDescription: pickText(parseLocalized(row.seo_description), locale) || card.shortDescription,
    faq,
    quantityDiscounts: parseQuantityDiscounts(row.quantity_discounts),
    minQuantity: row.min_quantity,
    maxQuantity: Math.max(row.max_quantity, row.min_quantity),
    instructionSlug: instruction?.slug ?? null,
    instructionTitle: instruction ? pickText(parseLocalized(instruction.title), locale) : null,
    updatedAt: row.updated_at,
  };
}

export async function getRelatedProducts(db: D1Database, product: { id: string; categorySlug: string | null }, locale: Locale): Promise<ProductCardData[]> {
  const explicit = await queryAll<ProductListRow>(
    db,
    `${PRODUCT_SELECT} JOIN product_related r ON r.related_id = p.id
     WHERE r.product_id = ? AND p.is_active = 1 ORDER BY r.sort_order LIMIT 4`,
    product.id,
  );
  if (explicit.length > 0) return buildCards(db, explicit, locale);
  return listProducts(db, locale, { categorySlug: product.categorySlug, excludeIds: [product.id], limit: 4 });
}
