import type { PaymentMethodId } from "~/lib/domain";
import type { StoreSettings } from "~/lib/settings";

export interface PaymentOrder {
  id: string;
  number: string;
  total: number;
  currency: string;
  description: string;
  expiresAt: number;
}

export interface CreatedPayment {
  providerRef: string | null;
  payUrl: string | null;
  details: Record<string, unknown>;
}

export type RemoteStatus = "pending" | "paid" | "expired" | "failed";

export interface RemotePayment {
  status: RemoteStatus;
  amount: number | null;
  currency: string | null;
  orderId: string | null;
}

export interface PaymentProvider {
  id: PaymentMethodId;
  /** Customer-visible payment methods are listed only when available. */
  isAvailable(env: Env, settings: StoreSettings): boolean;
  /** Whether confirmation arrives automatically (webhook/API) rather than via an admin. */
  automatic: boolean;
  create(args: { env: Env; settings: StoreSettings; order: PaymentOrder; returnUrl: string }): Promise<CreatedPayment>;
  fetchRemote?(env: Env, providerRef: string): Promise<RemotePayment | null>;
}

export class PaymentProviderError extends Error {
  constructor(message: string, readonly providerId: PaymentMethodId) {
    super(message);
    this.name = "PaymentProviderError";
  }
}
