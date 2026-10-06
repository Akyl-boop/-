# Nexa Commerce

A self-hosted Telegram store for digital goods: a bot storefront, an admin dashboard, crypto and card payments, and automatic delivery.

- **Bot** (aiogram 3): catalog, product cards with banners, cart, promo codes, checkout, automatic delivery, order history, balance, referrals, support tickets, reviews, FAQ and multilingual UI.
- **Dashboard** (Next.js, TypeScript, Tailwind): orders, products, inventory, customers/CRM, payments, marketing, broadcasts, a bot editor with live Telegram preview, analytics, RBAC, audit log, system health and more.
- **API** (FastAPI): an async REST API with cookie sessions, CSRF protection, rate limiting, 2FA, Telegram sign-in approval, and idempotent payment webhooks.
- **Workers** (arq on Redis): fulfillment, payment polling, order expiry, broadcasts, notifications, outgoing webhooks, low-stock and restock alerts, and automatic backups.

---

## Contents

1. [Architecture](#architecture)
2. [Quick start with Docker](#quick-start-with-docker)
3. [Local development](#local-development)
4. [Environment variables](#environment-variables)
5. [Database & Redis](#database--redis)
6. [Telegram bot setup](#telegram-bot-setup)
7. [Polling vs webhook mode](#polling-vs-webhook-mode)
8. [Payment providers](#payment-providers)
9. [Fulfillment](#fulfillment)
10. [Administrators, roles & sign-in](#administrators-roles--sign-in)
11. [Bot editor, texts & languages](#bot-editor-texts--languages)
12. [Deploying on an Ubuntu VPS](#deploying-on-an-ubuntu-vps)
13. [Backups & restore](#backups--restore)
14. [Updating](#updating)
15. [Tests](#tests)
16. [Security notes](#security-notes)
17. [Troubleshooting](#troubleshooting)

---

## Architecture

```
                 ┌──────────────── Caddy (HTTPS, :443) ────────────────┐
 Telegram ──────►│ /telegram/webhook ─┐                                │
 Payment PSPs ──►│ /api/webhooks/*  ──┼──►  api (FastAPI, uvicorn)      │
 Admins ────────►│ /api/*           ──┘        │   ▲                   │
                 │ /*  ───────────────────►  frontend (Next.js)        │
                 └─────────────────────────────┼───┼───────────────────┘
                                               ▼   │ SSE (Redis pub/sub)
                         PostgreSQL ◄──── worker (arq) ────► Redis
                                               │            (queue, locks,
                                               ▼             cache, rate limits)
                                    Telegram Bot API / blockchain APIs / SMTP
```

| Service    | Role |
|------------|------|
| `api`      | REST API for the dashboard, payment webhooks, Telegram webhook (webhook mode), SSE stream. Runs migrations and core seed on start. |
| `worker`   | Background jobs and cron: fulfillment, payment polling, expiring unpaid orders, retrying stuck deliveries, scheduled broadcasts, provider health checks, backups, cleanup. |
| `bot`      | Long-polling bot. Only used in **polling mode** (compose profile `polling`). |
| `frontend` | Next.js dashboard (standalone server). |
| `caddy`    | Reverse proxy with automatic Let's Encrypt certificates. |
| `postgres` | Primary data store (Alembic migrations). |
| `redis`    | Job queue, distributed locks, caches, rate limiting, realtime events. |

### Repository layout

```
backend/
  app/
    core/           config, logging, DB session/unit-of-work, Redis, crypto, events, queue
    models/         SQLAlchemy models
    services/       business logic (catalog, cart, promo, orders, inventory, CRM, auth…)
    payments/       PaymentProvider interface, registry, providers, rates, service
    fulfillment/    delivery handlers (inventory, text, file, manual, API, webhook)
    bot/            aiogram bot: render engine, screens, handlers, middlewares
    api/            FastAPI routers + dependencies (auth, RBAC, pagination)
    workers/        arq jobs and cron schedule
    localization/   built-in EN / RU / ZH text catalog
    cli.py          management CLI
  alembic/          migrations
  tests/            pytest suite
frontend/
  src/app/          App Router pages: (auth) and (app) groups
  src/components/   UI kit, app shell, charts, Telegram preview, editors
  src/lib/          API client, types, session, theme
deploy/Caddyfile
docker-compose.yml
.env.example
```

### Key design decisions

- **Exactly-once payments.** Each incoming webhook is stored under `UNIQUE(provider, event_id)` with `ON CONFLICT DO NOTHING`. Confirming a payment locks the payment row (`SELECT … FOR UPDATE`), and a payment that is already paid is a no-op. On-chain transaction hashes are unique per network, so one transaction can never pay two orders. Fulfillment jobs use deterministic job IDs plus a Redis lock.
- **No overselling.** Inventory items are reserved with `FOR UPDATE SKIP LOCKED` when an order is created. Unpaid orders expire and release their stock.
- **Side effects after commit.** Telegram messages, queued jobs, realtime events and cache invalidation run only after the database transaction commits (`on_commit` hooks), so a rollback never leaks a notification.
- **Database-driven content.** Bot texts, buttons, menus, banners, pages, languages, payment methods, feature flags and settings live in PostgreSQL. A Redis version counter invalidates every process's cache within about one second of a save.
- **Secrets stay server-side.** Payment provider credentials and integration API keys are encrypted with Fernet (`ENCRYPTION_KEY`) at rest. The API never returns them; the dashboard only shows "configured / not configured".

---

## Quick start with Docker

Requirements: Docker Engine 24+ with the Compose plugin, a domain whose DNS A/AAAA record points to the server, and open ports 80 and 443.

```bash
git clone <your-repo-url> nexa && cd nexa
cp .env.example .env

# Generate secrets and paste them into .env
docker compose run --rm --no-deps api python -m app.cli gen-keys

# Edit .env: DOMAIN, PUBLIC_URL, CORS_ORIGINS, BOT_TOKEN, POSTGRES_PASSWORD, ACME_EMAIL…
nano .env

docker compose up -d --build
docker compose exec api python -m app.cli create-admin      # first owner account
docker compose exec api python -m app.cli seed --demo        # optional demo data
```

Open `https://<DOMAIN>` and sign in. When `BOT_MODE=webhook`, the API registers the Telegram webhook on startup.

> `gen-keys` needs no database. If the compose file refuses to start because `POSTGRES_PASSWORD` or `DOMAIN` is unset, fill in those two values first.

---

## Local development

Requirements: Python 3.12+, Node 20+, PostgreSQL 14+ and Redis 6+.

```bash
# Postgres & Redis (or use your local installations)
docker run -d --name nexa-pg -e POSTGRES_USER=shop -e POSTGRES_PASSWORD=shop -e POSTGRES_DB=shop -p 5432:5432 postgres:16-alpine
docker run -d --name nexa-redis -p 6379:6379 redis:7-alpine

# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env              # set BOT_TOKEN to a test bot from @BotFather
alembic upgrade head
python -m app.cli seed --demo
python -m app.cli create-admin --email admin@example.com --name Admin --role owner

uvicorn app.main:app --reload --port 8000                # API
arq app.workers.main.WorkerSettings                      # worker (2nd terminal)
python -m app.bot                                        # bot, polling (3rd terminal)

# Frontend
cd ../frontend
npm install
npm run dev                       # http://localhost:3000  (proxies /api → :8000)
```

In development, `BACKEND_URL` (default `http://localhost:8000`) controls where the Next.js dev server proxies `/api`.

---

## Environment variables

Only infrastructure and secrets live in the environment. Everything else is configured in the dashboard.

| Variable | Default | Description |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` enables strict config validation and secure defaults. |
| `PUBLIC_URL` | `http://localhost:3000` | Public dashboard URL (password-reset links, webhook URLs). |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins. |
| `SECRET_KEY` | dev value | **Required in production.** At least 32 random characters, used for signing and hashing tokens. |
| `ENCRYPTION_KEY` | — | **Required in production.** Fernet key that encrypts provider credentials at rest. **Keep it safe:** if you lose it, you must re-enter your stored credentials. |
| `COOKIE_SECURE` | `false` | Must be `true` behind HTTPS. |
| `SESSION_TTL_HOURS` | `168` | Dashboard session lifetime. |
| `TRUSTED_PROXIES` | `127.0.0.1,172.16.0.0/12,10.0.0.0/8` | Proxies whose `X-Forwarded-For` header is trusted. |
| `API_RATE_LIMIT_PER_MINUTE` | `300` | Per-IP general API limit. Stricter limits apply to sign-in and sensitive endpoints. |
| `DATABASE_URL` | local | `postgresql+asyncpg://user:pass@host:5432/db`. In Docker it is built from `POSTGRES_*`. |
| `REDIS_URL` | `redis://localhost:6379/0` | Redis connection. |
| `BOT_TOKEN` | — | Token from @BotFather. |
| `BOT_MODE` | `polling` | `webhook` (production) or `polling`. |
| `TELEGRAM_WEBHOOK_URL` | — | e.g. `https://shop.example.com/telegram/webhook`. |
| `TELEGRAM_WEBHOOK_SECRET` | — | Random secret Telegram sends in `X-Telegram-Bot-Api-Secret-Token`. Required in webhook mode. |
| `PAYMENT_WEBHOOK_BASE_URL` | `PUBLIC_URL` | Base URL that payment providers call back. |
| `MEDIA_ROOT` / `BACKUP_DIR` | `./storage/…` | File storage locations. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_STARTTLS` | — | Optional e-mail for password resets and e-mail notifications. |
| `LOG_LEVEL`, `LOG_JSON` | `INFO`, `true` | Structured logging. Secrets are redacted automatically. |
| `API_WORKERS` | `2` | Uvicorn worker processes (Docker). |
| `DOMAIN`, `ACME_EMAIL` | — | Caddy (Docker). |

In production the API logs every missing or insecure required value on startup.

---

## Database & Redis

- **Migrations:** `alembic upgrade head` (the Docker `api` service runs this automatically). To create a migration after changing models, run `alembic revision --autogenerate -m "message"`.
- **Core seed:** `python -m app.cli seed` is idempotent. It creates roles and permissions, languages (EN/RU/ZH), default settings, the main menu and the default payment methods (disabled until configured).
- **Demo data:** `python -m app.cli seed --demo` adds a sample catalog, inventory, customers and orders tagged `DEMO`. It contains no real credentials. Don't run it on a live store.
- **Redis:** use `appendonly yes` and `maxmemory-policy noeviction`, which the compose file already sets. Queued jobs and locks must not be evicted.

---

## Telegram bot setup

1. Create a bot with [@BotFather](https://t.me/BotFather) (`/newbot`) and put the token in `BOT_TOKEN`.
2. Optional: in BotFather, set a description, about text and profile picture. The bot sets its own localized command list (`/start`, `/catalog`, `/cart`, `/orders`, `/support`) on startup.
3. Optional, for **Telegram Stars** or **card payments**: open BotFather → *Payments* and connect a provider to get a provider token. See [Payment providers](#payment-providers).
4. Optional, for **custom emoji** in messages and on buttons: Telegram restricts them to bots with a purchased Fragment username or, for messages the bot sends directly to private and group chats, bots **owned by an account with Telegram Premium** (the account that created the bot in BotFather). These rules change, so use the test below instead of assuming. Once your bot qualifies, turn on the two switches in *Bot Editor → Appearance*. Until then they stay off, and the bot sends the standard fallback emoji. The dashboard explains this instead of pretending custom emoji work.

   **Test it and get IDs:** link your Telegram account (below), then send the bot a message containing an animated emoji (or a custom-emoji sticker; `/emojiid` shows the instructions). The bot replies with the emoji IDs, then sends a test message and checks whether Telegram kept the custom emoji. It tells you plainly whether the bot is allowed to send them. This works only for linked, active admins. Paste the ID into the dashboard's emoji picker.

### Linking your Telegram account (admins)

Go to **Profile → Telegram**, click *Link Telegram* and send the displayed `/link <code>` to the bot. Once linked you can:

- receive admin notifications (new orders, payments, low stock, tickets…) in Telegram;
- sign in to the dashboard with **Telegram approval**: choose *Sign in with Telegram* and tap **Approve** in the bot.

---

## Polling vs webhook mode

| | Polling (`BOT_MODE=polling`) | Webhook (`BOT_MODE=webhook`) |
|---|---|---|
| Needs public HTTPS | No | Yes |
| Process | separate `bot` service: `python -m app.bot` | handled inside `api` at `/telegram/webhook` |
| Best for | local development, servers without a domain | production |

**Webhook:**

```bash
BOT_MODE=webhook
TELEGRAM_WEBHOOK_URL=https://shop.example.com/telegram/webhook
TELEGRAM_WEBHOOK_SECRET=<from gen-keys>
docker compose up -d
docker compose exec api python -m app.cli set-webhook       # (also done automatically on start)
```

**Polling with Docker:**

```bash
BOT_MODE=polling
docker compose --profile polling up -d     # starts the extra "bot" service
```

To switch from webhook to polling, run `python -m app.cli delete-webhook`. The polling bot also removes the webhook itself on start.

---

## Payment providers

Configure providers in **Dashboard → Payments → Methods**. Every method has a display name, an icon, min/max amount, fee, sort order, availability per language and an enabled toggle. Secret fields are encrypted and write-only: the dashboard never displays them again.

Every provider implements the same `PaymentProvider` interface (`backend/app/payments/base.py`): `create_payment`, `check_payment`, `handle_webhook` and `health_check`. To add a gateway, write a class and register it in `payments/registry.py`. Checkout, idempotency, expiry and fulfillment need no changes.

### CryptoBot (@CryptoBot / Crypto Pay)

1. In [@CryptoBot](https://t.me/CryptoBot), go to *Crypto Pay → Create App* and copy the API token. For testing, use [@CryptoTestnetBot](https://t.me/CryptoTestnetBot) and enable *testnet*.
2. Paste the token in the dashboard and choose the accepted assets (USDT, TON, BTC, LTC, ETH…).
3. In the Crypto Pay app settings, enable **Webhooks** and set the URL to:
   `https://<DOMAIN>/api/webhooks/payments/cryptobot`
4. Webhooks are verified with HMAC-SHA256 of the body, keyed by SHA256(api_token), and deduplicated by `update_id`. The worker also polls open invoices, so a missed webhook doesn't lose a payment.

### Direct crypto (USDT TRC20 / USDT BEP20 / LTC / TON)

Payments go straight to your own wallet, with automatic on-chain detection by the worker (`poll_payments`, every 20 s).

- **Shared wallet + unique amount** (default): each payment gets a unique amount, such as `25.000317 USDT`, reserved in Redis for the payment window.
- **Address pool**: add addresses in *Payments → Address pool*. Each payment gets its own address until it is paid or expires.
- **TON**: matched by a comment (memo), which the bot shows with a copy button.

A transaction is accepted only when **all** of these match: the receiving address, the token contract (USDT), the amount, the payment time window, the required confirmations, and a transaction hash that has never been used before. In unique-amount mode the amount must match **exactly**, because the amount identifies the payment. In pool and memo modes it must be **at least** the expected amount. Underpayments are never accepted, and the order stays unpaid until it expires. Transactions with too few confirmations show as *awaiting confirmation*.

Blockchain APIs used (keys go under **Integrations → API keys** and are stored encrypted):

| Network | API | Key |
|---|---|---|
| TRC20 | TronGrid | `trongrid_api_key` (recommended, raises rate limits) |
| BEP20 | Etherscan V2 (BSC) | `etherscan_api_key` (**required**) |
| LTC | BlockCypher | `blockcypher_token` (optional) |
| TON | Toncenter | `toncenter_api_key` (recommended) |
| FX rates | CoinGecko | `coingecko_api_key` (optional) |

### Telegram Stars

No token is needed. Set the price of one Star in your store currency. Payments are confirmed through Telegram's `successful_payment` update, and refunds use `refundStarPayment`.

### Bank cards (Telegram Payments)

Get a provider token from BotFather → *Payments* (Stripe, YooKassa, etc.) and set the charge currency and exchange rate. Telegram shows the native card form, so card data never reaches your server.

### Manual

Free-form instructions per language, such as bank transfer details. The customer taps "I've paid", and an admin approves the payment from the order page.

### Balance

Customers pay from their internal balance, which is funded by referral rewards or admin adjustments. The deduction is atomic with the order.

---

## Fulfillment

Each product (or variant) has a delivery type:

| Type | What happens after payment |
|---|---|
| **Inventory** | Unique items (keys, accounts, codes) reserved at checkout are delivered. Import them via CSV or paste; duplicates are rejected. |
| **Text** | A fixed text per language, optionally stored encrypted (license keys, instructions, links). |
| **File** | A file from the media library is sent as a document. |
| **Manual** | The order waits in *Orders → Awaiting delivery*, and an admin types the delivery. |
| **API** | A signed POST (`X-Nexa-Signature`, HMAC-SHA256) to your endpoint, which responds synchronously with `{"items": ["code", …]}`. Those items are delivered. |
| **Webhook** | A signed POST to your endpoint with a `callback_url`. Your system delivers later by calling `POST /api/integrations/fulfillment/{order_item_id}` (same signature scheme). |

Fulfillment is idempotent. If a paid order's job is lost, a worker safety net re-runs it every 2 minutes. A delivery that fails (an API error, or an empty inventory for a manual-stock product) marks the order *delivery failed* and notifies admins. From the order page an admin can choose **Retry automatic delivery** or **Deliver manually**.

---

## Administrators, roles & sign-in

```bash
python -m app.cli create-admin --email you@example.com --name "Your Name" --role owner
# (Docker) docker compose exec api python -m app.cli create-admin
```

Running the same command for an existing e-mail resets that account's password.

- **Roles:** Owner, Administrator, Manager, Support, Content Manager and Analyst. You can also create custom roles from 36 granular permissions (*Administrators → Roles*). Permissions are enforced by the API; the dashboard only hides what you can't use.
- **Passwords** are hashed with Argon2id. Accounts lock temporarily after repeated failures.
- **2FA:** TOTP (any authenticator app) plus one-time recovery codes. Set it up in *Profile → Security*. Owners can require it for every non-owner admin in *Settings → Security*.
- **Sessions:** HTTP-only, SameSite cookies, stored hashed. View and revoke them in *Profile → Sessions*.
- **CSRF:** double-submit token on every state-changing request.
- **Audit log:** every admin action, with before/after diff, IP and user agent.

---

## Bot editor, texts & languages

- **Bot Editor → Texts:** every message and button in every language, with formatting, `{placeholders}`, an emoji picker (standard and custom emoji) and a live Telegram-style preview. You can reset any text to its default.
- **Menu builder:** drag-and-drop main menu. Buttons can open a screen, a category, a product, a page or a URL. Each button can have a color style (primary, success, danger) and a custom emoji icon.
- **Banners:** an image, GIF or video per placement (home, catalog, category, product, cart, checkout, profile…) and per language, with a fallback.
- **Pages:** FAQ, Terms, Privacy and custom pages, available from the menu.
- **Languages:** add any language, set the default, and see translation completeness. Missing keys fall back to the default language. Products, categories and banners are translatable too.

Changes apply to the running bot within about one second. No restart is needed.

---

## Deploying on an Ubuntu VPS

Tested on Ubuntu 22.04 and 24.04. Recommended minimum: 2 vCPU, 2 GB RAM and 20 GB disk.

```bash
# 1. System
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git ufw
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw allow 443/udp && sudo ufw enable

# 2. Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 3. DNS: create an A record  shop.example.com → <server IP>  (and AAAA for IPv6)

# 4. App
git clone <your-repo-url> /opt/nexa && cd /opt/nexa
cp .env.example .env && nano .env
docker compose run --rm --no-deps api python -m app.cli gen-keys   # paste into .env
docker compose up -d --build
docker compose exec api python -m app.cli create-admin
docker compose ps && docker compose logs -f api
```

**HTTPS:** Caddy gets and renews Let's Encrypt certificates for `DOMAIN` automatically. Port 80 must be reachable for the ACME challenge.

**Using your own reverse proxy (nginx or Traefik)** instead of Caddy: remove the `caddy` service, publish `api:8000` and `frontend:3000` on localhost, and route as follows.

```nginx
location /api/        { proxy_pass http://127.0.0.1:8000; proxy_buffering off; proxy_read_timeout 1h;
                        proxy_set_header Host $host; proxy_set_header X-Forwarded-For $remote_addr; }
location /telegram/   { proxy_pass http://127.0.0.1:8000; proxy_set_header X-Forwarded-For $remote_addr; }
location /healthz     { proxy_pass http://127.0.0.1:8000; }
location /            { proxy_pass http://127.0.0.1:3000; proxy_set_header Host $host; }
client_max_body_size 60m;
```

`proxy_buffering off` is required for the realtime SSE stream (`/api/events`).

**Monitoring:** use `GET /healthz` for an uptime monitor. *Dashboard → System* shows database and Redis latency, the worker heartbeat and queue length, the bot and webhook status (pending updates, last error) and payment provider health. Infrastructure details are visible only to admins with the `system.view` permission.

---

## Backups & restore

- **Automatic:** enable it in *Settings → Backups* (interval and retention). The worker runs `pg_dump` into the `backups` volume.
- **Manual:** *Dashboard → System → Back up now*, or:

```bash
docker compose exec api python -m app.cli backup
docker compose exec api python -m app.cli prune-backups --days 14
docker compose cp api:/app/storage/backups ./backups-copy        # copy off the server
```

- **Restore** (destructive, replaces the current data):

```bash
docker compose stop worker bot
docker compose exec api python -m app.cli restore /app/storage/backups/nexa-YYYYMMDD-HHMMSS.dump
docker compose start worker
```

Also back up the `media` volume and **your `.env`**, especially `ENCRYPTION_KEY`. Keep copies off the server.

---

## Updating

```bash
cd /opt/nexa
git pull
docker compose up -d --build      # api applies new migrations on start
docker image prune -f
```

---

## Tests

```bash
cd backend
createdb shop_test                 # tests use database shop_test and Redis DB 15
pytest -q
ruff check .

cd ../frontend
npx tsc --noEmit && npm run build
```

The suite covers password hashing, TOTP, encryption and HTML sanitizing; promo code rules; order creation, inventory reservation and concurrent purchase races; payment confirmation idempotency; webhook signature checks and duplicate delivery; the API (auth, CSRF, RBAC, lockout); and a complete bot purchase flow driven through the real aiogram dispatcher.

---

## Security notes

- Never commit `.env`. `.env.example` contains placeholders only.
- Provider tokens and API keys are encrypted at rest. They are never returned by the API and never logged (a structlog processor redacts secret-looking fields).
- Customers never see stack traces. API errors return `{"error": {"code", "message"}}`, and unexpected errors also include a `request_id` that matches the logs. Bot users see a friendly message.
- Telegram webhook requests must carry the secret token header. Payment webhooks are signature-verified per provider and deduplicated.
- Customer-editable and admin-editable text sent to Telegram is sanitized to Telegram's HTML subset.
- Rate limiting applies per IP for the API and stricter limits apply to auth endpoints. The bot rate-limits per user.
- Security headers (HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) are set by Caddy, the API and Next.js.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot doesn't respond (webhook mode) | `docker compose exec api python -m app.cli set-webhook`, then check `docker compose logs api`. Make sure `TELEGRAM_WEBHOOK_URL` is reachable over HTTPS with a valid certificate. |
| Bot doesn't respond (polling mode) | Make sure you started with `--profile polling` and that no webhook is set (`delete-webhook`). Only one polling process may run per token. |
| `Conflict: terminated by other getUpdates request` | Another instance is polling with the same token. Stop it. |
| Caddy can't get a certificate | Check that DNS points to the server and ports 80/443 are open (`ufw status`, cloud firewall). |
| Dashboard login loops or "CSRF" errors | Behind HTTPS set `COOKIE_SECURE=true` and add `PUBLIC_URL` to `CORS_ORIGINS`. Over plain HTTP in local development, set `COOKIE_SECURE=false`. |
| Crypto payment not detected | Check provider health in *System*. BEP20 requires `etherscan_api_key`. Check that the customer sent the exact amount on the right network before the window closed. The customer can tap *Check payment*, and admins can use *Check payment* on the order page. |
| CryptoBot webhook rejected | The webhook URL must be exactly `/api/webhooks/payments/cryptobot`, and the token in the dashboard must match the app that sends webhooks. |
| "Failed to decrypt" after moving servers | `ENCRYPTION_KEY` differs from the original. Restore the original key or re-enter the credentials. |
| Realtime updates not arriving | Your proxy buffers SSE. Disable buffering for `/api/events`. |
| Worker shows "offline" in System | `docker compose logs worker`, and check that Redis is reachable. |
| `pg_dump: server version mismatch` | The backend image ships a recent PostgreSQL client. Use PostgreSQL ≤ that version, or rebuild the image. |
