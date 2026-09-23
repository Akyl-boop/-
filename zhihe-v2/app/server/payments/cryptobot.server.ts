import { hmacSha256Hex, timingSafeEqual } from "../crypto.server";
import { PaymentProviderError, type PaymentProvider, type RemotePayment } from "./types";

interface CryptoBotInvoice {
  invoice_id: number;
  hash: string;
  status: "active" | "paid" | "expired";
  currency_type: "crypto" | "fiat";
  fiat?: string;
  asset?: string;
  amount: string;
  paid_asset?: string;
  paid_amount?: string;
  payload?: string;
  bot_invoice_url: string;
  mini_app_invoice_url?: string;
  web_app_invoice_url?: string;
  paid_at?: string;
}

interface CryptoBotResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: number; name: string };
}

export interface CryptoBotUpdate {
  update_id: number;
  update_type: string;
  request_date: string;
  payload: CryptoBotInvoice;
}

function apiBase(env: Env): string {
  return env.CRYPTOBOT_NETWORK === "testnet" ? "https://testnet-pay.crypt.bot/api" : "https://pay.crypt.bot/api";
}

async function call<T>(env: Env, method: string, init: { query?: Record<string, string>; body?: Record<string, unknown> } = {}): Promise<T> {
  const token = env.CRYPTOBOT_API_TOKEN;
  if (!token) throw new PaymentProviderError("CryptoBot is not configured", "cryptobot");
  const url = new URL(`${apiBase(env)}/${method}`);
  for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: init.body ? "POST" : "GET",
    headers: { "Crypto-Pay-API-Token": token, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const payload = (await response.json().catch(() => null)) as CryptoBotResponse<T> | null;
  if (!payload?.ok || payload.result === undefined) {
    throw new PaymentProviderError(`CryptoBot ${method} failed: ${payload?.error?.name ?? response.status}`, "cryptobot");
  }
  return payload.result;
}

function toMinor(amount: string | undefined): number | null {
  if (!amount) return null;
  const value = Number(amount);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function invoiceToRemote(invoice: CryptoBotInvoice): RemotePayment {
  return {
    status: invoice.status === "paid" ? "paid" : invoice.status === "expired" ? "expired" : "pending",
    amount: invoice.currency_type === "fiat" ? toMinor(invoice.amount) : null,
    currency: invoice.currency_type === "fiat" ? (invoice.fiat ?? null) : null,
    orderId: invoice.payload ?? null,
  };
}

/** Verifies `crypto-pay-api-signature`: HMAC-SHA256(body) keyed with SHA-256(token). */
export async function verifyCryptoBotSignature(env: Env, rawBody: string, signature: string | null): Promise<boolean> {
  const token = env.CRYPTOBOT_API_TOKEN;
  if (!token || !signature) return false;
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  const expected = await hmacSha256Hex(secret, rawBody);
  return timingSafeEqual(expected, signature.toLowerCase());
}

export const cryptoBotProvider: PaymentProvider = {
  id: "cryptobot",
  automatic: true,
  isAvailable(env, settings) {
    return Boolean(env.CRYPTOBOT_API_TOKEN) && settings.payments.cryptobotEnabled;
  },
  async create({ env, settings, order, returnUrl }) {
    const expiresIn = Math.max(60, Math.min(2_678_400, Math.floor((order.expiresAt - Date.now()) / 1000)));
    const body: Record<string, unknown> = {
      currency_type: "fiat",
      fiat: order.currency,
      amount: (order.total / 100).toFixed(2),
      description: order.description.slice(0, 1024),
      payload: order.id,
      paid_btn_name: "callback",
      paid_btn_url: returnUrl,
      allow_comments: false,
      allow_anonymous: true,
      expires_in: expiresIn,
    };
    if (settings.payments.cryptobotAssets.length > 0) body.accepted_assets = settings.payments.cryptobotAssets.join(",");
    const invoice = await call<CryptoBotInvoice>(env, "createInvoice", { body });
    return {
      providerRef: String(invoice.invoice_id),
      payUrl: invoice.bot_invoice_url,
      details: {
        hash: invoice.hash,
        webAppUrl: invoice.web_app_invoice_url ?? null,
        miniAppUrl: invoice.mini_app_invoice_url ?? null,
        network: env.CRYPTOBOT_NETWORK === "testnet" ? "testnet" : "mainnet",
      },
    };
  },
  async fetchRemote(env, providerRef) {
    const result = await call<{ items: CryptoBotInvoice[] }>(env, "getInvoices", { query: { invoice_ids: providerRef } });
    const invoice = result.items.find((item) => String(item.invoice_id) === providerRef);
    return invoice ? invoiceToRemote(invoice) : null;
  },
};
