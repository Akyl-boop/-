import type { PaymentMethodId } from "~/lib/domain";
import type { StoreSettings } from "~/lib/settings";
import { cryptoBotProvider } from "./cryptobot.server";
import { freeProvider, manualCryptoProvider } from "./manual.server";
import type { PaymentProvider } from "./types";

/** Register new providers (e.g. card acquirers) here. Order defines checkout display order. */
const providers: PaymentProvider[] = [cryptoBotProvider, manualCryptoProvider];

export function getProvider(id: string): PaymentProvider | null {
  if (id === freeProvider.id) return freeProvider;
  return providers.find((provider) => provider.id === id) ?? null;
}

export function availableProviders(env: Env, settings: StoreSettings): PaymentProvider[] {
  return providers.filter((provider) => provider.isAvailable(env, settings));
}

export function availableMethodIds(env: Env, settings: StoreSettings): PaymentMethodId[] {
  return availableProviders(env, settings).map((provider) => provider.id);
}
