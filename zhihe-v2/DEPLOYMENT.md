# Deploying ZHIHE AI to Cloudflare

This project deploys as **one Cloudflare Worker**. It serves the server-rendered pages, the API and the static assets. The Worker uses:
- a **D1** database
- an **R2** bucket for uploaded images
- a **Cron Trigger** that expires unpaid orders and reconciles payments every 5 minutes

Nothing here changes DNS automatically. You attach the domain yourself in step 9.

All commands run from the `zhihe-v2/` folder. You need Node.js 20+ and a Cloudflare account.

```bash
cd zhihe-v2
npm install
npx wrangler login
```

---

## 1. What to create in Cloudflare

| Resource | Name used in this project | Purpose |
| --- | --- | --- |
| Worker | `zhihe-v2` (created on first deploy) | The website and admin panel |
| D1 database | `zhihe-v2` | Products, orders, inventory, settings, admins |
| R2 bucket | `zhihe-v2-media` | Product images, logo, favicon |
| Secrets | see step 4 | Payment, Telegram, signing keys |

Cron and bindings are already declared in `wrangler.jsonc`.

## 2. Create the D1 database

```bash
npx wrangler d1 create zhihe-v2
```

Wrangler prints a block like:

```
"d1_databases": [{ "binding": "DB", "database_name": "zhihe-v2", "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" }]
```

Copy the `database_id` into `wrangler.jsonc`, replacing `00000000-0000-0000-0000-000000000000`.

Then create the media bucket:

```bash
npx wrangler r2 bucket create zhihe-v2-media
```

> If you choose other names, update `database_name` / `bucket_name` in `wrangler.jsonc` accordingly.

## 3. Apply migrations

```bash
npm run db:migrate:remote
```

Optional: load the editable demo catalog (ChatGPT Plus, Claude Pro, Perplexity Pro, SuperGrok, Steam, Windows, …):

```bash
npm run db:seed:remote
```

The demo inventory codes start with `DEMO-`. **Delete them before going live** (Admin → Inventory → pick a product → "Delete available"), or skip seeding and create your catalog from scratch.

Future schema changes go into new files in `migrations/` and are applied with the same command.

## 4. Environment variables and secrets

**Plain variables** live in `wrangler.jsonc → "vars"`:

| Name | Value |
| --- | --- |
| `SITE_URL` | `https://zhihe.cyou` (no trailing slash) |
| `CRYPTOBOT_NETWORK` | `mainnet` (or `testnet` while testing) |
| `ORDER_TTL_MINUTES` | `60`: stock hold for unpaid CryptoBot orders |
| `MANUAL_ORDER_TTL_HOURS` | `24`: stock hold for manual-transfer orders |

**Secrets.** Set each one with `npx wrangler secret put NAME` and paste the value when prompted:

| Secret | Required | How to get it |
| --- | --- | --- |
| `ORDER_LINK_SECRET` | **Yes** | `openssl rand -base64 48`. Keep it stable: changing it invalidates existing order links. |
| `ADMIN_SETUP_TOKEN` | For first login | Any random string of 16+ characters. Delete it after creating the owner account. |
| `CRYPTOBOT_API_TOKEN` | For CryptoBot payments | Step 5 |
| `TELEGRAM_BOT_TOKEN` | For notifications | Step 6 |
| `TELEGRAM_CHAT_ID` | For notifications | Step 6 |
| `RESEND_API_KEY` | Optional | resend.com → API Keys |
| `EMAIL_FROM` | Optional | e.g. `ZHIHE AI <orders@zhihe.cyou>` (domain verified in Resend) |

```bash
npx wrangler secret put ORDER_LINK_SECRET
npx wrangler secret put ADMIN_SETUP_TOKEN
npx wrangler secret put CRYPTOBOT_API_TOKEN
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Secrets can also be managed in the dashboard: **Workers & Pages → zhihe-v2 → Settings → Variables and Secrets**. Never put secrets in `wrangler.jsonc` or in the repository.

> The first `wrangler secret put` may say the Worker doesn't exist yet. Either confirm creating it, or deploy once (step 7–8) and then add secrets.

## 5. Configure CryptoBot (Crypto Pay)

1. In Telegram, open **@CryptoBot** → **Crypto Pay** → **Create App**. For testing, use **@CryptoTestnetBot** instead and set `CRYPTOBOT_NETWORK` to `testnet`.
2. Copy the **API token** and store it: `npx wrangler secret put CRYPTOBOT_API_TOKEN`.
3. In the same app, open **Webhooks** → **Enable webhooks** and enter:
   ```
   https://zhihe.cyou/api/webhooks/cryptobot
   ```
   (Admin → Settings → Payments shows this exact URL with a copy button.)
4. In **Admin → Settings → Payments**:
   - keep "Accept payments via CryptoBot" enabled
   - list the accepted assets, e.g. `USDT, TON, BTC`

How it works: at checkout the server creates a fiat-denominated invoice. CryptoBot calls the webhook when it is paid. The Worker checks the signature, amount and currency, then delivers the order automatically. If a webhook is ever missed, the cron job and the customer's "check status" button reconcile the invoice through the API.

**Direct wallet transfers**: add your wallets in **Admin → Settings → Payments → Direct wallet transfers** and enable the method. The customer sees the addresses and amount and can submit a transaction hash. You then approve the payment from **Admin → Orders → order → Approve payment**, and delivery happens automatically.

## 6. Configure Telegram notifications

1. In Telegram, open **@BotFather** → `/newbot` → copy the **bot token**.
2. Send any message to your new bot (or add it to a group and send a message there).
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy `message.chat.id`. Group IDs are negative, e.g. `-1001234567890`.
4. Store both values:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put TELEGRAM_CHAT_ID
   ```
5. In **Admin → Settings → Notifications**, press **Send test message** and choose which events to receive: paid orders, new unpaid orders, low stock.

If the variables are missing, notifications are skipped silently and orders are never affected.

## 7. Build

```bash
npm run build
```

Output:
- `build/client/` holds the static assets (JS, CSS, fonts, favicon, OG image).
- `build/server/` holds the Worker bundle plus a generated `wrangler.json` that points to both.

Optional checks before deploying: `npm run typecheck && npm run lint && npm test`.

## 8. Deploy — which folder, which command

Run everything from the **`zhihe-v2/`** folder:

```bash
npm run deploy        # = npm run build && wrangler deploy
```

Wrangler uploads the Worker and `build/client` assets together. There is no separate folder to upload by hand. The site is then live at `https://zhihe-v2.<your-subdomain>.workers.dev`.

Create the owner account at `https://zhihe-v2.<your-subdomain>.workers.dev/admin/setup` using `ADMIN_SETUP_TOKEN`, then remove the token:

```bash
npx wrangler secret delete ADMIN_SETUP_TOKEN
```

(Alternative without the web form: `npm run admin:hash -- you@mail.com "Your Name" "a-strong-password"` prints an SQL statement. Run it with `npx wrangler d1 execute DB --remote --command "<SQL>"`.)

Test the whole flow on the `workers.dev` address:
- place an order
- pay on testnet or approve a manual transfer
- check delivery and the Telegram notification

### Continuous deployment from Git (optional)

**Workers & Pages → zhihe-v2 → Settings → Builds → Connect** your repository, then set:
- **Root directory**: `zhihe-v2`
- **Build command**: `npm run build`
- **Deploy command**: `npx wrangler deploy`

Every push to the production branch then deploys automatically.

## 9. Replace the existing zhihe-ai deployment

The old site keeps running until you move the domain. Nothing is deleted.

1. Make sure the new Worker is fully configured and tested on `workers.dev` (steps 1–8).
2. Find where `zhihe.cyou` is attached today:
   - **Pages project**: Workers & Pages → *old project* → **Custom domains**
   - **Worker**: Workers & Pages → *old worker* → Settings → **Domains & Routes**
3. Remove `zhihe.cyou` (and `www.zhihe.cyou`, if used) from the **old** project or worker.
4. Attach it to the new Worker: Workers & Pages → **zhihe-v2** → Settings → **Domains & Routes** → **Add → Custom domain** → `zhihe.cyou`. Repeat for `www.zhihe.cyou` if you use it.
5. Cloudflare creates the DNS record for the custom domain and issues the certificate. This usually takes under a minute.
6. Update the CryptoBot webhook URL (step 5) if you tested with the `workers.dev` address.
7. Keep the old project for a few days as a rollback: re-attaching the domain to it reverts the switch.

Doing steps 3–4 back to back keeps downtime to seconds.

## 10. Keep zhihe.cyou connected

- **Leave the domain on Cloudflare nameservers.** Custom domains on Workers require the zone to be active in the same Cloudflare account.
- **Don't delete** the DNS record that Cloudflare creates for the Worker custom domain. It is managed by the Worker.
- **Keep `SITE_URL` in `wrangler.jsonc` set to `https://zhihe.cyou`.** Order links, canonical URLs and the sitemap use it.
- **SSL/TLS mode** can stay on *Full* or *Full (strict)*. Workers custom domains always have a valid certificate.
- **To add `www`**, attach `www.zhihe.cyou` as a second custom domain. Optionally add a Redirect Rule `www.zhihe.cyou/* → https://zhihe.cyou/$1`.
- **Pin the domain in config (optional).** After it is attached, you can add it to `wrangler.jsonc` so deploys keep it:
  ```jsonc
  "routes": [{ "pattern": "zhihe.cyou", "custom_domain": true }]
  ```

---

## Operations cheat sheet

| Task | Where |
| --- | --- |
| Upload keys/codes | Admin → Inventory → Add inventory (paste, TXT or CSV) |
| Approve a manual payment | Admin → Orders → "Needs attention" filter → order → Approve payment |
| Deliver a manual product | Admin → Orders → order → "Deliver manually" |
| Restocked after a shortage | Admin → Orders → order → Retry delivery |
| Resend a lost link | Admin → Orders → order → Customer link (copy) or Resend order email |
| Maintenance mode | Admin → Settings → General |
| Logs | Workers & Pages → zhihe-v2 → Logs (observability is enabled) |
| Database backups | `npx wrangler d1 time-travel info zhihe-v2`. D1 keeps 30 days of point-in-time recovery. |
