-- ZHIHE AI core schema. All timestamps are unix epoch milliseconds (UTC).
-- Monetary amounts are integers in minor units (cents).
-- Localized text columns hold JSON objects keyed by locale: {"en": "...", "ru": "...", "zh": "..."}.

CREATE TABLE admins (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager')),
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE admin_sessions (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX idx_admin_sessions_admin ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE categories (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '{}',
  icon TEXT NOT NULL DEFAULT 'box',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE instructions (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '{}',
  content TEXT NOT NULL DEFAULT '{}',
  is_published INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
  instruction_id TEXT REFERENCES instructions(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  short_description TEXT NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '{}',
  thumbnail_url TEXT,
  accent TEXT NOT NULL DEFAULT '#7c6cff',
  price INTEGER NOT NULL CHECK (price >= 0),
  old_price INTEGER CHECK (old_price IS NULL OR old_price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unlimited_stock INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  max_quantity INTEGER NOT NULL DEFAULT 10 CHECK (max_quantity >= 1),
  is_active INTEGER NOT NULL DEFAULT 1,
  is_featured INTEGER NOT NULL DEFAULT 0,
  is_popular INTEGER NOT NULL DEFAULT 0,
  sort_priority INTEGER NOT NULL DEFAULT 0,
  delivery_type TEXT NOT NULL DEFAULT 'inventory' CHECK (delivery_type IN ('inventory', 'manual', 'static')),
  delivery_time TEXT NOT NULL DEFAULT '{}',
  static_delivery TEXT,
  warranty TEXT NOT NULL DEFAULT '{}',
  requirements TEXT NOT NULL DEFAULT '{}',
  region_restrictions TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '',
  seo_title TEXT NOT NULL DEFAULT '{}',
  seo_description TEXT NOT NULL DEFAULT '{}',
  faq TEXT NOT NULL DEFAULT '[]',
  quantity_discounts TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_listing ON products(is_active, sort_priority DESC);

CREATE TABLE product_images (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_images_product ON product_images(product_id, sort_order);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sku TEXT,
  price INTEGER NOT NULL CHECK (price >= 0),
  old_price INTEGER CHECK (old_price IS NULL OR old_price >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
  unlimited_stock INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_product_variants_product ON product_variants(product_id, sort_order);

CREATE TABLE product_related (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  related_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, related_id)
);

CREATE TABLE promo_codes (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL CHECK (type IN ('percent', 'fixed')),
  value INTEGER NOT NULL CHECK (value > 0),
  currency TEXT,
  min_order_amount INTEGER NOT NULL DEFAULT 0,
  max_uses INTEGER,
  per_user_limit INTEGER,
  starts_at INTEGER,
  expires_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE promo_code_products (
  promo_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_id, product_id)
);

CREATE TABLE promo_code_categories (
  promo_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (promo_id, category_id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telegram TEXT,
  locale TEXT,
  orders_count INTEGER NOT NULL DEFAULT 0,
  paid_orders_count INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  first_seen_at INTEGER NOT NULL,
  last_order_at INTEGER NOT NULL
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  access_salt TEXT NOT NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  telegram TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  status TEXT NOT NULL CHECK (status IN ('pending', 'waiting_payment', 'paid', 'processing', 'completed', 'cancelled', 'refunded', 'failed')),
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid', 'refunded', 'failed')),
  currency TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL CHECK (total >= 0),
  promo_code_id TEXT REFERENCES promo_codes(id) ON DELETE SET NULL,
  promo_code TEXT,
  customer_note TEXT,
  admin_note TEXT NOT NULL DEFAULT '',
  ip TEXT,
  user_agent TEXT,
  expires_at INTEGER,
  paid_at INTEGER,
  delivered_at INTEGER,
  completed_at INTEGER,
  cancelled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_status ON orders(status, created_at);
CREATE INDEX idx_orders_email ON orders(email);
CREATE INDEX idx_orders_created ON orders(created_at);
CREATE INDEX idx_orders_paid ON orders(paid_at);
CREATE INDEX idx_orders_expires ON orders(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  instruction_id TEXT REFERENCES instructions(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  product_slug TEXT,
  delivery_type TEXT NOT NULL,
  unit_price INTEGER NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  discount INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  stock_reserved INTEGER NOT NULL DEFAULT 0,
  delivered_quantity INTEGER NOT NULL DEFAULT 0,
  delivery_content TEXT,
  delivered_at INTEGER
);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

CREATE TABLE inventory (
  id TEXT PRIMARY KEY,
  product_id TEXT REFERENCES products(id) ON DELETE SET NULL,
  variant_id TEXT REFERENCES product_variants(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'sold')),
  order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
  order_item_id TEXT REFERENCES order_items(id) ON DELETE SET NULL,
  reserved_until INTEGER,
  sold_at INTEGER,
  batch TEXT,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_inventory_unique_content ON inventory(product_id, content_hash);
CREATE INDEX idx_inventory_pick ON inventory(product_id, variant_id, status, created_at);
CREATE INDEX idx_inventory_order_item ON inventory(order_item_id, status);
CREATE INDEX idx_inventory_reserved ON inventory(status, reserved_until);

CREATE TABLE order_events (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL DEFAULT '',
  is_internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_order_events_order ON order_events(order_id, created_at);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('created', 'pending', 'paid', 'expired', 'failed', 'refunded')),
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL,
  pay_url TEXT,
  tx_reference TEXT,
  details TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE UNIQUE INDEX idx_payments_provider_ref ON payments(provider, provider_ref) WHERE provider_ref IS NOT NULL;
CREATE INDEX idx_payments_order ON payments(order_id);

CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  result TEXT NOT NULL DEFAULT ''
);

CREATE TABLE promo_redemptions (
  id TEXT PRIMARY KEY,
  promo_id TEXT NOT NULL REFERENCES promo_codes(id) ON DELETE CASCADE,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  email TEXT NOT NULL COLLATE NOCASE,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved', 'redeemed', 'released')),
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_promo_redemptions_promo ON promo_redemptions(promo_id, status);
CREATE INDEX idx_promo_redemptions_email ON promo_redemptions(promo_id, email, status);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  alt TEXT NOT NULL DEFAULT '',
  uploaded_by TEXT REFERENCES admins(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES admins(id) ON DELETE SET NULL,
  admin_email TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  ip TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
