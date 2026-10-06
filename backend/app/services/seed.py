"""Seeding: core reference data (idempotent) and optional demo data."""

from __future__ import annotations

import random
import uuid
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import encrypt_str, sha256_hex
from app.core.utils import money, random_code, utcnow
from app.localization.defaults import DEFAULT_LANGUAGES
from app.models import (
    Admin,
    CustomerTag,
    FaqItem,
    InventoryItem,
    Language,
    MenuButton,
    Order,
    OrderEvent,
    OrderItem,
    Page,
    Payment,
    PaymentMethod,
    Permission,
    Product,
    ProductVariant,
    PromoCode,
    Review,
    Role,
    Ticket,
    TicketMessage,
    User,
)
from app.models.catalog import Category
from app.models.enums import (
    DeliveryMode,
    DeliveryStatus,
    InventoryStatus,
    OrderStatus,
    PaymentStatus,
    ProductStatus,
    PromoType,
    ReviewStatus,
    StockMode,
    TicketStatus,
)
from app.security.passwords import hash_password
from app.security.permissions import DEFAULT_ROLES, PERMISSIONS


def L(en: str, ru: str, zh: str) -> dict[str, str]:  # noqa: N802
    return {"en": en, "ru": ru, "zh": zh}


async def seed_core(session: AsyncSession) -> None:
    # Permissions
    existing = {p.code for p in (await session.execute(select(Permission))).scalars()}
    for p in PERMISSIONS:
        if p.code not in existing:
            session.add(Permission(code=p.code, name=p.name, group=p.group))
    await session.flush()
    perms = {p.code: p for p in (await session.execute(select(Permission))).scalars()}
    # Roles
    for slug, spec in DEFAULT_ROLES.items():
        role = (await session.execute(select(Role).where(Role.slug == slug))).scalar_one_or_none()
        if role is None:
            role = Role(slug=slug, name=spec["name"], description=spec["description"], color=spec["color"],
                        is_system=True)
            role.permissions = [perms[c] for c in spec["permissions"] if c in perms]
            session.add(role)
        elif slug == "owner":
            role.permissions = list(perms.values())
    # Languages
    for lang in DEFAULT_LANGUAGES:
        if await session.get(Language, lang["code"]) is None:
            session.add(Language(**lang, enabled=True))
    # Main menu
    if not (await session.execute(select(func.count()).select_from(MenuButton))).scalar_one():
        main = [
            (0, 0, "catalog", L("Catalog", "Каталог", "商品目录"), "🛍", "primary"),
            (1, 0, "cart", L("Cart", "Корзина", "购物车"), "🛒", None),
            (1, 1, "orders", L("My orders", "Мои заказы", "我的订单"), "📦", None),
            (2, 0, "profile", L("Profile", "Профиль", "个人中心"), "👤", None),
            (2, 1, "referrals", L("Invite friends", "Пригласить друзей", "邀请好友"), "🎁", None),
            (3, 0, "support", L("Support", "Поддержка", "客服"), "💬", None),
            (3, 1, "faq", L("FAQ", "FAQ", "常见问题"), "❓", None),
            (4, 0, "language", L("Language", "Язык", "语言"), "🌐", None),
        ]
        for row, pos, action, label, emoji, style in main:
            session.add(MenuButton(menu="main", row=row, position=pos, action=action, label=label, emoji=emoji,
                                   style=style))
        profile = [
            (0, 0, "orders", L("My orders", "Мои заказы", "我的订单"), "📦"),
            (1, 0, "favorites", L("Favorites", "Избранное", "收藏"), "♥"),
            (1, 1, "recent", L("Recently viewed", "Недавние", "最近浏览"), "🕘"),
            (2, 0, "referrals", L("Invite friends", "Пригласить друзей", "邀请好友"), "🎁"),
            (2, 1, "language", L("Language", "Язык", "语言"), "🌐"),
        ]
        for row, pos, action, label, emoji in profile:
            session.add(MenuButton(menu="profile", row=row, position=pos, action=action, label=label, emoji=emoji))
    # System pages
    if (await session.execute(select(Page).where(Page.slug == "terms"))).scalar_one_or_none() is None:
        session.add(Page(
            slug="terms", is_system=True, emoji="📄", sort_order=0,
            title=L("Terms of service", "Условия использования", "服务条款"),
            content=L(
                "By purchasing you agree to the following terms:\n\n• Digital goods are delivered instantly after payment confirmation.\n• Warranty terms are listed on each product page.\n• Refunds are possible if the product does not work as described — contact support.",
                "Совершая покупку, вы соглашаетесь с условиями:\n\n• Цифровые товары выдаются сразу после подтверждения оплаты.\n• Условия гарантии указаны на странице товара.\n• Возврат возможен, если товар не работает как описано — напишите в поддержку.",
                "购买即表示您同意以下条款：\n\n• 付款确认后立即发货。\n• 保修条款见各商品页面。\n• 如商品与描述不符，可联系客服退款。",
            ),
        ))
    if not (await session.execute(select(func.count()).select_from(FaqItem))).scalar_one():
        faqs = [
            ("⚡", L("How fast is delivery?", "Как быстро выдаётся товар?", "多久发货？"),
             L("Instantly. As soon as your payment is confirmed, the product is sent to this chat automatically.",
               "Мгновенно. Сразу после подтверждения оплаты товар автоматически придёт в этот чат.",
               "即时发货。付款确认后，商品会自动发送到此聊天。")),
            ("💳", L("Which payment methods do you accept?", "Какие способы оплаты доступны?", "支持哪些支付方式？"),
             L("Crypto (USDT, TON, LTC and more) and other methods shown at checkout.",
               "Криптовалюта (USDT, TON, LTC и другие) и другие способы, показанные при оформлении.",
               "加密货币（USDT、TON、LTC 等）以及结算时显示的其他方式。")),
            ("🛡", L("What if something doesn't work?", "Что если товар не работает?", "商品无法使用怎么办？"),
             L("Open <b>Support</b>, choose your order and describe the issue — we'll replace it or refund under the warranty.",
               "Откройте <b>Поддержку</b>, выберите заказ и опишите проблему — заменим или вернём деньги по гарантии.",
               "打开<b>客服</b>，选择订单并描述问题——我们将按保修条款更换或退款。")),
        ]
        for i, (emoji, q, a) in enumerate(faqs):
            session.add(FaqItem(question=q, answer=a, emoji=emoji, sort_order=i))
    # Payment methods (disabled until configured, except balance)
    defaults = [
        ("balance", "balance", L("Store balance", "Баланс магазина", "商店余额"), "💰", True, {}),
        ("cryptobot", "cryptobot", L("CryptoBot", "CryptoBot", "CryptoBot"), "🤖", False,
         {"accepted_assets": "USDT,TON,BTC,LTC,ETH", "testnet": False}),
        ("usdt_trc20", "crypto_direct", L("USDT · TRC20", "USDT · TRC20", "USDT · TRC20"), "💎", False,
         {"network": "TRC20", "address_mode": "unique_amount", "confirmations": 1}),
        ("usdt_bep20", "crypto_direct", L("USDT · BEP20", "USDT · BEP20", "USDT · BEP20"), "💎", False,
         {"network": "BEP20", "address_mode": "unique_amount", "confirmations": 3}),
        ("ltc", "crypto_direct", L("Litecoin", "Litecoin", "莱特币"), "Ł", False,
         {"network": "LTC", "address_mode": "unique_amount", "confirmations": 2}),
        ("ton", "crypto_direct", L("TON", "TON", "TON"), "💠", False, {"network": "TON", "confirmations": 1}),
        ("stars", "telegram_stars", L("Telegram Stars", "Telegram Stars", "Telegram Stars"), "⭐", False,
         {"usd_per_star": 0.013}),
        ("card", "telegram_card", L("Bank card", "Банковская карта", "银行卡"), "💳", False,
         {"currency": "USD", "exchange_rate": 1}),
        ("manual", "manual", L("Bank transfer", "Банковский перевод", "银行转账"), "🏦", False,
         {"instructions": L("Transfer the amount to:\n<code>IBAN XX00 0000 0000 0000</code>\nReference: your order number.",
                            "Переведите сумму на:\n<code>IBAN XX00 0000 0000 0000</code>\nНазначение: номер заказа.",
                            "请转账至：\n<code>IBAN XX00 0000 0000 0000</code>\n备注：订单号。")}),
    ]
    existing_methods = {m.code for m in (await session.execute(select(PaymentMethod))).scalars()}
    for i, (code, provider, name, emoji, enabled, public) in enumerate(defaults):
        if code not in existing_methods:
            session.add(PaymentMethod(code=code, provider=provider, name=name, emoji=emoji, enabled=enabled,
                                      sort_order=i, public_config=public))
    # Default customer tags
    if not (await session.execute(select(func.count()).select_from(CustomerTag))).scalar_one():
        for name, color in [("VIP", "#f59e0b"), ("Wholesale", "#3b82f6"), ("New", "#10b981"), ("High value", "#8b5cf6"),
                            ("Problem customer", "#ef4444"), ("Partner", "#06b6d4")]:
            session.add(CustomerTag(name=name, color=color))
    await session.flush()


async def create_admin(session: AsyncSession, email: str, name: str, password: str, role_slug: str = "owner") -> Admin:
    role = (await session.execute(select(Role).where(Role.slug == role_slug))).scalar_one()
    admin = (await session.execute(select(Admin).where(func.lower(Admin.email) == email.lower()))).scalar_one_or_none()
    if admin is None:
        admin = Admin(email=email.lower(), name=name, password_hash=hash_password(password), role_id=role.id,
                      is_owner=role_slug == "owner", password_changed_at=utcnow())
        session.add(admin)
    else:
        admin.password_hash = hash_password(password)
        admin.role_id = role.id
        admin.is_owner = role_slug == "owner"
        admin.is_active = True
        admin.failed_logins = 0
        admin.locked_until = None
    await session.flush()
    return admin


# ─── Demo data ──────────────────────────────────────────────────────────────


async def seed_demo(session: AsyncSession, customers: int = 60, orders: int = 160) -> dict[str, int]:
    rng = random.Random(42)
    if (await session.execute(select(func.count()).select_from(Product))).scalar_one():
        return {"skipped": 1}
    cats = {
        "ai": Category(slug="ai-tools", name=L("AI Tools", "ИИ-сервисы", "AI 工具"), emoji="🤖", sort_order=0,
                       description=L("Premium subscriptions for the best AI assistants.", "Премиум-подписки на лучшие ИИ-ассистенты.", "顶级 AI 助手的高级订阅。")),
        "stream": Category(slug="streaming", name=L("Streaming", "Стриминг", "流媒体"), emoji="🎬", sort_order=1,
                           description=L("Movies, series and music without limits.", "Фильмы, сериалы и музыка без ограничений.", "无限畅享电影、剧集和音乐。")),
        "games": Category(slug="games", name=L("Games", "Игры", "游戏"), emoji="🎮", sort_order=2,
                          description=L("Game keys, gift cards and in-game currency.", "Ключи, подарочные карты и игровая валюта.", "游戏激活码、礼品卡和游戏币。")),
        "soft": Category(slug="software", name=L("Software", "Софт", "软件"), emoji="💻", sort_order=3,
                         description=L("Licenses for productivity and security software.", "Лицензии на программы для работы и безопасности.", "办公与安全软件授权。")),
        "vpn": Category(slug="vpn", name=L("VPN & Privacy", "VPN и приватность", "VPN 与隐私"), emoji="🛡", sort_order=4),
    }
    session.add_all(cats.values())
    await session.flush()

    def product(slug: str, cat: str, name: dict, short: dict, emoji: str, variants: list[tuple], *, groups=None,
                delivery=DeliveryMode.INVENTORY, stock_mode=StockMode.INVENTORY, featured=False, warranty=None,
                config=None) -> Product:
        p = Product(
            slug=slug, category_id=cats[cat].id, name=name, short_description=short, emoji=emoji,
            description=L("✔ Official activation\n✔ Instant delivery after payment\n✔ Step-by-step instructions included",
                          "✔ Официальная активация\n✔ Мгновенная выдача после оплаты\n✔ Пошаговая инструкция в комплекте",
                          "✔ 官方激活\n✔ 付款后即时发货\n✔ 附带详细使用说明"),
            status=ProductStatus.ACTIVE, stock_mode=stock_mode, delivery_mode=delivery, is_featured=featured,
            option_groups=groups or [], warranty=warranty or L("30 days", "30 дней", "30 天"),
            delivery_instructions=L("Log in at the official website and redeem the code in account settings.",
                                    "Войдите на официальном сайте и активируйте код в настройках аккаунта.",
                                    "登录官网并在账户设置中兑换激活码。"),
            fulfillment_config=config or {}, tags=[slug.split("-")[0]],
        )
        for i, (vname, attrs, price, old, cost) in enumerate(variants):
            p.variants.append(ProductVariant(
                sku=f"{slug.upper()[:10]}-{i + 1}-{random_code(4)}", name=vname, attributes=attrs,
                price=Decimal(str(price)), old_price=Decimal(str(old)) if old else None,
                cost_price=Decimal(str(cost)) if cost else None, sort_order=i, is_default=i == 0,
                manual_stock=50 if stock_mode == StockMode.MANUAL else 0,
            ))
        session.add(p)
        return p

    plan = [{"key": "plan", "name": L("Plan", "Тариф", "套餐")}, {"key": "duration", "name": L("Duration", "Срок", "时长")}]
    chatgpt = product("chatgpt", "ai", L("ChatGPT", "ChatGPT", "ChatGPT"),
                      L("Plus & Pro subscriptions on your account", "Подписки Plus и Pro на ваш аккаунт", "Plus 与 Pro 账户订阅"),
                      "🧠", [
                          (L("Plus · 1 month", "Plus · 1 месяц", "Plus · 1 个月"), {"plan": "Plus", "duration": "1 month"}, 19.9, 24, 14),
                          (L("Plus · 3 months", "Plus · 3 месяца", "Plus · 3 个月"), {"plan": "Plus", "duration": "3 months"}, 56, 72, 40),
                          (L("Plus · 12 months", "Plus · 12 месяцев", "Plus · 12 个月"), {"plan": "Plus", "duration": "12 months"}, 199, 288, 150),
                          (L("Pro · 1 month", "Pro · 1 месяц", "Pro · 1 个月"), {"plan": "Pro", "duration": "1 month"}, 189, 200, 150),
                          (L("Pro · 3 months", "Pro · 3 месяца", "Pro · 3 个月"), {"plan": "Pro", "duration": "3 months"}, 549, 600, 430),
                      ], groups=plan, featured=True)
    claude = product("claude-pro", "ai", L("Claude Pro", "Claude Pro", "Claude Pro"),
                     L("More usage, priority access, Projects", "Больше лимитов, приоритет, Projects", "更多用量、优先访问、项目功能"),
                     "✨", [(L("1 month", "1 месяц", "1 个月"), {}, 19.5, 22, 15), (L("12 months", "12 месяцев", "12 个月"), {}, 199, 240, 160)])
    midj = product("midjourney", "ai", L("Midjourney", "Midjourney", "Midjourney"),
                   L("Generate stunning images", "Генерация потрясающих изображений", "生成惊艳图像"), "🎨",
                   [(L("Basic", "Basic", "基础版"), {}, 9.5, 10, 7), (L("Standard", "Standard", "标准版"), {}, 28, 30, 22)],
                   delivery=DeliveryMode.MANUAL, stock_mode=StockMode.UNLIMITED)
    netflix = product("netflix-premium", "stream", L("Netflix Premium", "Netflix Premium", "Netflix 高级版"),
                      L("4K UHD · 4 screens", "4K UHD · 4 экрана", "4K 超高清 · 4 屏"), "🎬",
                      [(L("1 month", "1 месяц", "1 个月"), {}, 7.9, 9.9, 5), (L("6 months", "6 месяцев", "6 个月"), {}, 42, 59, 30)])
    spotify = product("spotify-premium", "stream", L("Spotify Premium", "Spotify Premium", "Spotify 高级版"),
                      L("Ad-free music, offline listening", "Музыка без рекламы, офлайн", "无广告音乐、离线收听"), "🎧",
                      [(L("1 month", "1 месяц", "1 个月"), {}, 4.5, 6, 3), (L("12 months", "12 месяцев", "12 个月"), {}, 45, 60, 32)])
    steam = product("steam-gift-card", "games", L("Steam Gift Card", "Подарочная карта Steam", "Steam 礼品卡"),
                    L("Global wallet codes", "Глобальные коды пополнения", "全球钱包充值码"), "🎮",
                    [(L("$10", "$10", "$10"), {}, 10.9, None, 10), (L("$20", "$20", "$20"), {}, 21.5, None, 20),
                     (L("$50", "$50", "$50"), {}, 53, None, 50)], featured=True)
    xbox = product("xbox-game-pass", "games", L("Xbox Game Pass Ultimate", "Xbox Game Pass Ultimate", "Xbox Game Pass 终极版"),
                   L("Hundreds of games + EA Play", "Сотни игр + EA Play", "数百款游戏 + EA Play"), "🟩",
                   [(L("1 month", "1 месяц", "1 个月"), {}, 12.9, 16.99, 9), (L("3 months", "3 месяца", "3 个月"), {}, 36, 50.97, 27)])
    office = product("microsoft-365", "soft", L("Microsoft 365 Family", "Microsoft 365 Family", "Microsoft 365 家庭版"),
                     L("Office apps + 1 TB OneDrive for 6 people", "Office + 1 ТБ OneDrive для 6 человек", "Office 应用 + 6 人 1TB OneDrive"), "📊",
                     [(L("12 months", "12 месяцев", "12 个月"), {}, 59, 99.99, 40)])
    windows = product("windows-11-pro", "soft", L("Windows 11 Pro", "Windows 11 Pro", "Windows 11 专业版"),
                      L("Lifetime retail key", "Бессрочный retail-ключ", "永久零售密钥"), "🪟",
                      [(L("Retail key", "Retail-ключ", "零售密钥"), {}, 14.9, 199, 6)], warranty=L("Lifetime", "Бессрочно", "终身"))
    vpn = product("nord-vpn", "vpn", L("NordVPN", "NordVPN", "NordVPN"),
                  L("Fast, private, 60+ countries", "Быстрый, приватный, 60+ стран", "快速私密，覆盖 60+ 国家"), "🛡",
                  [(L("1 year", "1 год", "1 年"), {}, 29, 59, 18), (L("2 years", "2 года", "2 年"), {}, 49, 99, 30)],
                  delivery=DeliveryMode.TEXT, stock_mode=StockMode.UNLIMITED,
                  config={"text": L("Activation link: https://example.com/activate/DEMO", "Ссылка активации: https://example.com/activate/DEMO", "激活链接：https://example.com/activate/DEMO")})
    products = [chatgpt, claude, midj, netflix, spotify, steam, xbox, office, windows, vpn]
    await session.flush()

    # Inventory
    for p in products:
        if p.stock_mode != StockMode.INVENTORY:
            continue
        for v in p.variants:
            n = rng.randint(4, 30) if p.slug != "xbox-game-pass" else 2
            for _ in range(n):
                code = "-".join(random_code(5) for _ in range(4))
                session.add(InventoryItem(
                    product_id=p.id, variant_id=v.id, content_enc=encrypt_str(code) or "",
                    content_hash=sha256_hex(f"{v.id}:{code}"), preview=code[:4] + "••••" + code[-4:],
                    status=InventoryStatus.AVAILABLE, batch="demo",
                ))
    # Customers
    first = ["Alex", "Maria", "Ivan", "Wei", "Olga", "John", "Li", "Anna", "Dmitry", "Chen", "Elena", "Max", "Sofia",
             "Yuki", "Pavel", "Lena", "Mark", "Nina", "Tom", "Zhang"]
    langs = ["en", "ru", "zh"]
    users = []
    now = utcnow()
    for i in range(customers):
        name = rng.choice(first)
        created = now - timedelta(days=rng.randint(0, 120), hours=rng.randint(0, 23))
        u = User(telegram_id=7_000_000_000 + i, username=f"{name.lower()}{i}", first_name=name, language=rng.choice(langs),
                 referral_code=random_code(8), created_at=created, last_activity_at=created + timedelta(days=rng.randint(0, 30)))
        users.append(u)
        session.add(u)
    await session.flush()
    for u in users[1:8]:
        from app.models import Referral

        if u.id != users[0].id:
            u.referred_by_id = users[0].id
            session.add(Referral(referrer_id=users[0].id, referred_id=u.id))
    # Orders
    seq_start = 10001
    statuses = [OrderStatus.COMPLETED] * 14 + [OrderStatus.CANCELLED, OrderStatus.EXPIRED, OrderStatus.REFUNDED,
                                               OrderStatus.AWAITING_PAYMENT, OrderStatus.PROCESSING]
    methods = ["usdt_trc20", "cryptobot", "stars", "usdt_bep20", "ton", "manual"]
    created_orders = 0
    for i in range(orders):
        u = rng.choice(users)
        p = rng.choice(products)
        v = rng.choice(p.variants)
        qty = 1 if rng.random() < 0.85 else 2
        created = now - timedelta(days=rng.randint(0, 89), hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        if created < u.created_at:
            created = u.created_at + timedelta(hours=1)
        status = rng.choice(statuses)
        subtotal = money(v.price * qty)
        order = Order(number=f"DEMO-{seq_start + i}", user_id=u.id, status=status, currency="USD", subtotal=subtotal,
                      total=subtotal, language=u.language, payment_method=rng.choice(methods), created_at=created,
                      updated_at=created, cost_total=money((v.cost_price or 0) * qty),
                      delivery_status=DeliveryStatus.DELIVERED if status == OrderStatus.COMPLETED else DeliveryStatus.PENDING)
        paid = status in (OrderStatus.COMPLETED, OrderStatus.REFUNDED, OrderStatus.PROCESSING)
        if paid:
            order.paid_at = created + timedelta(minutes=rng.randint(2, 25))
        if status == OrderStatus.COMPLETED:
            order.completed_at = order.delivered_at = order.paid_at
        if status == OrderStatus.REFUNDED:
            order.refunded_amount = subtotal
        session.add(order)
        await session.flush()
        session.add(OrderItem(order_id=order.id, product_id=p.id, variant_id=v.id, category_id=p.category_id,
                              product_name=p.name["en"], variant_name=v.name["en"] if len(p.variants) > 1 else None,
                              sku=v.sku, unit_price=v.price, unit_cost=v.cost_price, quantity=qty, total=subtotal,
                              delivery_mode=p.delivery_mode,
                              delivered_quantity=qty if status == OrderStatus.COMPLETED else 0))
        pay_status = {OrderStatus.COMPLETED: PaymentStatus.PAID, OrderStatus.REFUNDED: PaymentStatus.REFUNDED,
                      OrderStatus.PROCESSING: PaymentStatus.PAID, OrderStatus.CANCELLED: PaymentStatus.CANCELLED,
                      OrderStatus.EXPIRED: PaymentStatus.EXPIRED}.get(status, PaymentStatus.PENDING)
        session.add(Payment(id=uuid.uuid4(), reference="P" + random_code(10), order_id=order.id,
                            method_code=order.payment_method or "manual", provider="manual", status=pay_status,
                            amount=subtotal, currency="USD", paid_at=order.paid_at, created_at=created,
                            tx_hash=("0x" + uuid.uuid4().hex + uuid.uuid4().hex) if paid and rng.random() < 0.5 else None,
                            network="DEMO" if paid else None, extra={"kind": "manual", "demo": True}))
        session.add(OrderEvent(order_id=order.id, type="created", message="Order created", created_at=created))
        if paid:
            session.add(OrderEvent(order_id=order.id, type="payment_confirmed", message="Payment confirmed",
                                   created_at=order.paid_at))
            u.total_spent = money(u.total_spent + subtotal)
            u.paid_orders_count += 1
            u.first_order_at = min(u.first_order_at or order.paid_at, order.paid_at)
            p.sold_count += qty
        if status == OrderStatus.COMPLETED:
            session.add(OrderEvent(order_id=order.id, type="completed", message="Order completed", created_at=order.paid_at))
            if rng.random() < 0.3:
                session.add(Review(user_id=u.id, product_id=p.id, order_id=order.id, rating=rng.choice([4, 5, 5, 5, 3]),
                                   text=rng.choice(["Instant delivery, works perfectly!", "Great service", "Fast and easy",
                                                    "Всё отлично, спасибо!", "很好，发货很快"]),
                                   status=ReviewStatus.APPROVED))
        u.orders_count += 1
        created_orders += 1
    # Ratings
    await session.flush()
    for p in products:
        avg, cnt = (await session.execute(select(func.avg(Review.rating), func.count(Review.id))
                                          .where(Review.product_id == p.id, Review.status == ReviewStatus.APPROVED))).one()
        p.rating_avg = money(avg) if avg else None
        p.rating_count = int(cnt)
    # Promo codes
    session.add_all([
        PromoCode(code="WELCOME10", type=PromoType.PERCENT, value=Decimal("10"), description="10% for new customers",
                  new_customers_only=True, max_uses_per_user=1),
        PromoCode(code="AI5", type=PromoType.FIXED, value=Decimal("5"), min_purchase=Decimal("30"),
                  category_ids=[cats["ai"].id], description="$5 off AI tools over $30"),
    ])
    # Tickets
    for i, u in enumerate(users[:4]):
        tk = Ticket(number=f"T-D{101 + i}", user_id=u.id, subject=["Code not working", "Payment question", "How to activate?",
                                                                    "Refund request"][i],
                    status=[TicketStatus.WAITING_ADMIN, TicketStatus.WAITING_CUSTOMER, TicketStatus.RESOLVED,
                            TicketStatus.WAITING_ADMIN][i], last_message_at=now - timedelta(hours=i * 5))
        session.add(tk)
        await session.flush()
        session.add(TicketMessage(ticket_id=tk.id, sender="customer", body="Hi! " + tk.subject + " — could you help?"))
    await session.flush()
    return {"categories": len(cats), "products": len(products), "customers": len(users), "orders": created_orders}
