import { ArrowRight, BookOpen, ChevronRight, Clock, Globe, ListChecks, Minus, Plus, ShieldCheck, Zap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { FaqList } from "~/components/store/faq-list";
import { Price } from "~/components/store/price";
import { ProductCard } from "~/components/store/product-card";
import { ProductCover } from "~/components/store/product-cover";
import { RichText } from "~/components/store/rich-text";
import { StockIndicator } from "~/components/store/stock-indicator";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { useLocale, useT } from "~/i18n/react";
import { cn } from "~/lib/format";
import { parseLocalized, pickText } from "~/lib/localized";
import { discountPercent, formatMoney } from "~/lib/money";
import { rootData, seo } from "~/lib/seo";
import { getProductDetail, getRelatedProducts } from "~/server/catalog.server";
import { getRequestContext } from "~/server/context";
import { queryFirst } from "~/server/db.server";
import { notFound } from "~/server/http.server";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import { quantityDiscountPercent } from "~/lib/pricing";
import type { Route } from "./+types/product";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const product = await getProductDetail(env.DB, params.slug, locale);
  if (!product) notFound();
  const [related, instruction] = await Promise.all([
    getRelatedProducts(env.DB, { id: product.id, categorySlug: product.categorySlug }, locale),
    product.instructionSlug
      ? queryFirst<{ summary: string }>(env.DB, "SELECT summary FROM instructions WHERE slug = ? AND is_published = 1", product.instructionSlug)
      : Promise.resolve(null),
  ]);
  return { product, related, instructionSummary: instruction ? pickText(parseLocalized(instruction.summary), locale) : "" };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  const product = loaderData?.product;
  if (!product) return seo(root, { title: "404", path: "/", noindex: true });
  const url = `${root?.siteUrl ?? ""}/product/${product.slug}`;
  const inStock = product.stock === null || product.stock > 0;
  return seo(root, {
    title: product.seoTitle,
    description: product.seoDescription,
    path: `/product/${product.slug}`,
    image: product.thumbnailUrl,
    type: "product",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        description: product.seoDescription,
        image: product.thumbnailUrl ? [product.thumbnailUrl.startsWith("http") ? product.thumbnailUrl : `${root?.siteUrl}${product.thumbnailUrl}`] : undefined,
        sku: product.slug,
        category: product.categoryName ?? undefined,
        brand: { "@type": "Brand", name: root?.settings.storeName },
        offers: {
          "@type": "Offer",
          url,
          priceCurrency: product.currency,
          price: (product.price / 100).toFixed(2),
          availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
          itemCondition: "https://schema.org/NewCondition",
        },
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: root?.settings.storeName, item: root?.siteUrl },
          ...(product.categorySlug ? [{ "@type": "ListItem", position: 2, name: product.categoryName, item: `${root?.siteUrl}/catalog/${product.categorySlug}` }] : []),
          { "@type": "ListItem", position: product.categorySlug ? 3 : 2, name: product.name, item: url },
        ],
      },
    ],
  });
};

function InfoRow({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 py-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
      <div className="min-w-0">
        <p className="text-xs text-fg-subtle">{label}</p>
        <p className="mt-0.5 text-[13.5px] leading-5 text-fg">{value}</p>
      </div>
    </div>
  );
}

export default function ProductPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const { product, related, instructionSummary } = loaderData;
  const firstAvailable = product.variants.find((variant) => variant.stock === null || variant.stock > 0) ?? product.variants[0];
  const [variantId, setVariantId] = useState<string | null>(firstAvailable?.id ?? null);
  const [quantity, setQuantity] = useState(product.minQuantity);
  const [activeImage, setActiveImage] = useState(0);

  const variant = product.variants.find((item) => item.id === variantId) ?? null;
  const unitPrice = variant?.price ?? product.price;
  const oldPrice = variant ? variant.oldPrice : product.oldPrice;
  const stock = variant ? variant.stock : product.variants.length ? 0 : product.stock;
  const maxQuantity = Math.max(product.minQuantity, Math.min(product.maxQuantity, stock ?? product.maxQuantity));
  const soldOut = stock !== null && stock < product.minQuantity;
  const percent = quantityDiscountPercent(product.quantityDiscounts, quantity);
  const subtotal = unitPrice * quantity;
  const total = subtotal - Math.floor((subtotal * percent) / 100);

  const images = useMemo(() => {
    const list = product.gallery.map((image) => image.url);
    if (product.thumbnailUrl && !list.includes(product.thumbnailUrl)) list.unshift(product.thumbnailUrl);
    return list;
  }, [product.gallery, product.thumbnailUrl]);

  const buy = () => {
    const params = new URLSearchParams({ qty: String(quantity) });
    if (variantId) params.set("variant", variantId);
    navigate(`/checkout/${product.slug}?${params.toString()}`);
  };

  const deliveryLabel = product.deliveryType === "manual" ? t("delivery.manual") : t("delivery.instant");

  return (
    <div className="page-container pt-6 sm:pt-10">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 overflow-hidden text-[13px] text-fg-subtle">
        <Link to="/catalog" className="shrink-0 transition-colors hover:text-fg">
          {t("nav.catalog")}
        </Link>
        {product.categorySlug ? (
          <>
            <ChevronRight className="size-3.5 shrink-0" />
            <Link to={`/catalog/${product.categorySlug}`} className="shrink-0 transition-colors hover:text-fg">
              {product.categoryName}
            </Link>
          </>
        ) : null}
        <ChevronRight className="size-3.5 shrink-0" />
        <span className="truncate text-fg-muted">{product.name}</span>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-6">
        <div className="min-w-0 space-y-3 lg:col-start-1">
          <div className="surface overflow-hidden">
            <ProductCover
              name={product.name}
              imageUrl={images[activeImage] ?? null}
              accent={product.accent}
              size="hero"
              priority
              className="aspect-[16/10] w-full"
            />
          </div>
          {images.length > 1 ? (
            <div className="flex gap-2 overflow-x-auto scrollbar-none">
              {images.map((url, index) => (
                <button
                  key={url}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`${product.name} ${index + 1}`}
                  className={cn("size-16 shrink-0 overflow-hidden rounded-lg border transition-colors", index === activeImage ? "border-accent" : "border-line hover:border-line-strong")}
                >
                  <img src={url} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-24 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="surface p-6 sm:p-7">
            <PurchasePanelHeader product={product} />

            <div className="mt-6 flex items-end justify-between gap-4">
              <Price amount={unitPrice} oldAmount={oldPrice} currency={product.currency} size="lg" />
              {discountPercent(unitPrice, oldPrice) ? <Badge tone="success">−{discountPercent(unitPrice, oldPrice)}%</Badge> : null}
            </div>
            <StockIndicator stock={stock} className="mt-3" />

            {product.variants.length > 0 ? (
              <fieldset className="mt-6">
                <legend className="field-label">{t("product.variant")}</legend>
                <div className="grid gap-2">
                  {product.variants.map((option) => {
                    const unavailable = option.stock !== null && option.stock <= 0;
                    return (
                      <label
                        key={option.id}
                        className={cn(
                          "flex cursor-pointer items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors",
                          variantId === option.id ? "border-accent/60 bg-accent-soft" : "border-line bg-panel-2/50 hover:border-line-strong",
                          unavailable && "cursor-not-allowed opacity-50",
                        )}
                      >
                        <span className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="variant"
                            value={option.id}
                            checked={variantId === option.id}
                            disabled={unavailable}
                            onChange={() => {
                              setVariantId(option.id);
                              setQuantity(product.minQuantity);
                            }}
                            className="size-4 accent-[var(--color-accent)]"
                          />
                          <span className="text-sm font-medium text-fg">{option.name}</span>
                        </span>
                        <span className="text-right">
                          <span className="block text-sm font-semibold tabular text-fg">{formatMoney(option.price, product.currency, locale)}</span>
                          {unavailable ? <span className="text-[11px] text-fg-subtle">{t("stock.out")}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            {maxQuantity > 1 && !soldOut ? (
              <div className="mt-6">
                <span className="field-label">{t("product.quantity")}</span>
                <div className="flex items-center gap-3">
                  <div className="inline-flex items-center rounded-xl border border-line-strong bg-panel-2">
                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => setQuantity((q) => Math.max(product.minQuantity, q - 1))} disabled={quantity <= product.minQuantity} aria-label={t("product.decrease")}>
                      <Minus className="size-4" />
                    </button>
                    <span className="w-10 text-center text-sm font-semibold tabular" aria-live="polite">
                      {quantity}
                    </span>
                    <button type="button" className="btn btn-ghost btn-icon" onClick={() => setQuantity((q) => Math.min(maxQuantity, q + 1))} disabled={quantity >= maxQuantity} aria-label={t("product.increase")}>
                      <Plus className="size-4" />
                    </button>
                  </div>
                  {percent > 0 ? <Badge tone="success">{t("product.bulkApplied", { percent })}</Badge> : null}
                </div>
                {product.quantityDiscounts.length > 0 ? (
                  <p className="mt-2 text-xs text-fg-subtle">
                    {product.quantityDiscounts.map((tier) => t("product.bulkTier", { qty: tier.minQuantity, percent: tier.percent })).join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="mt-6 flex items-center justify-between border-t border-line pt-5">
              <span className="text-sm text-fg-muted">{t("product.total")}</span>
              <span className="text-xl font-semibold tabular">{formatMoney(total, product.currency, locale)}</span>
            </div>

            <Button variant="primary" size="lg" className="mt-4 w-full" disabled={soldOut || (product.variants.length > 0 && !variant)} onClick={buy}>
              {soldOut ? t("stock.out") : t("product.buyNow")}
              {!soldOut ? <ArrowRight className="size-4" /> : null}
            </Button>
            <p className="mt-3 text-center text-xs text-fg-subtle">{t("product.guestNote")}</p>

            <div className="mt-6 divide-y divide-line border-t border-line">
              <InfoRow icon={Zap} label={t("product.delivery")} value={product.deliveryTime ? `${deliveryLabel} · ${product.deliveryTime}` : deliveryLabel} />
              <InfoRow icon={ShieldCheck} label={t("product.warranty")} value={product.warranty} />
              <InfoRow icon={Globe} label={t("product.region")} value={product.regionRestrictions} />
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
          {product.description ? (
            <section className="surface p-6 sm:p-8">
              <h2 className="text-lg font-semibold">{t("product.description")}</h2>
              <RichText text={product.description} className="mt-4" />
            </section>
          ) : null}

          {product.requirements ? (
            <section className="surface p-6 sm:p-8">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <ListChecks className="size-5 text-accent-strong" />
                {t("product.requirements")}
              </h2>
              <RichText text={product.requirements} className="mt-4" />
            </section>
          ) : null}

          {product.instructionSlug ? (
            <section className="surface relative overflow-hidden p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(60%_100%_at_100%_0%,rgba(124,108,255,0.12),transparent)]" aria-hidden="true" />
              <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="eyebrow flex items-center gap-2 text-accent-strong">
                    <BookOpen className="size-3.5" />
                    {t("product.instructions")}
                  </p>
                  <h2 className="mt-2 text-lg font-semibold">{product.instructionTitle}</h2>
                  {instructionSummary ? <p className="mt-1.5 text-sm leading-6 text-fg-muted">{instructionSummary}</p> : null}
                </div>
                <Link to={`/instructions/${product.instructionSlug}`} className="btn btn-secondary shrink-0">
                  {t("product.openGuide")}
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </section>
          ) : null}

          {product.faq.length > 0 ? (
            <section>
              <h2 className="mb-4 text-lg font-semibold">{t("product.faq")}</h2>
              <FaqList items={product.faq} />
            </section>
          ) : null}
        </div>

      </div>

      {related.length > 0 ? (
        <section className="mt-20">
          <h2 className="text-xl font-semibold tracking-tight">{t("product.related")}</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </div>
        </section>
      ) : null}

      {!soldOut ? (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/85 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-xl lg:hidden">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-fg-subtle">{product.name}</p>
              <p className="text-base font-semibold tabular">{formatMoney(total, product.currency, locale)}</p>
            </div>
            <Button variant="primary" onClick={buy} disabled={product.variants.length > 0 && !variant}>
              {t("product.buyNow")}
            </Button>
          </div>
        </div>
      ) : null}
      <div className="h-16 lg:hidden" aria-hidden="true" />
    </div>
  );
}

function PurchasePanelHeader({ product }: { product: Route.ComponentProps["loaderData"]["product"] }) {
  return (
    <div>
      {product.categoryName ? <p className="eyebrow text-accent-strong">{product.categoryName}</p> : null}
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-[28px] sm:leading-tight">{product.name}</h1>
      {product.shortDescription ? <p className="mt-2.5 text-[15px] leading-7 text-fg-muted">{product.shortDescription}</p> : null}
      {product.tags.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {product.tags.slice(0, 6).map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}
