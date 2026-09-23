import { z } from "zod";
import { LOCALES } from "~/i18n/config";
import { SUPPORTED_CURRENCIES } from "./money";

const localized = z
  .object({ en: z.string().optional(), ru: z.string().optional(), zh: z.string().optional() })
  .catch({});

const faqItem = z.object({ question: localized, answer: localized });

const wallet = z.object({
  id: z.string(),
  label: z.string(),
  network: z.string(),
  asset: z.string(),
  address: z.string(),
  memo: z.string().default(""),
});

export const settingsSchema = {
  general: z.object({
    storeName: z.string().catch("ZHIHE AI"),
    tagline: localized.default({
      en: "Premium digital products, delivered instantly.",
      ru: "Премиальные цифровые продукты с мгновенной выдачей.",
      zh: "优质数字产品，即时交付。",
    }),
    logoUrl: z.string().nullable().catch(null),
    faviconUrl: z.string().nullable().catch(null),
    currency: z.enum(SUPPORTED_CURRENCIES).catch("USD"),
    timezone: z.string().catch("UTC"),
    defaultLocale: z.enum(LOCALES).catch("ru"),
    enabledLocales: z.array(z.enum(LOCALES)).min(1).catch([...LOCALES]),
    maintenanceMode: z.boolean().catch(false),
    maintenanceMessage: localized.default({
      en: "We are updating the store. Please check back shortly.",
      ru: "Мы обновляем магазин. Загляните чуть позже.",
      zh: "商店正在更新，请稍后再来。",
    }),
  }),
  contact: z.object({
    telegram: z.string().catch("zhihe_support"),
    supportEmail: z.string().catch("support@zhihe.cyou"),
    supportHours: localized.default({ en: "Daily, 10:00–23:00 (UTC+6)", ru: "Ежедневно, 10:00–23:00 (UTC+6)", zh: "每天 10:00–23:00（UTC+6）" }),
  }),
  social: z.object({
    telegramChannel: z.string().catch(""),
    x: z.string().catch(""),
    instagram: z.string().catch(""),
    youtube: z.string().catch(""),
    vk: z.string().catch(""),
  }),
  homepage: z.object({
    heroEyebrow: localized.default({ en: "Digital products marketplace", ru: "Маркетплейс цифровых продуктов", zh: "数字产品商城" }),
    heroTitle: localized.default({
      en: "Premium subscriptions and digital goods. Delivered in seconds.",
      ru: "Премиальные подписки и цифровые товары. Выдача за секунды.",
      zh: "高级订阅与数字商品，秒级交付。",
    }),
    heroSubtitle: localized.default({
      en: "AI tools, software and gaming — paid securely with crypto and delivered automatically to your order page.",
      ru: "AI-сервисы, софт и игры — безопасная оплата криптовалютой и автоматическая выдача на странице заказа.",
      zh: "AI 工具、软件与游戏 —— 加密货币安全支付，自动交付到订单页面。",
    }),
    announcement: localized.default({}),
  }),
  footer: z.object({
    about: localized.default({
      en: "ZHIHE AI is a curated store for digital subscriptions, licenses and services with automated delivery.",
      ru: "ZHIHE AI — магазин цифровых подписок, лицензий и сервисов с автоматической выдачей.",
      zh: "ZHIHE AI 是一家提供数字订阅、许可证与服务并自动交付的精选商店。",
    }),
    legal: localized.default({ en: "All trademarks belong to their respective owners.", ru: "Все товарные знаки принадлежат их владельцам.", zh: "所有商标均归其各自所有者所有。" }),
  }),
  faq: z.object({
    items: z.array(faqItem).catch([]).default([
      {
        question: { en: "How fast is delivery?", ru: "Как быстро происходит выдача?", zh: "多久可以收到商品？" },
        answer: {
          en: "Products with automatic delivery appear on your order page immediately after the payment is confirmed. Manual products are usually delivered within the time shown on the product page.",
          ru: "Товары с автоматической выдачей появляются на странице заказа сразу после подтверждения оплаты. Товары с ручной выдачей обычно выдаются в срок, указанный на странице товара.",
          zh: "自动发货的商品在付款确认后立即显示在订单页面。人工发货的商品通常会在商品页面标注的时间内交付。",
        },
      },
      {
        question: { en: "Do I need an account?", ru: "Нужна ли регистрация?", zh: "需要注册账户吗？" },
        answer: {
          en: "No. Checkout only needs your email. You get a private order link that gives access to your purchase at any time.",
          ru: "Нет. Для оформления нужен только email. Вы получите приватную ссылку на заказ, по которой покупка доступна в любое время.",
          zh: "不需要。结账只需提供邮箱。您将获得一个私密订单链接，随时可以查看您的购买内容。",
        },
      },
      {
        question: { en: "Which payment methods are supported?", ru: "Какие способы оплаты доступны?", zh: "支持哪些付款方式？" },
        answer: {
          en: "Cryptocurrency via CryptoBot (USDT, TON, BTC and more) and direct wallet transfers. Card payments are coming soon.",
          ru: "Криптовалюта через CryptoBot (USDT, TON, BTC и другие) и прямой перевод на кошелёк. Оплата картами скоро появится.",
          zh: "通过 CryptoBot 支付加密货币（USDT、TON、BTC 等）以及直接钱包转账。银行卡支付即将上线。",
        },
      },
      {
        question: { en: "What if something does not work?", ru: "Что делать, если что-то не работает?", zh: "如果出现问题怎么办？" },
        answer: {
          en: "Every product comes with a warranty described on its page. Contact support with your order ID and we will resolve it.",
          ru: "На каждый товар действует гарантия, описанная на его странице. Напишите в поддержку, указав номер заказа, — мы решим вопрос.",
          zh: "每个商品都有其页面所述的保修。请携带订单号联系客服，我们会为您解决。",
        },
      },
      {
        question: { en: "I lost my order link. How do I get it back?", ru: "Я потерял ссылку на заказ. Как её восстановить?", zh: "我丢失了订单链接，怎么办？" },
        answer: {
          en: "Orders opened on this device are listed under My Orders. Otherwise, request the link to be resent to your email or contact support with your order ID.",
          ru: "Заказы, открытые на этом устройстве, отображаются в разделе «Мои заказы». Также можно запросить повторную отправку ссылки на email или написать в поддержку с номером заказа.",
          zh: "在此设备上打开过的订单会列在“我的订单”中。您也可以请求将链接重新发送到邮箱，或携带订单号联系客服。",
        },
      },
    ]),
  }),
  payments: z.object({
    cryptobotEnabled: z.boolean().catch(true),
    cryptobotAssets: z.array(z.string()).catch(["USDT", "TON", "BTC", "ETH", "LTC", "TRX", "USDC"]),
    manualEnabled: z.boolean().catch(true),
    manualWallets: z.array(wallet).catch([]),
    manualInstructions: localized.default({
      en: "Send the exact amount to one of the addresses below, then press “I have paid” and paste the transaction hash. We confirm transfers manually, usually within 30 minutes.",
      ru: "Отправьте точную сумму на один из адресов ниже, затем нажмите «Я оплатил» и вставьте хеш транзакции. Мы подтверждаем переводы вручную, обычно в течение 30 минут.",
      zh: "请将准确金额发送到下方任一地址，然后点击“我已付款”并粘贴交易哈希。我们会人工确认转账，通常在 30 分钟内完成。",
    }),
  }),
  notifications: z.object({
    telegramNewOrder: z.boolean().catch(false),
    telegramPaidOrder: z.boolean().catch(true),
    telegramLowStock: z.boolean().catch(true),
    lowStockThreshold: z.number().int().min(0).catch(5),
    emailCustomers: z.boolean().catch(true),
  }),
};

export type SettingsSection = keyof typeof settingsSchema;
export type StoreSettings = { [K in SettingsSection]: z.infer<(typeof settingsSchema)[K]> };
export const SETTINGS_SECTIONS = Object.keys(settingsSchema) as SettingsSection[];

export function parseSettingsSection<K extends SettingsSection>(section: K, raw: unknown): StoreSettings[K] {
  const schema = settingsSchema[section];
  const result = schema.safeParse(raw ?? {});
  return (result.success ? result.data : schema.parse({})) as StoreSettings[K];
}

/** Settings safe to expose to every visitor. */
export interface PublicSettings {
  storeName: string;
  tagline: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  currency: string;
  enabledLocales: string[];
  telegram: string;
  supportEmail: string;
  supportHours: string;
  social: StoreSettings["social"];
  footerAbout: string;
  footerLegal: string;
  announcement: string;
}
