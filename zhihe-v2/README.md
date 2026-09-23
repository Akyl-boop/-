# ZHIHE AI — digital products store

A production storefront and admin console for selling digital products: AI subscriptions, license keys, gift cards, accounts and services. It runs entirely on Cloudflare: Workers for server rendering and APIs, D1 as the database, R2 for media, and a Cron Trigger for housekeeping.

- **Storefront**: home, catalog with search and categories, product pages, guest checkout, private order pages with digital delivery and activation guides, a help center, FAQ, support and My Orders.
- **Languages**: English, Russian and Simplified Chinese (EN / RU / 中文). The choice is remembered in a cookie, and every language is also reachable through `?lang=` for SEO.
- **Admin console** at `/admin`: dashboard, orders, products, categories, inventory, instructions, customers, discounts, analytics, media, settings, audit log, and account and team management.
- **Payments**: CryptoBot (Crypto Pay API) with signed webhooks and API reconciliation, plus direct wallet transfers approved by an admin. Providers are pluggable modules.
- **Notifications**: Telegram messages to admins and optional customer email through Resend. Both fail gracefully when not configured.

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the step-by-step Cloudflare setup.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | React Router v8 (framework mode, SSR) + React 19 |
| Runtime | Cloudflare Workers (`@cloudflare/vite-plugin`) |
| Database | Cloudflare D1 (SQLite), SQL migrations in `migrations/` |
| Media | Cloudflare R2 (`MEDIA` binding), served from `/media/*` |
| Styling | Tailwind CSS v4 with a token-based design system (`app/app.css`) |
| Validation | Zod (server) |
| Tests | Vitest, ESLint, TypeScript strict |

## Getting started

```bash
cd zhihe-v2
npm install
cp .env.example .dev.vars          # fill ORDER_LINK_SECRET and ADMIN_SETUP_TOKEN at minimum
npm run db:migrate:local           # create the local D1 schema
npm run db:seed:local              # optional: editable demo catalog
npm run dev                        # http://localhost:5173
```

Open `http://localhost:5173/admin/setup`, enter the `ADMIN_SETUP_TOKEN` and create the owner account.

To test payments locally, either add a wallet under **Settings → Payments → Direct wallet transfers** and approve the order from **Orders**, or set a testnet `CRYPTOBOT_API_TOKEN` from `@CryptoTestnetBot` with `CRYPTOBOT_NETWORK=testnet`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with the local Workers runtime, D1 and R2 |
| `npm run build` | Production build (`build/client` for assets, `build/server` for the Worker) |
| `npm run preview` | Build and serve the production bundle locally |
| `npm run deploy` | Build and deploy with Wrangler |
| `npm run typecheck` | Route type generation + `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests |
| `npm run db:migrate:local` / `db:migrate:remote` | Apply D1 migrations |
| `npm run db:seed:build` | Regenerate `seed/seed.sql` from `scripts/build-seed.mjs` |
| `npm run db:seed:local` / `db:seed:remote` | Load the demo catalog |
| `npm run admin:hash -- <email> <name> <password>` | Print SQL that creates an owner account (CLI alternative to `/admin/setup`) |

## Project structure

```
zhihe-v2/
├── app/
│   ├── root.tsx, routes.ts, app.css, entry.server.tsx
│   ├── routes/
│   │   ├── store/        storefront pages (home, catalog, product, checkout, order, …)
│   │   ├── admin/        admin console pages
│   │   ├── api/          locale, CryptoBot webhook, order status, media upload
│   │   └── seo/          sitemap.xml, robots.txt
│   ├── components/
│   │   ├── ui/           design-system primitives (button, fields, dialog, toast, …)
│   │   ├── store/        storefront components
│   │   └── admin/        admin shell, tables, editors, charts
│   ├── server/           server-only modules (never shipped to the browser)
│   │   ├── payments/     provider registry, CryptoBot, manual transfer, confirmation
│   │   ├── notify/       Telegram, email
│   │   ├── admin/        admin services (products, orders, inventory, analytics)
│   │   ├── checkout.server.ts     order creation, reservation, promo redemption
│   │   ├── fulfillment.server.ts  payment application, idempotent delivery, cancellation
│   │   └── auth.server.ts, catalog.server.ts, settings.server.ts, …
│   ├── lib/              shared domain types and helpers
│   └── i18n/             locale config and EN / RU / ZH dictionaries
├── workers/app.ts        Worker entry: CSRF guard, security headers, media, cron
├── migrations/           D1 schema
├── seed/seed.sql         demo catalog (generated)
├── scripts/              seed generator, password hash helper
├── tests/                unit tests
├── wrangler.jsonc        Cloudflare configuration and bindings
├── .env.example          every variable and secret, documented
├── README.md
└── DEPLOYMENT.md
```

## How the critical parts work

### Orders and access
- Order numbers look like `ZH-2026-7KQ4MX` and are only identifiers. Nobody can open an order without its access key.
- The key is `HMAC(ORDER_LINK_SECRET, order id + per-order salt)`, so links can be regenerated for emails and support. An admin can revoke a link by rotating the salt.
- Order pages are `no-store` and `noindex`, and the referrer policy keeps keys out of third-party `Referer` headers.

### Inventory and delivery
- **At checkout**, units are **reserved** for the order until the payment window closes. Expired holds are released by the cron job and are also treated as sellable immediately.
- **The paid state is claimed exactly once.** Payment is applied with a single conditional `UPDATE … WHERE status IN (payable states)`, so duplicate webhooks, retries and repeated admin clicks cannot apply it twice.
- **Delivery is idempotent.** Each order line receives `quantity − already sold to this line` units, selected and marked `sold` in one statement inside a D1 batch transaction. Re-running delivery, reopening an order or retrying after a restock can never assign a second key.
- **Unsold inventory never reaches the browser.** Customers only receive units that are `sold` to their own order.

### Payments
- **CryptoBot**: the server creates the invoice. The webhook is verified with `HMAC-SHA256(body, SHA256(token))`, and the amount, currency and order are cross-checked. Webhook ids are logged to ignore replays. Unpaid invoices are also reconciled by the cron job and by the customer's "check status" button, in case a webhook is lost.
- **Manual transfer**: the order waits in `waiting_payment`. The customer can submit a transaction hash, and an admin approves it from the order page.
- **Adding a provider** (for example cards): implement `PaymentProvider` in `app/server/payments/` and register it in `registry.server.ts`.

### Security
- Prices, discounts, totals, stock and payment status are always computed on the server.
- Admin passwords use PBKDF2-SHA256. Sessions are random tokens stored hashed, in a `__Host-` HttpOnly, Secure, SameSite=Strict cookie with a 12-hour lifetime.
- Failed logins are rate-limited per email and per IP. Every admin loader and action checks authorization on the server. The owner/manager roles gate settings and the audit log.
- Every state-changing request must come from the same origin (CSRF guard in `workers/app.ts`). The only exception is the signed payment webhook.
- Other rate limits cover checkout, order actions and order lookup. Security headers include a nonce-based CSP, HSTS, `X-Frame-Options: DENY` and `nosniff`.
- Uploads are validated by file signature and size. SVG is not accepted. Media is served with a sandbox CSP.
- Every admin action is written to the audit log.
