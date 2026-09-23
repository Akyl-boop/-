// Generates seed/seed.sql — editable demo catalog for a fresh database.
// Run: node scripts/build-seed.mjs
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const now = Date.now();
const q = (value) => (value === null || value === undefined ? "NULL" : typeof value === "number" ? String(value) : `'${String(value).replace(/'/g, "''")}'`);
const j = (value) => q(JSON.stringify(value));
const sql = [];
const insert = (table, row) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(", ")}) VALUES (${Object.values(row).join(", ")});`);

const categories = [
  { id: "cat_ai", slug: "ai-subscriptions", icon: "sparkles", name: { en: "AI Subscriptions", ru: "AI-подписки", zh: "AI 订阅" }, description: { en: "ChatGPT, Claude, Perplexity, Grok and more", ru: "ChatGPT, Claude, Perplexity, Grok и другие", zh: "ChatGPT、Claude、Perplexity、Grok 等" } },
  { id: "cat_gaming", slug: "gaming", icon: "gamepad", name: { en: "Gaming", ru: "Игры", zh: "游戏" }, description: { en: "Gift cards and in-game currency", ru: "Подарочные карты и игровая валюта", zh: "礼品卡与游戏货币" } },
  { id: "cat_software", slug: "software", icon: "code", name: { en: "Software", ru: "Софт", zh: "软件" }, description: { en: "Licenses for operating systems and apps", ru: "Лицензии на ОС и приложения", zh: "操作系统与应用许可证" } },
  { id: "cat_services", slug: "services", icon: "wrench", name: { en: "Services", ru: "Услуги", zh: "服务" }, description: { en: "Setup, activation and consulting", ru: "Настройка, активация и консультации", zh: "设置、激活与咨询" } },
  { id: "cat_other", slug: "other", icon: "box", name: { en: "Other Digital Products", ru: "Другие цифровые товары", zh: "其他数字商品" }, description: { en: "Guides, templates and more", ru: "Гайды, шаблоны и другое", zh: "指南、模板等" } },
];
categories.forEach((c, i) =>
  insert("categories", { id: q(c.id), slug: q(c.slug), name: j(c.name), description: j(c.description), icon: q(c.icon), sort_order: i, is_active: 1, created_at: now, updated_at: now }),
);

const accountActivation = {
  en: [
    { type: "paragraph", text: "Your subscription is activated on **your own account** — you keep your chats, history and settings." },
    {
      type: "steps",
      items: [
        { title: "Send us your login email", text: "Message support in Telegram with your order ID and the email of the account to upgrade." },
        { title: "Confirm the sign-in code", text: "We'll ask for a one-time code sent to your email. Share it only with official support." },
        { title: "Wait for activation", text: "Activation usually takes 5–30 minutes. The order page updates when it's done." },
        { title: "Sign out and back in", text: "Reload the app or sign in again to see the upgraded plan." },
      ],
    },
    { type: "callout", tone: "warning", title: "Keep your account secure", text: "Change your password after activation and never share codes with anyone except our official support." },
    { type: "faq", items: [{ question: "Will I lose my chat history?", answer: "No. The plan is applied to your existing account." }] },
  ],
  ru: [
    { type: "paragraph", text: "Подписка активируется на **вашем аккаунте** — чаты, история и настройки сохраняются." },
    {
      type: "steps",
      items: [
        { title: "Отправьте email аккаунта", text: "Напишите в поддержку в Telegram номер заказа и email аккаунта, который нужно активировать." },
        { title: "Подтвердите код входа", text: "Мы попросим одноразовый код из письма. Передавайте его только официальной поддержке." },
        { title: "Дождитесь активации", text: "Обычно занимает 5–30 минут. Страница заказа обновится автоматически." },
        { title: "Перезайдите в аккаунт", text: "Обновите приложение или войдите заново, чтобы увидеть новый тариф." },
      ],
    },
    { type: "callout", tone: "warning", title: "Безопасность аккаунта", text: "Смените пароль после активации и никому, кроме официальной поддержки, не передавайте коды." },
    { type: "faq", items: [{ question: "Сохранится ли история чатов?", answer: "Да. Тариф подключается к вашему текущему аккаунту." }] },
  ],
  zh: [
    { type: "paragraph", text: "订阅将在**您自己的账户**上激活——聊天记录、历史和设置都会保留。" },
    {
      type: "steps",
      items: [
        { title: "发送登录邮箱", text: "在 Telegram 联系客服，提供订单号和需要升级的账户邮箱。" },
        { title: "确认登录验证码", text: "我们会请您提供邮箱中的一次性验证码，请仅提供给官方客服。" },
        { title: "等待激活", text: "激活通常需要 5–30 分钟，完成后订单页面会自动更新。" },
        { title: "重新登录", text: "刷新应用或重新登录即可看到升级后的套餐。" },
      ],
    },
    { type: "callout", tone: "warning", title: "保护账户安全", text: "激活后请修改密码，除官方客服外不要向任何人提供验证码。" },
  ],
};

const redeemCode = {
  en: [
    { type: "steps", items: [
      { title: "Copy your code", text: "Your code is shown above in the **Digital delivery** section." },
      { title: "Open the redeem page", text: "Sign in to your account and open the redemption page of the service." },
      { title: "Paste and confirm", text: "Paste the code and confirm. The benefit is applied instantly." },
    ] },
    { type: "callout", tone: "tip", text: "Redeem the code soon after purchase — some codes have an activation deadline." },
  ],
  ru: [
    { type: "steps", items: [
      { title: "Скопируйте код", text: "Код показан выше в разделе **Цифровая выдача**." },
      { title: "Откройте страницу активации", text: "Войдите в аккаунт сервиса и откройте страницу активации кода." },
      { title: "Вставьте и подтвердите", text: "Вставьте код и подтвердите. Бонус начислится сразу." },
    ] },
    { type: "callout", tone: "tip", text: "Активируйте код вскоре после покупки — у некоторых кодов есть срок активации." },
  ],
  zh: [
    { type: "steps", items: [
      { title: "复制兑换码", text: "兑换码显示在上方的**数字交付**区域。" },
      { title: "打开兑换页面", text: "登录服务账户并打开兑换页面。" },
      { title: "粘贴并确认", text: "粘贴兑换码并确认，权益立即生效。" },
    ] },
    { type: "callout", tone: "tip", text: "请在购买后尽快兑换——部分兑换码有激活期限。" },
  ],
};

const windowsKey = {
  en: [
    { type: "steps", items: [
      { title: "Open Settings", text: "Go to **Settings → System → Activation**." },
      { title: "Change product key", text: "Click **Change product key** and paste the key from your order." },
      { title: "Or use the command line", text: "Run the command below in an elevated terminal." },
    ] },
    { type: "code", language: "powershell", code: "slmgr /ipk XXXXX-XXXXX-XXXXX-XXXXX-XXXXX\nslmgr /ato" },
    { type: "link", label: "Microsoft activation help", url: "https://support.microsoft.com/windows/activate-windows" },
  ],
  ru: [
    { type: "steps", items: [
      { title: "Откройте параметры", text: "Перейдите в **Параметры → Система → Активация**." },
      { title: "Измените ключ продукта", text: "Нажмите **Изменить ключ продукта** и вставьте ключ из заказа." },
      { title: "Или через командную строку", text: "Выполните команду ниже в терминале от имени администратора." },
    ] },
    { type: "code", language: "powershell", code: "slmgr /ipk XXXXX-XXXXX-XXXXX-XXXXX-XXXXX\nslmgr /ato" },
    { type: "link", label: "Справка Microsoft по активации", url: "https://support.microsoft.com/windows/activate-windows" },
  ],
};

const instructions = [
  { id: "ins_account", slug: "subscription-activation", title: { en: "Activating a subscription on your account", ru: "Активация подписки на вашем аккаунте", zh: "在您的账户上激活订阅" }, summary: { en: "How we upgrade your existing ChatGPT, Claude or Grok account.", ru: "Как мы подключаем тариф к вашему аккаунту ChatGPT, Claude или Grok.", zh: "我们如何为您现有的 ChatGPT、Claude 或 Grok 账户升级。" }, content: accountActivation },
  { id: "ins_code", slug: "redeem-a-code", title: { en: "Redeeming a code", ru: "Активация кода", zh: "兑换码使用方法" }, summary: { en: "Three steps to redeem promo codes and gift cards.", ru: "Три шага для активации промокодов и подарочных карт.", zh: "三步兑换优惠码和礼品卡。" }, content: redeemCode },
  { id: "ins_windows", slug: "windows-activation", title: { en: "Activating Windows", ru: "Активация Windows", zh: "激活 Windows" }, summary: { en: "Enter a product key in Settings or from the terminal.", ru: "Ввод ключа через параметры или терминал.", zh: "在设置或终端中输入产品密钥。" }, content: windowsKey },
];
instructions.forEach((ins, i) =>
  insert("instructions", { id: q(ins.id), slug: q(ins.slug), title: j(ins.title), summary: j(ins.summary), content: j(ins.content), is_published: 1, sort_order: i, created_at: now, updated_at: now }),
);

const fiveMin = { en: "Within 5–30 minutes", ru: "В течение 5–30 минут", zh: "5–30 分钟内" };
const instant = { en: "Instantly after payment", ru: "Сразу после оплаты", zh: "付款后立即" };
const warranty30 = { en: "Full warranty for the entire subscription period", ru: "Гарантия на весь срок подписки", zh: "整个订阅期内全程保修" };

const products = [
  {
    id: "prod_chatgpt_plus", slug: "chatgpt-plus", category: "cat_ai", instruction: "ins_account", accent: "#10a37f", price: 2200, old: 2500, delivery: "manual", unlimited: 1, featured: 1, popular: 1, priority: 100,
    name: { en: "ChatGPT Plus", ru: "ChatGPT Plus", zh: "ChatGPT Plus" },
    short: { en: "GPT access with higher limits, advanced voice, image generation and file analysis.", ru: "Доступ к GPT с повышенными лимитами, голосовым режимом, генерацией изображений и анализом файлов.", zh: "更高额度的 GPT 使用权限，支持高级语音、图像生成和文件分析。" },
    description: {
      en: "Upgrade your own OpenAI account to **ChatGPT Plus**.\n\n## What's included\n- Higher message limits on the latest models\n- Advanced voice mode\n- Image generation and file uploads\n- Custom GPTs and projects\n\nActivation is done on your existing account, so your chats and settings stay intact.",
      ru: "Подключение **ChatGPT Plus** к вашему аккаунту OpenAI.\n\n## Что входит\n- Повышенные лимиты на новейших моделях\n- Продвинутый голосовой режим\n- Генерация изображений и загрузка файлов\n- Собственные GPT и проекты\n\nАктивация выполняется на вашем аккаунте — чаты и настройки сохраняются.",
      zh: "为您自己的 OpenAI 账户升级 **ChatGPT Plus**。\n\n## 包含内容\n- 最新模型更高的消息额度\n- 高级语音模式\n- 图像生成和文件上传\n- 自定义 GPT 与项目\n\n在您现有账户上激活，聊天记录和设置均保留。",
    },
    requirements: { en: "- An OpenAI account you can sign in to\n- Access to the account's email for a one-time code", ru: "- Аккаунт OpenAI, в который вы можете войти\n- Доступ к почте аккаунта для одноразового кода", zh: "- 可以登录的 OpenAI 账户\n- 可接收一次性验证码的账户邮箱" },
    variants: [
      { id: "var_gpt_1m", name: { en: "1 month", ru: "1 месяц", zh: "1 个月" }, price: 2200, old: 2500 },
      { id: "var_gpt_3m", name: { en: "3 months", ru: "3 месяца", zh: "3 个月" }, price: 6200, old: 7500 },
    ],
    faq: [{ question: { en: "Is it activated on my account?", ru: "Активация на моём аккаунте?", zh: "是在我的账户上激活吗？" }, answer: { en: "Yes — we upgrade your existing account.", ru: "Да — мы подключаем тариф к вашему текущему аккаунту.", zh: "是的——我们为您现有的账户升级。" } }],
    tags: "chatgpt, openai, gpt, ai",
  },
  {
    id: "prod_claude_pro", slug: "claude-pro", category: "cat_ai", instruction: "ins_account", accent: "#d97757", price: 2100, old: null, delivery: "manual", unlimited: 1, featured: 1, popular: 1, priority: 90,
    name: { en: "Claude Pro", ru: "Claude Pro", zh: "Claude Pro" },
    short: { en: "More usage, projects and priority access to the latest Claude models.", ru: "Больше лимитов, проекты и приоритетный доступ к новейшим моделям Claude.", zh: "更多用量、项目功能以及对最新 Claude 模型的优先访问。" },
    description: { en: "Upgrade your Claude account to **Pro** for more usage, Projects and priority access during peak times.", ru: "Подключите **Claude Pro**: больше лимитов, Проекты и приоритетный доступ в часы нагрузки.", zh: "将您的 Claude 账户升级到 **Pro**，获得更多用量、项目功能以及高峰时段的优先访问。" },
    requirements: { en: "- A Claude account\n- Access to the account's email", ru: "- Аккаунт Claude\n- Доступ к почте аккаунта", zh: "- Claude 账户\n- 可访问账户邮箱" },
    variants: [{ id: "var_claude_1m", name: { en: "1 month", ru: "1 месяц", zh: "1 个月" }, price: 2100, old: null }],
    faq: [],
    tags: "claude, anthropic, ai",
  },
  {
    id: "prod_perplexity_pro", slug: "perplexity-pro", category: "cat_ai", instruction: "ins_code", accent: "#20b8cd", price: 2900, old: 20000, delivery: "inventory", unlimited: 0, featured: 1, popular: 0, priority: 80,
    name: { en: "Perplexity Pro — 12 months", ru: "Perplexity Pro — 12 месяцев", zh: "Perplexity Pro — 12 个月" },
    short: { en: "A promo code for a full year of Perplexity Pro. Delivered instantly.", ru: "Промокод на год Perplexity Pro. Мгновенная выдача.", zh: "Perplexity Pro 全年兑换码，即时交付。" },
    description: { en: "A **promo code** for 12 months of Perplexity Pro: Pro searches, file analysis and access to top models.\n\nRedeem it on a new or existing account.", ru: "**Промокод** на 12 месяцев Perplexity Pro: Pro-поиск, анализ файлов и доступ к топовым моделям.\n\nАктивируется на новом или существующем аккаунте.", zh: "Perplexity Pro 12 个月**兑换码**：Pro 搜索、文件分析及顶级模型访问。\n\n可在新账户或现有账户上兑换。" },
    requirements: { en: "- A Perplexity account without an active subscription", ru: "- Аккаунт Perplexity без активной подписки", zh: "- 没有有效订阅的 Perplexity 账户" },
    variants: [],
    faq: [],
    tags: "perplexity, search, ai",
    inventory: ["DEMO-PPLX-7K2Q-9MXA", "DEMO-PPLX-4TRD-2WQE", "DEMO-PPLX-8ZLC-5NVB", "DEMO-PPLX-3HFS-6YUJ", "DEMO-PPLX-1PKX-0RTM", "DEMO-PPLX-9BWE-4GHC", "DEMO-PPLX-5VQN-7LDS", "DEMO-PPLX-2MAZ-8XPK"],
  },
  {
    id: "prod_supergrok", slug: "supergrok", category: "cat_ai", instruction: "ins_account", accent: "#8b8b8b", price: 2700, old: 3000, delivery: "manual", unlimited: 1, featured: 1, popular: 0, priority: 70,
    name: { en: "SuperGrok", ru: "SuperGrok", zh: "SuperGrok" },
    short: { en: "Grok with higher limits, DeepSearch and extended reasoning.", ru: "Grok с увеличенными лимитами, DeepSearch и расширенными рассуждениями.", zh: "更高额度的 Grok，支持 DeepSearch 和扩展推理。" },
    description: { en: "Upgrade your xAI account to **SuperGrok** for higher usage limits and advanced features.", ru: "Подключите **SuperGrok** к аккаунту xAI: увеличенные лимиты и расширенные функции.", zh: "将您的 xAI 账户升级到 **SuperGrok**，获得更高用量和高级功能。" },
    requirements: { en: "- An xAI / Grok account", ru: "- Аккаунт xAI / Grok", zh: "- xAI / Grok 账户" },
    variants: [{ id: "var_grok_1m", name: { en: "1 month", ru: "1 месяц", zh: "1 个月" }, price: 2700, old: 3000 }],
    faq: [],
    tags: "grok, xai, ai",
  },
  {
    id: "prod_steam_card", slug: "steam-gift-card", category: "cat_gaming", instruction: "ins_code", accent: "#3a6fd8", price: 1100, old: null, delivery: "inventory", unlimited: 0, featured: 0, popular: 1, priority: 60,
    name: { en: "Steam Gift Card", ru: "Подарочная карта Steam", zh: "Steam 礼品卡" },
    short: { en: "Top up your Steam Wallet with a digital code.", ru: "Пополнение кошелька Steam цифровым кодом.", zh: "使用数字兑换码为 Steam 钱包充值。" },
    description: { en: "A digital code that adds funds to your **Steam Wallet**. Check the region before buying.", ru: "Цифровой код для пополнения **кошелька Steam**. Проверьте регион перед покупкой.", zh: "为 **Steam 钱包**充值的数字兑换码，购买前请确认地区。" },
    requirements: { en: "", ru: "", zh: "" },
    region: { en: "Global (USD wallets)", ru: "Глобальный (кошельки в USD)", zh: "全球（美元钱包）" },
    variants: [
      { id: "var_steam_10", name: { en: "$10", ru: "$10", zh: "$10" }, price: 1100, old: null, inventory: ["DEMO-STM10-A1B2-C3D4", "DEMO-STM10-E5F6-G7H8", "DEMO-STM10-J9K1-L2M3"] },
      { id: "var_steam_20", name: { en: "$20", ru: "$20", zh: "$20" }, price: 2150, old: null, inventory: ["DEMO-STM20-N4P5-Q6R7", "DEMO-STM20-S8T9-U1V2"] },
      { id: "var_steam_50", name: { en: "$50", ru: "$50", zh: "$50" }, price: 5300, old: null, inventory: [] },
    ],
    faq: [],
    tags: "steam, gift card, gaming",
    discounts: [{ minQuantity: 3, percent: 3 }, { minQuantity: 5, percent: 5 }],
  },
  {
    id: "prod_windows_11", slug: "windows-11-pro", category: "cat_software", instruction: "ins_windows", accent: "#0078d4", price: 1900, old: 3900, delivery: "inventory", unlimited: 0, featured: 0, popular: 0, priority: 50,
    name: { en: "Windows 11 Pro — license key", ru: "Windows 11 Pro — ключ", zh: "Windows 11 专业版 — 密钥" },
    short: { en: "A retail license key for Windows 11 Pro. Lifetime activation.", ru: "Лицензионный ключ Windows 11 Pro. Бессрочная активация.", zh: "Windows 11 专业版零售许可证密钥，永久激活。" },
    description: { en: "A **Windows 11 Pro** product key for one PC.", ru: "Ключ продукта **Windows 11 Pro** для одного ПК.", zh: "适用于一台电脑的 **Windows 11 专业版**产品密钥。" },
    requirements: { en: "- Windows 10/11 installed", ru: "- Установленная Windows 10/11", zh: "- 已安装 Windows 10/11" },
    variants: [],
    faq: [],
    tags: "windows, microsoft, license",
    inventory: ["DEMO-W11P-XXXXX-1", "DEMO-W11P-XXXXX-2", "DEMO-W11P-XXXXX-3"],
  },
  {
    id: "prod_ai_setup", slug: "ai-workspace-setup", category: "cat_services", instruction: null, accent: "#7c6cff", price: 4900, old: null, delivery: "manual", unlimited: 0, stock: 10, featured: 0, popular: 0, priority: 40,
    name: { en: "AI workspace setup", ru: "Настройка AI-рабочего места", zh: "AI 工作空间配置" },
    short: { en: "A 60-minute session: we set up your AI tools, prompts and workflows.", ru: "Сессия на 60 минут: настроим AI-инструменты, промпты и процессы.", zh: "60 分钟服务：为您配置 AI 工具、提示词和工作流程。" },
    description: { en: "A personal **60-minute** session with our specialist. We help choose the right subscriptions, configure custom instructions and build reusable prompts for your work.", ru: "Персональная **60-минутная** сессия со специалистом. Поможем выбрать подписки, настроить инструкции и собрать промпты под ваши задачи.", zh: "与专家进行 **60 分钟**一对一服务，帮您选择合适的订阅、配置自定义指令并构建可复用的提示词。" },
    requirements: { en: "", ru: "", zh: "" },
    variants: [],
    faq: [],
    tags: "service, consulting",
  },
  {
    id: "prod_prompt_guide", slug: "prompt-engineering-handbook", category: "cat_other", instruction: null, accent: "#f2b64c", price: 900, old: 1500, delivery: "static", unlimited: 1, featured: 0, popular: 0, priority: 30,
    name: { en: "Prompt Engineering Handbook", ru: "Справочник по промпт-инжинирингу", zh: "提示词工程手册" },
    short: { en: "A practical PDF guide with 120 tested prompts for work and study.", ru: "Практическое PDF-руководство со 120 проверенными промптами.", zh: "包含 120 条实测提示词的实用 PDF 指南。" },
    description: { en: "A concise handbook with **120 tested prompts**, patterns and checklists.", ru: "Сжатое руководство со **120 проверенными промптами**, шаблонами и чек-листами.", zh: "精炼手册，包含 **120 条实测提示词**、模式与清单。" },
    requirements: { en: "", ru: "", zh: "" },
    staticDelivery: "Download: https://example.com/replace-with-your-download-link",
    variants: [],
    faq: [],
    tags: "guide, pdf, prompts",
  },
];

const sha = (value) => createHash("sha256").update(value).digest("hex");
let inventoryIndex = 0;
const addUnits = (productId, variantId, units) =>
  units.forEach((content) => {
    inventoryIndex += 1;
    insert("inventory", { id: q(`inv_seed_${inventoryIndex}`), product_id: q(productId), variant_id: q(variantId), content: q(content), content_hash: q(sha(content)), status: q("available"), batch: q("seed"), created_at: now + inventoryIndex });
  });

products.forEach((p) => {
  insert("products", {
    id: q(p.id), slug: q(p.slug), category_id: q(p.category), instruction_id: q(p.instruction), name: j(p.name), short_description: j(p.short), description: j(p.description),
    thumbnail_url: "NULL", accent: q(p.accent), price: p.price, old_price: q(p.old), currency: q("USD"), stock: p.stock ?? 0, unlimited_stock: p.unlimited, min_quantity: 1,
    max_quantity: p.delivery === "manual" ? 3 : 10, is_active: 1, is_featured: p.featured, is_popular: p.popular, sort_priority: p.priority, delivery_type: q(p.delivery),
    delivery_time: j(p.delivery === "manual" ? fiveMin : instant), static_delivery: q(p.staticDelivery ?? null), warranty: j(warranty30), requirements: j(p.requirements),
    region_restrictions: j(p.region ?? {}), tags: q(p.tags), seo_title: j({}), seo_description: j({}), faq: j(p.faq), quantity_discounts: j(p.discounts ?? []), created_at: now, updated_at: now,
  });
  p.variants.forEach((v, i) => {
    insert("product_variants", { id: q(v.id), product_id: q(p.id), name: j(v.name), sku: "NULL", price: v.price, old_price: q(v.old), stock: 0, unlimited_stock: 1, is_active: 1, sort_order: i });
    if (v.inventory) addUnits(p.id, v.id, v.inventory);
  });
  if (p.inventory) addUnits(p.id, null, p.inventory);
});

insert("product_related", { product_id: q("prod_chatgpt_plus"), related_id: q("prod_claude_pro"), sort_order: 0 });
insert("product_related", { product_id: q("prod_chatgpt_plus"), related_id: q("prod_perplexity_pro"), sort_order: 1 });
insert("product_related", { product_id: q("prod_chatgpt_plus"), related_id: q("prod_supergrok"), sort_order: 2 });

insert("promo_codes", { id: q("promo_welcome"), code: q("WELCOME10"), description: q("Demo: 10% off the first order"), type: q("percent"), value: 10, currency: "NULL", min_order_amount: 0, max_uses: 100, per_user_limit: 1, starts_at: "NULL", expires_at: "NULL", is_active: 1, created_at: now, updated_at: now });

const header = "-- Editable demo catalog. Delete or change anything from the admin panel.\n-- Inventory units prefixed DEMO- are demo codes, not real products: remove them before going live.\n";
writeFileSync(new URL("../seed/seed.sql", import.meta.url), header + sql.join("\n") + "\n");
console.log(`seed/seed.sql written (${sql.length} statements)`);
