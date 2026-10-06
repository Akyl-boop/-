"""Compact callback-data factories (Telegram limits callback data to 64 bytes)."""

from __future__ import annotations

from aiogram.filters.callback_data import CallbackData


class Nav(CallbackData, prefix="n"):
    to: str
    page: int = 0


class Cat(CallbackData, prefix="c"):
    id: int
    page: int = 0


class Prod(CallbackData, prefix="p"):
    id: int
    sel: str = ""  # selected option value indexes, e.g. "1.0"
    qty: int = 1
    back: str = ""  # navigation context to return to: "c12.0" | "fav" | "rec" | "s" | ""


class ProdAct(CallbackData, prefix="pa"):
    act: str  # add | buy | fav | rst | rev
    pid: int
    vid: int = 0
    qty: int = 1


class CartAct(CallbackData, prefix="ct"):
    act: str  # inc | dec | del | clr | clr_ok | promo | unpromo | bal | co
    item: int = 0


class Ord(CallbackData, prefix="o"):
    id: int = 0
    page: int = 0


class Pay(CallbackData, prefix="py"):
    act: str  # m (choose method) | chk | paid | cnl | cnl_ok | qr | chg
    order: int
    m: str = ""


class Sup(CallbackData, prefix="s"):
    act: str  # home | new | list | view | reply | close | ord
    id: int = 0
    page: int = 0


class Faq(CallbackData, prefix="f"):
    id: int = 0


class Pg(CallbackData, prefix="pg"):
    slug: str


class Lang(CallbackData, prefix="l"):
    code: str


class Rev(CallbackData, prefix="rv"):
    order: int
    product: int
    rating: int = 0


class MenuBtn(CallbackData, prefix="mb"):
    id: int
