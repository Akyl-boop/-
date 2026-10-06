import type { I18n, Num } from "./utils";

export interface Paged<T> { items: T[]; total: number; page: number; page_size: number; pages: number }

export interface Admin {
  id: number; email: string; name: string; is_owner: boolean;
  role: { id: number; slug: string; name: string; color?: string };
  permissions: string[]; totp_enabled: boolean; telegram_linked: boolean; telegram_2fa_enabled: boolean;
  receive_telegram_notifications: boolean; last_login_at?: string; avatar_url?: string | null;
  preferences: Record<string, unknown>;
}

export interface UserBrief {
  id: number; telegram_id: number; username?: string | null; first_name?: string | null; last_name?: string | null;
  display_name: string; language: string; is_banned: boolean;
}

export interface Customer extends UserBrief {
  language_code?: string; is_premium: boolean; ban_reason?: string | null; bot_blocked: boolean; balance: Num;
  referral_code: string; referred_by_id?: number | null; total_spent: Num; orders_count: number; paid_orders_count: number;
  last_activity_at?: string | null; first_order_at?: string | null; created_at: string; tags: Tag[]; start_param?: string | null;
}

export interface Tag { id: number; name: string; color: string; description?: string | null; customers?: number }

export interface Variant {
  id?: number; sku: string; name: I18n; attributes: Record<string, string>; price: Num; old_price?: Num; cost_price?: Num;
  manual_stock: number; delivery_mode?: string | null; fulfillment_config?: Record<string, unknown> | null;
  instructions?: I18n; sort_order?: number; is_active: boolean; is_default?: boolean; stock?: number | null;
}

export interface Product {
  id: number; slug: string; name: I18n; display_name: string; emoji?: string | null; custom_emoji_id?: string | null;
  category_id?: number | null; category?: { id: number; name: I18n; emoji?: string | null } | null;
  media_id?: string | null; status: string; sort_order: number; is_featured: boolean; price_min: Num; price_max: Num;
  stock: number | null; stock_mode: string; delivery_mode: string; sold_count: number; views_count: number;
  rating_avg?: Num; rating_count: number; variants_count: number; tags: string[]; created_at: string; updated_at: string;
  short_description?: I18n; description?: I18n; currency?: string | null; warranty?: I18n; delivery_instructions?: I18n;
  fulfillment_config?: Record<string, unknown>; min_quantity?: number; max_quantity?: number | null;
  max_per_customer?: number | null; regions?: string[]; languages?: string[];
  option_groups?: { key: string; name: I18n }[]; variants: Variant[]; low_stock_threshold?: number;
}

export interface Category {
  id: number; parent_id?: number | null; slug: string; name: I18n; description: I18n; emoji?: string | null;
  custom_emoji_id?: string | null; media_id?: string | null; sort_order: number; is_visible: boolean;
  product_count?: number | null;
}

export interface OrderItem {
  id: number; product_id?: number | null; variant_id?: number | null; product_name: string; variant_name?: string | null;
  sku?: string | null; unit_price: Num; unit_cost?: Num; quantity: number; discount: Num; total: Num;
  delivery_mode: string; delivered_quantity: number; delivered_at?: string | null;
  delivery?: { type: string; value?: string; media_id?: string | null; name?: string | null }[];
}

export interface Payment {
  id: string; reference: string; order_id: number; method_code: string; provider: string; status: string; amount: Num;
  currency: string; pay_amount?: Num; pay_currency?: string | null; network?: string | null; address?: string | null;
  memo?: string | null; pay_url?: string | null; external_id?: string | null; tx_hash?: string | null; confirmations: number;
  confirmations_required?: number | null; received_amount?: Num; refunded_amount: Num; expires_at?: string | null;
  paid_at?: string | null; last_checked_at?: string | null; error?: string | null; created_at: string; kind?: string | null;
  order_number?: string | null; customer?: UserBrief | null;
}

export interface OrderBrief {
  id: number; number: string; status: string; delivery_status: string; customer: UserBrief; product?: string | null;
  variant?: string | null; items_count: number; quantity: number; total: Num; amount_due: Num; currency: string;
  payment_method?: string | null; created_at: string; paid_at?: string | null; source: string;
}

export interface Order extends OrderBrief {
  subtotal: Num; discount_total: Num; balance_used: Num; cost_total?: Num; refunded_amount: Num; promo_code?: string | null;
  language: string; admin_notes?: string | null; customer_note?: string | null; expires_at?: string | null;
  delivered_at?: string | null; completed_at?: string | null; cancelled_at?: string | null; items: OrderItem[];
  payments: Payment[]; customer_full: Customer; refundable: Num;
  timeline: { id: number; type: string; message: string; data?: Record<string, unknown> | null; actor: string; admin?: string | null; created_at: string }[];
  refunds: { id: number; amount: Num; method: string; reason?: string | null; created_at: string; admin?: string | null }[];
}

export interface MediaItem {
  id: string; title: string; original_name: string; folder: string; mime_type: string; kind: string; size: number;
  width?: number | null; height?: number | null; duration?: number | null; url: string; created_at: string; updated_at: string; version: number;
}

export interface Language { code: string; name: string; native_name: string; flag: string; enabled: boolean; sort_order: number; customers?: number; coverage?: number; translated?: number; total?: number }
