"""Screen builders. Each returns a `Screen` (text + keyboard + optional banner)."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from app.bot import content
from app.bot.callbacks import (
    CartAct,
    Cat,
    Faq,
    Lang,
    MenuBtn,
    Nav,
    Ord,
    Pay,
    Pg,
    Prod,
    ProdAct,
    Rev,
    Sup,
)
from app.bot.context import BotCtx, Kb
from app.bot.render import Screen
from app.core.utils import i18n_get, utcnow
from app.models import (
    Category,
    Favorite,
    Order,
    Payment,
    PaymentMethod,
    Product,
    ProductVariant,
    ProductView,
    Referral,
    RestockSubscription,
    Review,
    Ticket,
    TicketMessage,
)
from app.models.enums import OPEN_ORDER_STATUSES, OrderStatus, PaymentStatus, ReviewStatus, TicketStatus
from app.security.html import escape, sanitize_telegram_html
from app.services import cart as cart_service
from app.services import catalog
from app.services.cart import CartSummary
from app.services.money import format_crypto
from app.services.texts import SafeHtml, cleanup_whitespace

PAGE_SIZE_ORDERS = 6


def _footer(ctx: BotCtx, text: str, footer: str) -> str:
    return f"{text}\n\n{footer}" if footer else text


async def with_footer(ctx: BotCtx, text: str) -> str:
    footer = await ctx.t("common.footer")
    return cleanup_whitespace(_footer(ctx, text, footer.strip()))


def emoji_of(obj: Any) -> str:
    return (getattr(obj, "emoji", None) or "").strip()


def label_with_emoji(emoji: str | None, text: str) -> str:
    return f"{emoji} {text}" if emoji else text


async def nav_row(ctx: BotCtx, back: Any | None = None, home: bool = True) -> list:
    row = []
    if back is not None:
        row.append(ctx.button(await ctx.b("btn.back"), cb=back))
    if home:
        row.append(ctx.button(await ctx.b("btn.home"), cb=Nav(to="home")))
    return row


async def pager(ctx: BotCtx, page: int, pages: int, make_cb: Any) -> list:
    if pages <= 1:
        return []
    row = []
    row.append(ctx.button(await ctx.b("btn.prev"), cb=make_cb(page - 1) if page > 0 else Nav(to="noop")))
    row.append(ctx.button(f"{page + 1}/{pages}", cb=Nav(to="noop")))
    row.append(ctx.button(await ctx.b("btn.next"), cb=make_cb(page + 1) if page < pages - 1 else Nav(to="noop")))
    return row


# ─── Home ───────────────────────────────────────────────────────────────────

FEATURE_FOR_ACTION = {"cart": "cart", "favorites": "favorites", "referrals": "referrals", "support": "support",
                      "search": "search", "recent": "recently_viewed"}


async def menu_keyboard(ctx: BotCtx, menu: str = "main") -> Kb:
    kb = Kb()
    buttons = await content.menu_buttons(menu)
    rows: dict[int, list] = {}
    cart_count = None
    for b in buttons:
        if b["languages"] and ctx.lang not in b["languages"]:
            continue
        feat = FEATURE_FOR_ACTION.get(b["action"])
        if feat and not ctx.feature(feat):
            continue
        label = i18n_get(b["label"], ctx.lang)
        action, value = b["action"], b["value"]
        if action == "cart":
            if cart_count is None:
                cart_count = await cart_service.cart_count(ctx.session, ctx.user.id)
            if cart_count:
                label = f"{label} · {cart_count}"
        cb: Any = None
        url = None
        if action in ("catalog", "cart", "orders", "profile", "search", "favorites", "recent", "referrals", "language"):
            cb = Nav(to={"favorites": "fav", "referrals": "ref", "language": "lang"}.get(action, action))
        elif action == "support":
            cb = Sup(act="home")
        elif action == "faq":
            cb = Faq(id=0)
        elif action == "page" and value:
            cb = Pg(slug=value[:40])
        elif action == "terms":
            cb = Pg(slug=ctx.cfg["general"].get("terms_page") or "terms")
        elif action == "category" and value and value.isdigit():
            cb = Cat(id=int(value))
        elif action == "product" and value and value.isdigit():
            cb = Prod(id=int(value))
        elif action == "url" and value:
            url = value
        elif action == "payment":
            cb = Nav(to="unpaid")
        elif action == "custom":
            cb = MenuBtn(id=b["id"])
        else:
            continue
        rows.setdefault(b["row"], []).append(
            ctx.button(label, cb=cb, url=url, emoji=b["emoji"], custom_emoji_id=b["custom_emoji_id"], style=b["style"])
        )
    for _, row in sorted(rows.items()):
        kb.row(*row)
    return kb


async def home_screen(ctx: BotCtx) -> Screen:
    general = ctx.cfg["general"]
    returning = ctx.user.paid_orders_count > 0
    key = "home.returning" if returning else "home.text"
    text = await ctx.t(key, store_name=general["store_name"], first_name=ctx.user.first_name or "",
                       balance=ctx.money(ctx.user.balance), orders_count=ctx.user.paid_orders_count)
    announcement = (ctx.cfg["bot"].get("announcement") or "").strip()
    if announcement:
        text += "\n\n" + await ctx.t("announcement.title") + "\n" + sanitize_telegram_html(announcement)
    kb = await menu_keyboard(ctx, "main")
    return Screen(await with_footer(ctx, text), kb.markup(), await content.banner("home", ctx.lang))


# ─── Catalog ────────────────────────────────────────────────────────────────


async def catalog_screen(ctx: BotCtx) -> Screen:
    cats = await catalog.visible_categories(ctx.session, None, ctx.lang)
    kb = Kb()
    if not cats:
        text = await ctx.t("catalog.empty")
    else:
        text = await ctx.t("catalog.title")
        buttons = [
            ctx.button(i18n_get(c.name, ctx.lang), cb=Cat(id=c.id), emoji=c.emoji, custom_emoji_id=c.custom_emoji_id)
            for c, _ in cats
        ]
        kb.grid(buttons, int(ctx.cfg["bot"].get("categories_per_row") or 2))
    extra = []
    if ctx.feature("search"):
        extra.append(ctx.button(await ctx.b("btn.search"), cb=Nav(to="search")))
    if ctx.feature("cart"):
        count = await cart_service.cart_count(ctx.session, ctx.user.id)
        extra.append(ctx.button(await ctx.b("btn.cart_count", count=count) if count else await ctx.b("btn.cart"),
                                cb=Nav(to="cart")))
    kb.row(*extra)
    kb.row(*await nav_row(ctx, Nav(to="home"), home=False))
    return Screen(await with_footer(ctx, text), kb.markup(), await content.banner("categories", ctx.lang))


async def product_button_label(ctx: BotCtx, p: Product, stocks: dict[int, int | None]) -> str:
    lo, hi = catalog.price_range(p)
    stock = catalog.product_stock(p, stocks)
    price = ctx.money(lo) if lo == hi else f"{ctx.money(lo)}+"
    name = i18n_get(p.name, ctx.lang)
    mark = " · ✕" if stock == 0 else ""
    return f"{name} · {price}{mark}"


async def category_screen(ctx: BotCtx, cat_id: int, page: int = 0) -> Screen:
    cat = await ctx.session.get(Category, cat_id)
    if cat is None or cat.deleted_at is not None or not cat.is_visible:
        return await catalog_screen(ctx)
    per_page = int(ctx.cfg["bot"].get("products_per_page") or 6)
    subcats = await catalog.visible_categories(ctx.session, cat.id, ctx.lang)
    products, total = await catalog.storefront_products(
        ctx.session, category_id=cat.id, lang=ctx.lang, limit=per_page, offset=page * per_page
    )
    stocks = await catalog.stock_map(ctx.session, products)
    pages = max(1, math.ceil(total / per_page))
    text = await ctx.t("category.text", emoji=emoji_of(cat), name=i18n_get(cat.name, ctx.lang),
                       description=SafeHtml(sanitize_telegram_html(i18n_get(cat.description, ctx.lang))), count=total)
    if not products and not subcats:
        text += "\n\n" + await ctx.t("category.empty")
    kb = Kb()
    if page == 0 and subcats:
        kb.grid([ctx.button(i18n_get(c.name, ctx.lang), cb=Cat(id=c.id), emoji=c.emoji, custom_emoji_id=c.custom_emoji_id)
                 for c, _ in subcats], int(ctx.cfg["bot"].get("categories_per_row") or 2))
    back_ctx = f"c{cat.id}.{page}"
    kb.grid([ctx.button(await product_button_label(ctx, p, stocks), cb=Prod(id=p.id, back=back_ctx), emoji=p.emoji,
                        custom_emoji_id=p.custom_emoji_id) for p in products],
            int(ctx.cfg["bot"].get("products_per_row") or 1))
    kb.row(*await pager(ctx, page, pages, lambda pg: Cat(id=cat.id, page=pg)))
    back = Cat(id=cat.parent_id) if cat.parent_id else Nav(to="catalog")
    kb.row(*await nav_row(ctx, back))
    media = await content.get_media(cat.media_id) or await content.banner("categories", ctx.lang)
    return Screen(await with_footer(ctx, text), kb.markup(), media)


# ─── Product ────────────────────────────────────────────────────────────────


@dataclass
class VariantSelection:
    groups: list[dict[str, Any]]
    chosen: list[int]
    step_values: list[str]  # values available at current step
    candidates: list[ProductVariant]  # variants matching the current selection
    selected: ProductVariant | None


def _variant_value(v: ProductVariant, key: str, lang: str) -> str:
    if key == "__v":
        return i18n_get(v.name, lang)
    return str((v.attributes or {}).get(key, ""))


def resolve_selection(product: Product, sel: str, lang: str) -> VariantSelection:
    active = [v for v in product.variants if v.is_active]
    groups = [g for g in (product.option_groups or []) if g.get("key")]
    if not groups:
        groups = [{"key": "__v", "name": {"en": "option", "ru": "вариант", "zh": "规格"}}]
    chosen = [int(x) for x in sel.split(".") if x.isdigit()] if sel else []
    candidates = active
    if len(active) == 1:
        return VariantSelection(groups, [], [], active, active[0])
    for step, idx in enumerate(chosen[: len(groups)]):
        key = groups[step]["key"]
        values = list(dict.fromkeys(_variant_value(v, key, lang) for v in candidates))
        if idx >= len(values):
            chosen = chosen[:step]
            break
        candidates = [v for v in candidates if _variant_value(v, key, lang) == values[idx]]
    chosen = chosen[: len(groups)]
    if len(chosen) >= len(groups) or len(candidates) == 1:
        return VariantSelection(groups, chosen, [], candidates, candidates[0] if candidates else None)
    key = groups[len(chosen)]["key"]
    step_values = list(dict.fromkeys(_variant_value(v, key, lang) for v in candidates))
    return VariantSelection(groups, chosen, step_values, candidates, None)


def _back_cb(back: str) -> Any:
    if back.startswith("c"):
        parts = back[1:].split(".")
        try:
            return Cat(id=int(parts[0]), page=int(parts[1]) if len(parts) > 1 else 0)
        except ValueError:
            return Nav(to="catalog")
    return {"fav": Nav(to="fav"), "rec": Nav(to="recent"), "s": Nav(to="search"), "cart": Nav(to="cart")}.get(
        back, Nav(to="catalog"))


async def price_block(ctx: BotCtx, variant: ProductVariant | None, product: Product) -> str:
    if variant is not None:
        if variant.old_price and variant.old_price > variant.price:
            pct = int(round((1 - variant.price / variant.old_price) * 100))
            return await ctx.t("product.price_discount", price=ctx.money(variant.price), old_price=ctx.money(variant.old_price),
                               percent=pct)
        return await ctx.t("product.price", price=ctx.money(variant.price))
    lo, hi = catalog.price_range(product)
    return await ctx.t("product.price" if lo == hi else "product.price_from", price=ctx.money(lo))


async def stock_text(ctx: BotCtx, stock: int | None) -> str:
    if stock is None:
        return await ctx.t("product.in_stock")
    if stock <= 0:
        return await ctx.t("product.out_of_stock")
    threshold = int(ctx.cfg["bot"].get("low_stock_display_threshold") or 0)
    if threshold and stock <= threshold:
        return await ctx.t("product.low_stock", count=stock)
    if ctx.cfg["bot"].get("show_stock_count"):
        return await ctx.t("product.in_stock_count", count=stock)
    return await ctx.t("product.in_stock")


async def record_view(ctx: BotCtx, product: Product) -> None:
    from sqlalchemy.dialects.postgresql import insert

    stmt = insert(ProductView).values(user_id=ctx.user.id, product_id=product.id, viewed_at=utcnow())
    await ctx.session.execute(stmt.on_conflict_do_update(
        index_elements=["user_id", "product_id"],
        set_={"viewed_at": utcnow(), "views": ProductView.views + 1},
    ))
    product.views_count += 1


async def product_screen(ctx: BotCtx, product_id: int, sel: str = "", qty: int = 1, back: str = "",
                         count_view: bool = True) -> Screen:
    product = await catalog.get_storefront_product(ctx.session, product_id, ctx.lang)
    if product is None:
        screen = await catalog_screen(ctx)
        screen.text = await ctx.t("error.not_found") + "\n\n" + screen.text
        return screen
    if count_view and not sel:
        await record_view(ctx, product)
    stocks = await catalog.stock_map(ctx.session, [product])
    vs = resolve_selection(product, sel, ctx.lang)
    variant = vs.selected
    stock = stocks.get(variant.id) if variant else catalog.product_stock(product, stocks)
    qty = max(product.min_quantity, qty)
    if product.max_quantity:
        qty = min(qty, product.max_quantity)
    if stock is not None and stock > 0:
        qty = min(qty, stock)

    rating = ""
    if ctx.feature("reviews") and product.rating_count:
        rating = await ctx.t("product.rating", rating=f"{product.rating_avg:.1f}", count=product.rating_count)
    warranty = i18n_get(product.warranty, ctx.lang)
    text = await ctx.t(
        "product.card",
        emoji=emoji_of(product), name=i18n_get(product.name, ctx.lang),
        short_description=i18n_get(product.short_description, ctx.lang),
        description=SafeHtml(sanitize_telegram_html(i18n_get(product.description, ctx.lang))),
        price_block=SafeHtml(await price_block(ctx, variant, product)),
        stock=SafeHtml(await stock_text(ctx, stock)), rating=SafeHtml(rating),
        warranty=SafeHtml(await ctx.t("product.warranty", warranty=warranty) if warranty else ""),
        variant=i18n_get(variant.name, ctx.lang) if variant else "",
    )
    kb = Kb()
    if variant is None:
        group = vs.groups[len(vs.chosen)]
        text += await ctx.t("product.choose_option", option=i18n_get(group.get("name"), ctx.lang).lower() or "option")
        buttons = []
        for i, value in enumerate(vs.step_values):
            matching = [v for v in vs.candidates if _variant_value(v, group["key"], ctx.lang) == value]
            prices = [v.price for v in matching]
            in_stock = any(stocks.get(v.id) is None or (stocks.get(v.id) or 0) > 0 for v in matching)
            price = ctx.money(min(prices)) + ("+" if len(set(prices)) > 1 else "")
            label = f"{value} · {price}" + ("" if in_stock else " · ✕")
            new_sel = ".".join(str(x) for x in [*vs.chosen, i])
            buttons.append(ctx.button(label, cb=Prod(id=product.id, sel=new_sel, back=back)))
        kb.grid(buttons, 1 if len(buttons) > 4 or any(len(b.text) > 18 for b in buttons) else 2)
    else:
        if len([v for v in product.variants if v.is_active]) > 1:
            text += await ctx.t("product.selected", variant=i18n_get(variant.name, ctx.lang))
        available = stock is None or stock > 0
        if available:
            if product.max_quantity != 1 and (stock is None or stock > 1):
                kb.row(
                    ctx.button("−", cb=Prod(id=product.id, sel=sel, qty=max(1, qty - 1), back=back)),
                    ctx.button(f"× {qty}", cb=Nav(to="noop")),
                    ctx.button("+", cb=Prod(id=product.id, sel=sel, qty=qty + 1, back=back)),
                )
            row = []
            if ctx.feature("cart"):
                row.append(ctx.button(await ctx.b("btn.add_to_cart"), cb=ProdAct(act="add", pid=product.id, vid=variant.id, qty=qty)))
            row.append(ctx.button(await ctx.b("btn.buy_now"), cb=ProdAct(act="buy", pid=product.id, vid=variant.id, qty=qty),
                                  style="success"))
            kb.row(*row)
        elif ctx.feature("restock_alerts"):
            subscribed = await ctx.session.get(RestockSubscription, (ctx.user.id, product.id))
            kb.row(ctx.button(await ctx.b("btn.restock_subscribed" if subscribed else "btn.notify_restock"),
                              cb=ProdAct(act="rst", pid=product.id)))
    secondary = []
    if ctx.feature("favorites"):
        fav = await ctx.session.get(Favorite, (ctx.user.id, product.id))
        secondary.append(ctx.button(await ctx.b("btn.favorite_remove" if fav else "btn.favorite_add"),
                                    cb=ProdAct(act="fav", pid=product.id, vid=variant.id if variant else 0)))
    if ctx.feature("reviews") and product.rating_count:
        secondary.append(ctx.button(await ctx.b("btn.reviews", count=product.rating_count), cb=ProdAct(act="rev", pid=product.id)))
    kb.row(*secondary)
    # Back: one option step back, or to where the user came from
    if vs.chosen and len([v for v in product.variants if v.is_active]) > 1:
        prev = ".".join(str(x) for x in vs.chosen[:-1])
        back_cb: Any = Prod(id=product.id, sel=prev, back=back)
    else:
        back_cb = _back_cb(back) if back else (Cat(id=product.category_id) if product.category_id else Nav(to="catalog"))
    if ctx.feature("cart") and variant is not None:
        count = await cart_service.cart_count(ctx.session, ctx.user.id)
        if count:
            kb.row(ctx.button(await ctx.b("btn.cart_count", count=count), cb=Nav(to="cart")))
    kb.row(*await nav_row(ctx, back_cb))
    media = await content.get_media(product.media_id) or await content.banner("products", ctx.lang)
    return Screen(cleanup_whitespace(text), kb.markup(), media)


async def recommendations_text(ctx: BotCtx, product: Product) -> list[Product]:
    if not ctx.feature("recommendations"):
        return []
    return await catalog.recommendations(ctx.session, product, ctx.lang)


async def reviews_screen(ctx: BotCtx, product_id: int) -> Screen:
    product = await catalog.get_storefront_product(ctx.session, product_id, ctx.lang)
    if product is None:
        return await catalog_screen(ctx)
    rows = (
        await ctx.session.execute(
            select(Review).where(Review.product_id == product.id, Review.status == ReviewStatus.APPROVED)
            .order_by(Review.created_at.desc()).limit(8)
        )
    ).scalars().all()
    if rows:
        parts = []
        for r in rows:
            line = "⭐" * r.rating
            if r.text:
                line += f"\n<i>{escape(r.text[:300])}</i>"
            if r.admin_reply:
                line += f"\n↳ {escape(r.admin_reply[:300])}"
            parts.append(line)
        body = "\n\n".join(parts)
    else:
        body = await ctx.t("product.no_reviews")
    text = await ctx.t("product.reviews_title", name=i18n_get(product.name, ctx.lang),
                       rating=f"{product.rating_avg or 0:.1f}", count=product.rating_count, reviews=SafeHtml(body))
    kb = Kb().row(*await nav_row(ctx, Prod(id=product.id)))
    return Screen(text, kb.markup())


async def product_list_screen(ctx: BotCtx, title: str, products: list[Product], back_ctx: str, empty: str,
                              back: Any = None) -> Screen:
    stocks = await catalog.stock_map(ctx.session, products)
    kb = Kb()
    for p in products:
        kb.row(ctx.button(await product_button_label(ctx, p, stocks), cb=Prod(id=p.id, back=back_ctx), emoji=p.emoji,
                          custom_emoji_id=p.custom_emoji_id))
    kb.row(*await nav_row(ctx, back or Nav(to="home")))
    return Screen(title if products else empty, kb.markup())


async def favorites_screen(ctx: BotCtx) -> Screen:
    ids = list((await ctx.session.execute(
        select(Favorite.product_id).where(Favorite.user_id == ctx.user.id).order_by(Favorite.created_at.desc()).limit(30)
    )).scalars())
    products, _ = await catalog.storefront_products(ctx.session, ids=ids, lang=ctx.lang) if ids else ([], 0)
    products.sort(key=lambda p: ids.index(p.id))
    return await product_list_screen(ctx, await ctx.t("favorites.title"), products, "fav", await ctx.t("favorites.empty"),
                                     back=Nav(to="profile"))


async def recent_screen(ctx: BotCtx) -> Screen:
    ids = list((await ctx.session.execute(
        select(ProductView.product_id).where(ProductView.user_id == ctx.user.id)
        .order_by(ProductView.viewed_at.desc()).limit(10)
    )).scalars())
    products, _ = await catalog.storefront_products(ctx.session, ids=ids, lang=ctx.lang) if ids else ([], 0)
    products.sort(key=lambda p: ids.index(p.id))
    return await product_list_screen(ctx, await ctx.t("recent.title"), products, "rec", await ctx.t("recent.empty"),
                                     back=Nav(to="profile"))


async def search_results_screen(ctx: BotCtx, query: str) -> Screen:
    products = await catalog.search_products(ctx.session, query, ctx.lang, limit=12)
    screen = await product_list_screen(
        ctx, await ctx.t("search.results", query=query), products, "s", await ctx.t("search.empty", query=query),
        back=Nav(to="catalog"),
    )
    if screen.keyboard:
        screen.keyboard.inline_keyboard.insert(
            len(screen.keyboard.inline_keyboard) - 1, [ctx.button(await ctx.b("btn.search"), cb=Nav(to="search"))]
        )
    return screen


# ─── Cart ───────────────────────────────────────────────────────────────────


async def summary_lines(ctx: BotCtx, summary: CartSummary) -> tuple[str, str]:
    items = []
    for i, line in enumerate(summary.lines, start=1):
        variant = ""
        if len([v for v in line.product.variants if v.is_active]) > 1:
            variant = f" · {i18n_get(line.variant.name, ctx.lang)}"
        items.append(await ctx.t("cart.item", index=i, emoji=emoji_of(line.product), name=i18n_get(line.product.name, ctx.lang),
                                 variant=variant, qty=line.quantity, price=ctx.money(line.unit_price),
                                 total=ctx.money(line.total)))
    parts = []
    if summary.discount or summary.balance_applied:
        parts.append(await ctx.t("cart.subtotal", amount=ctx.money(summary.subtotal)))
    if summary.discount:
        parts.append(await ctx.t("cart.discount", code=summary.promo_code or "", amount=ctx.money(summary.discount)))
    if summary.balance_applied:
        parts.append(await ctx.t("cart.balance", amount=ctx.money(summary.balance_applied)))
    parts.append(await ctx.t("cart.total", amount=ctx.money(summary.total)))
    return "\n\n".join(items), "\n".join(parts)


async def cart_screen(ctx: BotCtx, notice: str | None = None) -> Screen:
    summary = await cart_service.summarize(ctx.session, ctx.user)
    kb = Kb()
    if not summary.lines:
        text = await ctx.t("cart.empty")
        kb.row(ctx.button(await ctx.b("btn.catalog"), cb=Nav(to="catalog")))
        kb.row(*await nav_row(ctx, None))
        return Screen(text, kb.markup(), await content.banner("checkout", ctx.lang))
    items, totals = await summary_lines(ctx, summary)
    text = await ctx.t("cart.title", items=SafeHtml(items), summary=SafeHtml(totals))
    notes = []
    if summary.removed_unavailable:
        notes.append(await ctx.t("cart.item_unavailable"))
    if summary.promo_error:
        notes.append(await ctx.t("cart.promo_invalid", reason=await ctx.t(summary.promo_error)))
    if notice:
        notes.append(notice)
    if notes:
        text = "\n".join(notes) + "\n\n" + text
    for i, line in enumerate(summary.lines, start=1):
        name = i18n_get(line.product.name, ctx.lang)
        kb.row(
            ctx.button(f"{i}. {name[:22]}", cb=Prod(id=line.product.id, back="cart")),
            ctx.button("−", cb=CartAct(act="dec", item=line.item_id)),
            ctx.button(str(line.quantity), cb=Nav(to="noop")),
            ctx.button("+", cb=CartAct(act="inc", item=line.item_id)),
            ctx.button("✕", cb=CartAct(act="del", item=line.item_id)),
        )
    row = []
    if ctx.feature("promo_codes"):
        row.append(ctx.button(await ctx.b("btn.remove_promo" if summary.promo_code else "btn.promo"),
                              cb=CartAct(act="unpromo" if summary.promo_code else "promo")))
    if ctx.feature("balance") and ctx.user.balance > 0:
        cart = await cart_service.get_cart(ctx.session, ctx.user.id)
        row.append(ctx.button(await ctx.b("btn.balance_used") if cart and cart.use_balance
                              else await ctx.b("btn.use_balance", balance=ctx.money(ctx.user.balance)),
                              cb=CartAct(act="bal")))
    kb.row(*row)
    kb.row(ctx.button(await ctx.b("btn.checkout", total=ctx.money(summary.total)), cb=CartAct(act="co"), style="success"))
    kb.row(ctx.button(await ctx.b("btn.clear_cart"), cb=CartAct(act="clr")), ctx.button(await ctx.b("btn.catalog"), cb=Nav(to="catalog")))
    kb.row(*await nav_row(ctx, None))
    return Screen(await with_footer(ctx, text), kb.markup(), await content.banner("checkout", ctx.lang))


async def confirm_screen(ctx: BotCtx, question: str, yes_cb: Any, no_cb: Any) -> Screen:
    kb = Kb().row(ctx.button(await ctx.b("btn.yes"), cb=yes_cb, style="danger"), ctx.button(await ctx.b("btn.no"), cb=no_cb))
    return Screen(question, kb.markup())


# ─── Checkout & payment ─────────────────────────────────────────────────────


async def order_items_text(ctx: BotCtx, order: Order) -> str:
    lines = []
    for i, item in enumerate(order.items, start=1):
        variant = f" · {escape(item.variant_name)}" if item.variant_name else ""
        lines.append(f"{i}. <b>{escape(item.product_name)}</b>{variant}\n     {item.quantity} × {ctx.money(item.unit_price, order.currency)}")
    return "\n".join(lines)


async def order_totals_text(ctx: BotCtx, order: Order) -> str:
    parts = []
    if order.discount_total or order.balance_used:
        parts.append(await ctx.t("cart.subtotal", amount=ctx.money(order.subtotal, order.currency)))
    if order.discount_total:
        parts.append(await ctx.t("cart.discount", code=order.promo_code or "", amount=ctx.money(order.discount_total, order.currency)))
    if order.balance_used:
        parts.append(await ctx.t("cart.balance", amount=ctx.money(order.balance_used, order.currency)))
    parts.append(await ctx.t("cart.total", amount=ctx.money(order.total, order.currency)))
    return "\n".join(parts)


async def checkout_screen(ctx: BotCtx, order: Order, notice: str | None = None) -> Screen:
    from app.payments.service import available_methods, method_label

    methods = await available_methods(ctx.session, order, ctx.user)
    text = await ctx.t("checkout.choose_method", order=order.number, items=SafeHtml(await order_items_text(ctx, order)),
                       summary=SafeHtml(await order_totals_text(ctx, order)))
    if notice:
        text = notice + "\n\n" + text
    kb = Kb()
    if not methods:
        text += "\n\n" + await ctx.t("checkout.no_methods")
    for m in methods:
        fee = f" (+{m.fee_percent:g}%)" if m.fee_percent else ""
        kb.row(ctx.button(method_label(m, ctx.lang) + fee, cb=Pay(act="m", order=order.id, m=m.code),
                          custom_emoji_id=m.custom_emoji_id))
    kb.row(ctx.button(await ctx.b("btn.cancel_order"), cb=Pay(act="cnl", order=order.id)))
    kb.row(*await nav_row(ctx, None))
    return Screen(text, kb.markup(), await content.banner("checkout", ctx.lang))


def _remaining(expires_at: datetime | None) -> str:
    if not expires_at:
        return "—"
    seconds = max(0, int((expires_at - datetime.now(UTC)).total_seconds()))
    h, rem = divmod(seconds, 3600)
    m = rem // 60
    return f"{h}h {m:02d}m" if h else f"{m} min"


async def payment_screen(ctx: BotCtx, order: Order, payment: Payment, notice: str | None = None) -> Screen:
    method = (await ctx.session.execute(select(PaymentMethod).where(PaymentMethod.code == payment.method_code))).scalar_one_or_none()
    kind = (payment.extra or {}).get("kind")
    kb = Kb()
    from app.payments.service import method_label

    label = method_label(method, ctx.lang) if method else payment.method_code
    if kind == "crypto":
        decimals = 9 if payment.network == "TON" else 8 if payment.network == "LTC" else 6
        amount = format_crypto(payment.pay_amount, decimals)
        memo = await ctx.t("payment.memo", memo=payment.memo) if payment.memo else ""
        text = await ctx.t(
            "payment.crypto", order=order.number,
            network=(payment.extra or {}).get("network_display") or payment.network or "",
            amount=amount, currency=payment.pay_currency or "", address=payment.address or "",
            memo=SafeHtml(memo), expires=_remaining(payment.expires_at),
            confirmations=(payment.extra or {}).get("confirmations_required", 1),
        )
        if payment.status == PaymentStatus.AWAITING_CONFIRMATION:
            text += "\n\n" + await ctx.t("payment.detected", confirmations=payment.confirmations,
                                         required=(payment.extra or {}).get("confirmations_required", 1))
        kb.row(ctx.button(await ctx.b("btn.copy_address"), copy_text=payment.address or ""),
               ctx.button(await ctx.b("btn.copy_amount"), copy_text=amount))
        kb.row(ctx.button(await ctx.b("btn.show_qr"), cb=Pay(act="qr", order=order.id)),
               ctx.button(await ctx.b("btn.check_payment"), cb=Pay(act="chk", order=order.id), style="primary"))
    elif kind == "redirect":
        text = await ctx.t("payment.invoice", order=order.number, amount=ctx.money(payment.amount, payment.currency),
                           method=label, expires=_remaining(payment.expires_at))
        if payment.pay_url:
            kb.row(ctx.button(await ctx.b("btn.pay_open", amount=ctx.money(payment.amount, payment.currency)),
                              url=payment.pay_url, style="success"))
        kb.row(ctx.button(await ctx.b("btn.check_payment"), cb=Pay(act="chk", order=order.id)))
    elif kind == "manual":
        instructions = i18n_get((method.public_config or {}).get("instructions") if method else None, ctx.lang)
        text = await ctx.t("payment.manual", order=order.number, amount=ctx.money(payment.amount, payment.currency),
                           instructions=SafeHtml(sanitize_telegram_html(instructions)))
        if payment.status == PaymentStatus.PENDING:
            kb.row(ctx.button(await ctx.b("btn.i_paid"), cb=Pay(act="paid", order=order.id), style="success"))
        else:
            text = await ctx.t("payment.waiting_manual", order=order.number)
    elif kind == "telegram_invoice":
        stars = (payment.extra or {}).get("stars")
        text = await ctx.t("payment.stars", order=order.number, stars=stars) if stars else await ctx.t(
            "payment.invoice", order=order.number, amount=ctx.money(payment.amount, payment.currency), method=label,
            expires=_remaining(payment.expires_at))
    else:
        text = await ctx.t("payment.invoice", order=order.number, amount=ctx.money(payment.amount, payment.currency),
                           method=label, expires=_remaining(payment.expires_at))
    if notice:
        text = f"{notice}\n\n{text}"
    if order.status in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT):
        kb.row(ctx.button(await ctx.b("btn.change_method"), cb=Pay(act="chg", order=order.id)),
               ctx.button(await ctx.b("btn.cancel_order"), cb=Pay(act="cnl", order=order.id)))
    kb.row(*await nav_row(ctx, None))
    return Screen(text, kb.markup())


# ─── Orders ─────────────────────────────────────────────────────────────────


STATUS_ICON = {
    OrderStatus.PENDING: "🕓", OrderStatus.AWAITING_PAYMENT: "⏳", OrderStatus.AWAITING_CONFIRMATION: "🔎",
    OrderStatus.PAID: "✅", OrderStatus.PROCESSING: "⚙️", OrderStatus.COMPLETED: "🎉", OrderStatus.CANCELLED: "✕",
    OrderStatus.EXPIRED: "⌛", OrderStatus.FAILED: "⚠️", OrderStatus.REFUNDED: "↩️", OrderStatus.PARTIALLY_REFUNDED: "↩️",
}


async def orders_screen(ctx: BotCtx, page: int = 0, unpaid_only: bool = False) -> Screen:
    conds = [Order.user_id == ctx.user.id]
    if unpaid_only:
        conds.append(Order.status.in_(OPEN_ORDER_STATUSES))
    total = (await ctx.session.execute(select(func.count()).select_from(Order).where(*conds))).scalar_one()
    orders = (await ctx.session.execute(
        select(Order).where(*conds).order_by(Order.created_at.desc())
        .offset(page * PAGE_SIZE_ORDERS).limit(PAGE_SIZE_ORDERS)
    )).scalars().all()
    kb = Kb()
    if not orders:
        kb.row(ctx.button(await ctx.b("btn.catalog"), cb=Nav(to="catalog")))
        kb.row(*await nav_row(ctx, Nav(to="profile")))
        return Screen(await ctx.t("orders.empty"), kb.markup())
    for o in orders:
        kb.row(ctx.button(await ctx.b("orders.row", status_icon=STATUS_ICON.get(o.status, "•"), number=o.number,
                                      total=ctx.money(o.total + o.balance_used, o.currency)), cb=Ord(id=o.id, page=page)))
    pages = max(1, math.ceil(total / PAGE_SIZE_ORDERS))
    kb.row(*await pager(ctx, page, pages, lambda pg: Ord(id=0, page=pg)))
    kb.row(*await nav_row(ctx, Nav(to="profile")))
    return Screen(await ctx.t("orders.title"), kb.markup())


async def order_screen(ctx: BotCtx, order_id: int, page: int = 0) -> Screen:
    from app.fulfillment.service import delivered_units

    order = (await ctx.session.execute(
        select(Order).where(Order.id == order_id, Order.user_id == ctx.user.id)
        .options(selectinload(Order.items), selectinload(Order.payments))
    )).scalar_one_or_none()
    if order is None:
        return await orders_screen(ctx, page)
    status = await ctx.t(f"status.order.{order.status.value}")
    payment = ""
    paid = next((p for p in order.payments if p.status in (PaymentStatus.PAID, PaymentStatus.REFUNDED,
                                                           PaymentStatus.PARTIALLY_REFUNDED)), None)
    if paid:
        payment = f"\n\n💳 {escape(order.payment_method or '')}"
        if paid.tx_hash:
            payment += f"\n<code>{escape(paid.tx_hash)}</code>"
    delivery = ""
    delivered_lines = []
    for item in order.items:
        for u in delivered_units(item):
            if u.get("type") == "text":
                delivered_lines.append(f"<code>{escape(u['value'])}</code>")
    if delivered_lines:
        joined = "\n".join(delivered_lines)
        if len(joined) > 2500:
            joined = joined[:2500] + "…"
        delivery = "\n\n📦 " + joined
    text = await ctx.t("order.detail", order=order.number, status=status,
                       date=order.created_at.strftime("%Y-%m-%d %H:%M UTC"),
                       items=SafeHtml(await order_items_text(ctx, order)),
                       summary=SafeHtml(await order_totals_text(ctx, order)), payment=SafeHtml(payment),
                       delivery=SafeHtml(delivery))
    kb = Kb()
    if order.status in (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT, OrderStatus.AWAITING_CONFIRMATION):
        active = next((p for p in reversed(order.payments) if p.status in (PaymentStatus.PENDING,
                                                                          PaymentStatus.AWAITING_CONFIRMATION)), None)
        kb.row(ctx.button("💳 " + (await ctx.b("btn.check_payment") if active else await ctx.b("btn.checkout", total=ctx.money(order.total, order.currency))),
                          cb=Pay(act="chk" if active else "chg", order=order.id), style="success"))
        if order.status != OrderStatus.AWAITING_CONFIRMATION:
            kb.row(ctx.button(await ctx.b("btn.cancel_order"), cb=Pay(act="cnl", order=order.id)))
    if order.status == OrderStatus.COMPLETED:
        row = []
        if ctx.feature("reviews") and order.items and order.items[0].product_id:
            row.append(ctx.button(await ctx.b("btn.leave_review"), cb=Rev(order=order.id, product=order.items[0].product_id)))
        first = order.items[0] if order.items else None
        if first and first.product_id:
            row.append(ctx.button(await ctx.b("btn.reorder"), cb=Prod(id=first.product_id)))
        kb.row(*row)
    if ctx.feature("support"):
        kb.row(ctx.button(await ctx.b("btn.order_support"), cb=Sup(act="ord", id=order.id)))
    kb.row(*await nav_row(ctx, Ord(id=0, page=page)))
    media = await content.banner("success", ctx.lang) if order.status == OrderStatus.COMPLETED else None
    return Screen(cleanup_whitespace(text), kb.markup(), media)


# ─── Profile / referrals / language ─────────────────────────────────────────


async def profile_screen(ctx: BotCtx) -> Screen:
    u = ctx.user
    balance = await ctx.t("profile.balance", balance=ctx.money(u.balance)) if ctx.feature("balance") else ""
    text = await ctx.t("profile.text", name=u.display_name, telegram_id=u.telegram_id,
                       joined=u.created_at.strftime("%Y-%m-%d"), orders=u.paid_orders_count,
                       spent=ctx.money(u.total_spent), balance=SafeHtml(balance))
    kb = await menu_keyboard(ctx, "profile")
    if not kb.rows:
        kb.row(ctx.button(await ctx.b("btn.orders"), cb=Nav(to="orders")))
        row = []
        if ctx.feature("favorites"):
            row.append(ctx.button(await ctx.b("btn.favorites"), cb=Nav(to="fav")))
        if ctx.feature("recently_viewed"):
            row.append(ctx.button(await ctx.b("btn.recent"), cb=Nav(to="recent")))
        kb.row(*row)
        row = []
        if ctx.feature("referrals"):
            row.append(ctx.button(await ctx.b("btn.referrals"), cb=Nav(to="ref")))
        row.append(ctx.button(await ctx.b("btn.language"), cb=Nav(to="lang")))
        kb.row(*row)
    kb.row(*await nav_row(ctx, None))
    return Screen(await with_footer(ctx, text), kb.markup(), await content.banner("profile", ctx.lang))


async def referrals_screen(ctx: BotCtx) -> Screen:
    cfg = ctx.cfg["referrals"]
    me = await ctx.bot.me()
    link = f"https://t.me/{me.username}?start=ref_{ctx.user.referral_code}"
    reward = f"{cfg.get('reward_percent', 0)}%" if cfg.get("reward_type") != "fixed" else ctx.money(cfg.get("reward_amount", 0))
    invited, converted, earned = (await ctx.session.execute(
        select(func.count(Referral.id), func.count(Referral.converted_at), func.coalesce(func.sum(Referral.reward_total), 0))
        .where(Referral.referrer_id == ctx.user.id)
    )).one()
    text = await ctx.t("referrals.text", reward=reward,
                       first_only=await ctx.t("referrals.first_only") if cfg.get("first_order_only") else "",
                       link=link, invited=invited, converted=converted, earned=ctx.money(earned))
    from urllib.parse import quote

    share_text = await ctx.b("referrals.share_text", store_name=ctx.cfg["general"]["store_name"])
    share_url = f"https://t.me/share/url?url={quote(link)}&text={quote(share_text)}"
    kb = Kb().row(ctx.button(await ctx.b("btn.share_referral"), url=share_url))
    kb.row(*await nav_row(ctx, Nav(to="profile")))
    return Screen(text, kb.markup(), await content.banner("promotions", ctx.lang))


async def language_screen(ctx: BotCtx) -> Screen:
    from app.services.texts import text_store

    langs = await text_store.languages()
    kb = Kb()
    kb.grid([ctx.button(f"{'● ' if lang['code'] == ctx.lang else ''}{lang['flag']} {lang['native_name']}",
                        cb=Lang(code=lang["code"])) for lang in langs], 2)
    kb.row(*await nav_row(ctx, Nav(to="profile")))
    return Screen(await ctx.t("language.title"), kb.markup())


# ─── Support / FAQ / pages ──────────────────────────────────────────────────


async def support_screen(ctx: BotCtx) -> Screen:
    kb = Kb()
    kb.row(ctx.button(await ctx.b("btn.new_ticket"), cb=Sup(act="new"), style="primary"))
    kb.row(ctx.button(await ctx.b("btn.my_tickets"), cb=Sup(act="list")))
    support_username = (ctx.cfg["general"].get("support_username") or "").lstrip("@")
    support_url = ctx.cfg["general"].get("support_url")
    if support_username or support_url:
        kb.row(ctx.button(await ctx.b("btn.contact_manager"), url=support_url or f"https://t.me/{support_username}"))
    if await content.faq_items():
        kb.row(ctx.button(await ctx.b("btn.faq"), cb=Faq(id=0)))
    kb.row(*await nav_row(ctx, None))
    return Screen(await with_footer(ctx, await ctx.t("support.text")), kb.markup(), await content.banner("support", ctx.lang))


async def tickets_screen(ctx: BotCtx, page: int = 0) -> Screen:
    tickets = (await ctx.session.execute(
        select(Ticket).where(Ticket.user_id == ctx.user.id).order_by(Ticket.updated_at.desc()).offset(page * 8).limit(8)
    )).scalars().all()
    kb = Kb()
    for tk in tickets:
        icon = "🟢" if tk.status not in (TicketStatus.CLOSED, TicketStatus.RESOLVED) else "⚫"
        kb.row(ctx.button(f"{icon} {tk.number} · {tk.subject[:30]}", cb=Sup(act="view", id=tk.id)))
    kb.row(*await nav_row(ctx, Sup(act="home")))
    text = await ctx.t("support.tickets_title") if tickets else await ctx.t("support.tickets_empty")
    return Screen(text, kb.markup())


async def ticket_screen(ctx: BotCtx, ticket_id: int) -> Screen:
    tk = (await ctx.session.execute(select(Ticket).where(Ticket.id == ticket_id, Ticket.user_id == ctx.user.id))).scalar_one_or_none()
    if tk is None:
        return await tickets_screen(ctx)
    msgs = (await ctx.session.execute(
        select(TicketMessage).where(TicketMessage.ticket_id == tk.id).order_by(TicketMessage.created_at.desc()).limit(6)
    )).scalars().all()
    parts = []
    for m in reversed(msgs):
        who = "🧑" if m.sender == "customer" else "💬"
        body = escape(m.body[:400]) if m.body else "📎"
        parts.append(f"{who} <i>{m.created_at.strftime('%d.%m %H:%M')}</i>\n{body}")
    text = await ctx.t("support.ticket_view", ticket=tk.number, subject=tk.subject,
                       status=await ctx.t(f"status.ticket.{tk.status.value}"), messages=SafeHtml("\n\n".join(parts)))
    kb = Kb()
    if tk.status != TicketStatus.CLOSED:
        kb.row(ctx.button(await ctx.b("btn.reply"), cb=Sup(act="reply", id=tk.id), style="primary"),
               ctx.button(await ctx.b("btn.close_ticket"), cb=Sup(act="close", id=tk.id)))
    kb.row(*await nav_row(ctx, Sup(act="list")))
    return Screen(text, kb.markup())


async def faq_screen(ctx: BotCtx, item_id: int = 0) -> Screen:
    items = await content.faq_items()
    kb = Kb()
    if item_id:
        item = next((i for i in items if i["id"] == item_id), None)
        if item:
            text = f"{item['emoji'] or '❓'} <b>{escape(i18n_get(item['q'], ctx.lang))}</b>\n\n" + sanitize_telegram_html(
                i18n_get(item["a"], ctx.lang))
            kb.row(*await nav_row(ctx, Faq(id=0)))
            return Screen(text, kb.markup())
    for item in items:
        kb.row(ctx.button(i18n_get(item["q"], ctx.lang)[:60], cb=Faq(id=item["id"]), emoji=item["emoji"]))
    if ctx.feature("support"):
        kb.row(ctx.button(await ctx.b("btn.support"), cb=Sup(act="home")))
    kb.row(*await nav_row(ctx, None))
    text = await ctx.t("faq.title") if items else await ctx.t("faq.empty")
    return Screen(text, kb.markup(), await content.banner("support", ctx.lang))


async def page_screen(ctx: BotCtx, slug: str) -> Screen:
    pages = await content.pages()
    page = pages.get(slug)
    if page is None:
        return await home_screen(ctx)
    title = i18n_get(page["title"], ctx.lang)
    body = sanitize_telegram_html(i18n_get(page["content"], ctx.lang))
    text = f"{(page['emoji'] + ' ') if page['emoji'] else ''}<b>{escape(title)}</b>\n\n{body}"
    kb = Kb()
    for b in page["buttons"]:
        label = i18n_get(b.get("label"), ctx.lang)
        if not label:
            continue
        action, value = b.get("action"), b.get("value") or ""
        if action == "url" and value:
            kb.row(ctx.button(label, url=value, emoji=b.get("emoji")))
        elif action == "page" and value:
            kb.row(ctx.button(label, cb=Pg(slug=value[:40]), emoji=b.get("emoji")))
        elif action == "category" and value.isdigit():
            kb.row(ctx.button(label, cb=Cat(id=int(value)), emoji=b.get("emoji")))
        elif action == "product" and value.isdigit():
            kb.row(ctx.button(label, cb=Prod(id=int(value)), emoji=b.get("emoji")))
    kb.row(*await nav_row(ctx, None))
    return Screen(await with_footer(ctx, text), kb.markup(), await content.get_media(page["media_id"]))


async def restock_users_for(session: Any, product_id: int) -> list[int]:
    return list((await session.execute(select(RestockSubscription.user_id).where(RestockSubscription.product_id == product_id))).scalars())


__all__ = ["Decimal", "ProductVariant"]
