import { ArrowLeft, Bitcoin, CircleAlert, CreditCard, Lock, Minus, Plus, Tag, Wallet, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Form, Link, redirect, useNavigation, useSearchParams } from "react-router";
import { z } from "zod";
import { ProductCover } from "~/components/store/product-cover";
import { Button } from "~/components/ui/button";
import { TextField } from "~/components/ui/field";
import { useLocale, useT } from "~/i18n/react";
import type { StoreMessageKey } from "~/i18n/messages";
import type { PaymentMethodId } from "~/lib/domain";
import { cn } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import { metaT, rootData, seo } from "~/lib/seo";
import { getProductDetail } from "~/server/catalog.server";
import { createOrder, resolveCheckout, type CheckoutError } from "~/server/checkout.server";
import { getRequestContext } from "~/server/context";
import { badRequest, clientIp, notFound, userAgent } from "~/server/http.server";
import { resolveLocale } from "~/server/locale.server";
import { notifyNewOrder } from "~/server/notify/orders.server";
import { availableMethodIds } from "~/server/payments/registry.server";
import { hitRateLimit } from "~/server/rate-limit.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/checkout";

function readSelection(url: URL) {
  const qty = Number.parseInt(url.searchParams.get("qty") ?? "", 10);
  return {
    variantId: url.searchParams.get("variant") || null,
    quantity: Number.isFinite(qty) ? qty : NaN,
    promoCode: (url.searchParams.get("promo") ?? "").trim().slice(0, 40) || null,
  };
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const product = await getProductDetail(env.DB, params.slug, locale);
  if (!product) notFound();

  const url = new URL(request.url);
  const selection = readSelection(url);
  const variantId = product.variants.length ? (product.variants.find((v) => v.id === selection.variantId)?.id ?? product.variants[0]?.id ?? null) : null;
  const quantity = Number.isInteger(selection.quantity) ? Math.min(Math.max(selection.quantity, product.minQuantity), product.maxQuantity) : product.minQuantity;

  const base = await resolveCheckout(env.DB, settings, { slug: product.slug, variantId, quantity, promoCode: null, email: null });
  let quote = base.line?.quote ?? null;
  let promoError: CheckoutError | null = null;
  if (base.ok && selection.promoCode) {
    const withPromo = await resolveCheckout(env.DB, settings, { slug: product.slug, variantId, quantity, promoCode: selection.promoCode, email: null });
    if (withPromo.ok) quote = withPromo.line.quote;
    else promoError = withPromo.error;
  }

  return {
    product,
    variantId,
    quantity,
    quote,
    stockError: base.ok ? null : base.error,
    promoCode: selection.promoCode,
    promoError,
    methods: availableMethodIds(env, settings),
  };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  return seo(root, { title: `${metaT(root, "checkout.title")} · ${loaderData?.product.name ?? ""}`, path: `/checkout/${loaderData?.product.slug ?? ""}`, noindex: true });
};

const checkoutSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).email(),
  telegram: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, ""))
    .refine((value) => value === "" || /^[a-zA-Z0-9_]{4,32}$/.test(value), "telegram")
    .transform((value) => value || null),
  paymentMethod: z.string().trim().max(32),
  variantId: z.string().max(64).optional().transform((value) => value || null),
  quantity: z.coerce.number().int().min(1).max(1000),
  promoCode: z.string().trim().max(40).optional().transform((value) => value || null),
});

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const limit = await hitRateLimit(env.DB, `checkout:${clientIp(request)}`, 10, 10 * 60 * 1000);
  if (!limit.allowed) return badRequest({ fieldErrors: {} as Record<string, string>, error: "rate_limited" as CheckoutError });

  const form = Object.fromEntries(await request.formData());
  const parsed = checkoutSchema.safeParse(form);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] = String(issue.path[0]);
    return badRequest({ fieldErrors: fields, error: null as CheckoutError | null });
  }
  const input = parsed.data;
  const result = await createOrder(env, ctx, settings, {
    slug: params.slug,
    variantId: input.variantId,
    quantity: input.quantity,
    promoCode: input.promoCode,
    email: input.email,
    telegram: input.telegram,
    paymentMethod: input.paymentMethod as PaymentMethodId,
    locale,
    ip: clientIp(request),
    userAgent: userAgent(request),
  });
  if (!result.ok) return badRequest({ fieldErrors: {} as Record<string, string>, error: result.error });
  ctx.waitUntil(notifyNewOrder(env, result.order));
  throw redirect(`/order/${result.order.number}?key=${encodeURIComponent(result.accessKey)}&new=1`);
}

const METHOD_META: Record<"cryptobot" | "manual_crypto", { icon: typeof Wallet; title: StoreMessageKey; text: StoreMessageKey }> = {
  cryptobot: { icon: Bitcoin, title: "payment.cryptobot.title", text: "payment.cryptobot.text" },
  manual_crypto: { icon: Wallet, title: "payment.manual.title", text: "payment.manual.text" },
};

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { product, variantId, quantity, quote, stockError, promoCode, promoError, methods } = loaderData;
  const [method, setMethod] = useState<PaymentMethodId | null>(methods[0] ?? null);
  const [promoInput, setPromoInput] = useState(promoCode ?? "");
  const submitting = navigation.state === "submitting" && navigation.formMethod === "POST";
  const updating = navigation.state === "loading" && navigation.location.pathname === `/checkout/${product.slug}`;
  const variant = product.variants.find((item) => item.id === variantId);
  const fieldErrors = actionData?.fieldErrors ?? {};
  const orderError = actionData?.error ?? null;
  const money = (value: number) => formatMoney(value, product.currency, locale);

  useEffect(() => setPromoInput(promoCode ?? ""), [promoCode]);

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    setSearchParams(next, { replace: true, preventScrollReset: true });
  };

  const maxQuantity = (variant ? variant.stock : product.stock) ?? product.maxQuantity;
  const canBuy = Boolean(quote) && !stockError && (method !== null || quote?.total === 0);

  return (
    <div className="page-container pt-6 sm:pt-10">
      <Link to={`/product/${product.slug}`} className="inline-flex items-center gap-1.5 text-[13px] text-fg-subtle transition-colors hover:text-fg">
        <ArrowLeft className="size-3.5" />
        {t("checkout.back")}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{t("checkout.title")}</h1>

      <Form method="post" className="mt-8 grid gap-6 lg:grid-cols-[1fr_400px] lg:gap-10" noValidate>
        <input type="hidden" name="variantId" value={variantId ?? ""} />
        <input type="hidden" name="quantity" value={quantity} />
        <input type="hidden" name="promoCode" value={promoCode ?? ""} />
        <input type="hidden" name="paymentMethod" value={method ?? ""} />

        <div className="space-y-6">
          <section className="surface p-5 sm:p-7">
            <StepTitle index={1} title={t("checkout.step.order")} />
            <div className="mt-5 flex items-center gap-4">
              <ProductCover name={product.name} imageUrl={product.thumbnailUrl} accent={product.accent} size="thumb" className="size-14 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-fg">{product.name}</p>
                <p className="mt-0.5 text-[13px] text-fg-subtle">{product.deliveryType === "manual" ? t("delivery.manual") : t("delivery.instant")}</p>
              </div>
            </div>
            {product.variants.length > 0 ? (
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {product.variants.map((option) => {
                  const unavailable = option.stock !== null && option.stock <= 0;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={unavailable}
                      onClick={() => update({ variant: option.id, qty: String(product.minQuantity) })}
                      className={cn(
                        "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                        option.id === variantId ? "border-accent/60 bg-accent-soft" : "border-line bg-panel-2/50 hover:border-line-strong",
                      )}
                    >
                      <span className="text-sm font-medium">{option.name}</span>
                      <span className="text-sm font-semibold tabular">{money(option.price)}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {product.maxQuantity > 1 ? (
              <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-line bg-panel-2/40 px-4 py-3">
                <span className="text-sm text-fg-muted">{t("product.quantity")}</span>
                <div className="inline-flex items-center rounded-lg border border-line-strong bg-panel-2">
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={quantity <= product.minQuantity || updating} onClick={() => update({ qty: String(quantity - 1) })} aria-label={t("product.decrease")}>
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-9 text-center text-sm font-semibold tabular">{quantity}</span>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={quantity >= Math.min(product.maxQuantity, maxQuantity) || updating} onClick={() => update({ qty: String(quantity + 1) })} aria-label={t("product.increase")}>
                    <Plus className="size-3.5" />
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="surface p-5 sm:p-7">
            <StepTitle index={2} title={t("checkout.step.contact")} />
            <p className="mt-1.5 text-[13px] text-fg-subtle">{t("checkout.contact.note")}</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <TextField
                label={t("checkout.email")}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                placeholder="you@example.com"
                error={fieldErrors.email ? t("checkout.error.email") : null}
                hint={t("checkout.email.hint")}
              />
              <TextField
                label={t("checkout.telegram")}
                name="telegram"
                autoComplete="off"
                placeholder="@username"
                optional={t("common.optional")}
                error={fieldErrors.telegram ? t("checkout.error.telegram") : null}
                hint={t("checkout.telegram.hint")}
              />
            </div>
          </section>

          <section className="surface p-5 sm:p-7">
            <StepTitle index={3} title={t("checkout.step.payment")} />
            {methods.length === 0 ? (
              <div className="mt-5 flex gap-3 rounded-xl border border-warning/25 bg-warning-soft px-4 py-3 text-sm text-warning">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {t("checkout.noMethods")}
              </div>
            ) : null}
            <div className="mt-5 grid gap-2" role="radiogroup" aria-label={t("checkout.step.payment")}>
              {(methods.filter((id) => id !== "free") as ("cryptobot" | "manual_crypto")[]).map((id) => {
                const info = METHOD_META[id];
                const selected = method === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setMethod(id)}
                    className={cn(
                      "flex items-center gap-4 rounded-xl border px-4 py-4 text-left transition-colors",
                      selected ? "border-accent/60 bg-accent-soft" : "border-line bg-panel-2/50 hover:border-line-strong",
                    )}
                  >
                    <span className={cn("grid size-10 shrink-0 place-items-center rounded-lg border", selected ? "border-accent/40 bg-accent/15 text-accent-strong" : "border-line-strong bg-panel-3 text-fg-muted")}>
                      <info.icon className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">{t(info.title)}</span>
                      <span className="mt-0.5 block text-[13px] text-fg-subtle">{t(info.text)}</span>
                    </span>
                    <span className={cn("size-4 shrink-0 rounded-full border-2 transition-colors", selected ? "border-accent bg-accent shadow-[inset_0_0_0_3px_var(--color-panel)]" : "border-line-strong")} />
                  </button>
                );
              })}
              <div className="flex items-center gap-4 rounded-xl border border-dashed border-line px-4 py-4 opacity-60">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line-strong bg-panel-3 text-fg-subtle">
                  <CreditCard className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg-muted">{t("payment.card.title")}</span>
                  <span className="mt-0.5 block text-[13px] text-fg-subtle">{t("payment.card.soon")}</span>
                </span>
              </div>
            </div>
          </section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className={cn("surface p-5 transition-opacity sm:p-7", updating && "opacity-70")}>
            <h2 className="text-base font-semibold">{t("checkout.summary")}</h2>
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="min-w-0 text-fg-muted">
                  {product.name}
                  {variant ? <span className="text-fg-subtle"> · {variant.name}</span> : null}
                  <span className="text-fg-subtle"> × {quantity}</span>
                </dt>
                <dd className="shrink-0 tabular">{quote ? money(quote.subtotal) : "—"}</dd>
              </div>
              {quote && quote.quantityDiscount > 0 ? (
                <div className="flex justify-between gap-4 text-success">
                  <dt>{t("checkout.bulkDiscount", { percent: quote.quantityDiscountPercent })}</dt>
                  <dd className="tabular">−{money(quote.quantityDiscount)}</dd>
                </div>
              ) : null}
              {quote && quote.promoDiscount > 0 ? (
                <div className="flex justify-between gap-4 text-success">
                  <dt>{t("checkout.promoDiscount", { code: quote.promoCode ?? "" })}</dt>
                  <dd className="tabular">−{money(quote.promoDiscount)}</dd>
                </div>
              ) : null}
            </dl>

            <div className="mt-5">
              {promoCode && !promoError ? (
                <div className="flex items-center justify-between rounded-xl border border-success/25 bg-success-soft px-3.5 py-2.5 text-sm">
                  <span className="flex items-center gap-2 font-medium text-success">
                    <Tag className="size-4" />
                    {promoCode}
                  </span>
                  <button type="button" onClick={() => update({ promo: null })} className="rounded-md p-1 text-success/80 hover:text-success" aria-label={t("checkout.promo.remove")}>
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <div>
                  <div className="flex gap-2">
                    <input
                      value={promoInput}
                      onChange={(event) => setPromoInput(event.target.value.toUpperCase())}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          if (promoInput.trim()) update({ promo: promoInput.trim() });
                        }
                      }}
                      placeholder={t("checkout.promo.placeholder")}
                      aria-label={t("checkout.promo.placeholder")}
                      aria-invalid={promoError ? true : undefined}
                      className="input input-sm font-mono uppercase"
                      maxLength={40}
                    />
                    <Button size="sm" onClick={() => promoInput.trim() && update({ promo: promoInput.trim() })} disabled={!promoInput.trim()} loading={updating && Boolean(promoInput)}>
                      {t("checkout.promo.apply")}
                    </Button>
                  </div>
                  {promoError ? <p className="field-error">{t(`checkout.error.${promoError}`)}</p> : null}
                </div>
              )}
            </div>

            <div className="mt-5 flex items-baseline justify-between border-t border-line pt-5">
              <span className="text-sm text-fg-muted">{t("checkout.total")}</span>
              <span className="text-2xl font-semibold tracking-tight tabular">{quote ? money(quote.total) : "—"}</span>
            </div>

            {stockError || orderError ? (
              <div className="mt-4 flex gap-2.5 rounded-xl border border-danger/25 bg-danger-soft px-3.5 py-3 text-[13px] text-danger" role="alert">
                <CircleAlert className="mt-0.5 size-4 shrink-0" />
                {t(`checkout.error.${(orderError ?? stockError) as CheckoutError}`)}
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="lg" className="mt-5 w-full" loading={submitting} disabled={!canBuy || updating}>
              <Lock className="size-4" />
              {quote?.total === 0 ? t("checkout.getFree") : t("checkout.pay", { amount: quote ? money(quote.total) : "" })}
            </Button>
            <p className="mt-3 text-center text-xs leading-5 text-fg-subtle">{t("checkout.terms")}</p>
          </div>
        </aside>
      </Form>
    </div>
  );
}

function StepTitle({ index, title }: { index: number; title: string }) {
  return (
    <h2 className="flex items-center gap-3 text-base font-semibold">
      <span className="grid size-6 place-items-center rounded-full bg-accent-soft font-mono text-xs text-accent-strong">{index}</span>
      {title}
    </h2>
  );
}
