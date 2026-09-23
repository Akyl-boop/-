import type { PaymentProvider } from "./types";

export const manualCryptoProvider: PaymentProvider = {
  id: "manual_crypto",
  automatic: false,
  isAvailable(_env, settings) {
    return settings.payments.manualEnabled && settings.payments.manualWallets.some((wallet) => wallet.address.trim());
  },
  async create({ settings, order }) {
    return {
      providerRef: null,
      payUrl: null,
      details: {
        wallets: settings.payments.manualWallets.filter((wallet) => wallet.address.trim()),
        amount: order.total,
        currency: order.currency,
      },
    };
  },
};

export const freeProvider: PaymentProvider = {
  id: "free",
  automatic: true,
  isAvailable: () => true,
  async create() {
    return { providerRef: null, payUrl: null, details: {} };
  },
};
