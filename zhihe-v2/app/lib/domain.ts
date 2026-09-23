import type { LocalizedText } from "./localized";

export const ORDER_STATUSES = ["pending", "waiting_payment", "paid", "processing", "completed", "cancelled", "refunded", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = ["unpaid", "pending", "paid", "refunded", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const DELIVERY_TYPES = ["inventory", "manual", "static"] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

export const INVENTORY_STATUSES = ["available", "reserved", "sold"] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const PAYMENT_METHODS = ["cryptobot", "manual_crypto", "free"] as const;
export type PaymentMethodId = (typeof PAYMENT_METHODS)[number];

export const CATEGORY_ICONS = ["sparkles", "gamepad", "code", "wrench", "box", "music", "shield", "globe", "cloud", "gift"] as const;
export type CategoryIcon = (typeof CATEGORY_ICONS)[number];

/** Statuses from which a successful payment may still be applied. */
export const PAYABLE_STATUSES: readonly OrderStatus[] = ["pending", "waiting_payment", "failed", "cancelled"];
/** Statuses counted as revenue. */
export const REVENUE_STATUSES: readonly OrderStatus[] = ["paid", "processing", "completed"];

export interface QuantityDiscount {
  minQuantity: number;
  percent: number;
}

export interface FaqItem {
  question: LocalizedText;
  answer: LocalizedText;
}

export interface CategorySummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: CategoryIcon;
  productCount: number;
}

export interface ProductCardData {
  id: string;
  slug: string;
  name: string;
  shortDescription: string;
  thumbnailUrl: string | null;
  accent: string;
  price: number;
  oldPrice: number | null;
  currency: string;
  hasVariants: boolean;
  categoryName: string | null;
  categorySlug: string | null;
  isFeatured: boolean;
  isPopular: boolean;
  /** null = unlimited */
  stock: number | null;
  deliveryType: DeliveryType;
  deliveryTime: string;
}

export interface VariantData {
  id: string;
  name: string;
  price: number;
  oldPrice: number | null;
  stock: number | null;
}

export interface ResolvedFaq {
  question: string;
  answer: string;
}

export interface ProductDetailData extends ProductCardData {
  description: string;
  gallery: { url: string; alt: string }[];
  variants: VariantData[];
  warranty: string;
  requirements: string;
  regionRestrictions: string;
  tags: string[];
  seoTitle: string;
  seoDescription: string;
  faq: ResolvedFaq[];
  quantityDiscounts: QuantityDiscount[];
  minQuantity: number;
  maxQuantity: number;
  instructionSlug: string | null;
  instructionTitle: string | null;
  updatedAt: number;
}

export interface Wallet {
  id: string;
  label: string;
  network: string;
  asset: string;
  address: string;
  memo: string;
}
