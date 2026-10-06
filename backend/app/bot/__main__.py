"""Run the bot in long-polling mode (development): `python -m app.bot`."""

from __future__ import annotations

import asyncio

from app.bot.factory import ALLOWED_UPDATES, build_dispatcher, set_commands
from app.bot.instance import close_bot, get_bot
from app.core.logging import get_logger, setup_logging


async def main() -> None:
    setup_logging()
    log = get_logger("bot")
    bot = get_bot()
    dp = build_dispatcher()
    await bot.delete_webhook(drop_pending_updates=False)
    me = await bot.get_me()
    log.info("bot_polling_started", username=me.username)
    await set_commands(bot)
    try:
        await dp.start_polling(bot, allowed_updates=ALLOWED_UPDATES, handle_signals=True)
    finally:
        await close_bot()


if __name__ == "__main__":
    asyncio.run(main())
