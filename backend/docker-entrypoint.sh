#!/bin/sh
set -e

wait_for_db() {
  python - <<'PY'
import asyncio, sys, time
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from app.core.config import settings
async def main():
    for i in range(60):
        try:
            e = create_async_engine(settings.database_url)
            async with e.connect() as c:
                await c.execute(text("SELECT 1"))
            await e.dispose()
            return
        except Exception as exc:
            print(f"waiting for database… ({exc.__class__.__name__})", flush=True)
            time.sleep(2)
    sys.exit("database not reachable")
asyncio.run(main())
PY
}

case "$1" in
  api)
    wait_for_db
    alembic upgrade head
    python -m app.cli seed
    if [ "${BOT_MODE:-polling}" = "webhook" ] && [ -n "${BOT_TOKEN:-}" ]; then
      python -m app.cli set-webhook || echo "warning: could not register the Telegram webhook (retry: docker compose exec api python -m app.cli set-webhook)"
    fi
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers "${API_WORKERS:-2}" --no-proxy-headers --no-server-header
    ;;
  worker)
    wait_for_db
    exec arq app.workers.main.WorkerSettings
    ;;
  bot)
    wait_for_db
    exec python -m app.bot
    ;;
  migrate)
    wait_for_db
    exec alembic upgrade head
    ;;
  *)
    exec "$@"
    ;;
esac
