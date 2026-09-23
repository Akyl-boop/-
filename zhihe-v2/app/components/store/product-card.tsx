import { ArrowUpRight, Zap } from "lucide-react";
import { Link } from "react-router";
import { Badge } from "~/components/ui/badge";
import { useT } from "~/i18n/react";
import type { ProductCardData } from "~/lib/domain";
import { cn } from "~/lib/format";
import { discountPercent } from "~/lib/money";
import { Price } from "./price";
import { ProductCover } from "./product-cover";
import { StockIndicator } from "./stock-indicator";

export function ProductCard({ product, priority = false, className }: { product: ProductCardData; priority?: boolean; className?: string }) {
  const t = useT();
  const discount = discountPercent(product.price, product.oldPrice);
  const soldOut = product.stock !== null && product.stock <= 0;
  return (
    <Link
      to={`/product/${product.slug}`}
      prefetch="intent"
      className={cn(
        "group surface surface-hover relative flex flex-col overflow-hidden hover:-translate-y-0.5 focus-visible:-translate-y-0.5",
        soldOut && "opacity-75",
        className,
      )}
    >
      <div className="relative">
        <ProductCover name={product.name} imageUrl={product.thumbnailUrl} accent={product.accent} className="aspect-[16/10] w-full" priority={priority} />
        <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
          {product.isPopular ? (
            <Badge tone="accent" className="border-white/10 bg-black/40 text-white backdrop-blur-md">
              {t("product.popular")}
            </Badge>
          ) : null}
          {discount ? <Badge className="border-white/10 bg-black/40 text-white backdrop-blur-md">−{discount}%</Badge> : null}
        </div>
        <span className="absolute top-3 right-3 grid size-8 translate-y-1 place-items-center rounded-full border border-white/15 bg-black/40 text-white opacity-0 backdrop-blur-md transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <ArrowUpRight className="size-4" />
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        {product.categoryName ? <p className="eyebrow mb-2">{product.categoryName}</p> : null}
        <h3 className="text-[15px] font-semibold leading-snug text-fg">{product.name}</h3>
        {product.shortDescription ? <p className="mt-1.5 line-clamp-2 text-[13px] leading-5 text-fg-muted">{product.shortDescription}</p> : null}
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <Price amount={product.price} oldAmount={product.oldPrice} currency={product.currency} from={product.hasVariants ? t("product.from") : undefined} />
          <div className="flex flex-col items-end gap-1">
            <StockIndicator stock={product.stock} />
            {product.deliveryType !== "manual" ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-fg-subtle">
                <Zap className="size-3" />
                {t("delivery.instant")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="surface overflow-hidden">
      <div className="skeleton aspect-[16/10] rounded-none" />
      <div className="space-y-3 p-5">
        <div className="skeleton h-3 w-20" />
        <div className="skeleton h-4 w-3/4" />
        <div className="skeleton h-3 w-full" />
        <div className="flex justify-between pt-4">
          <div className="skeleton h-5 w-16" />
          <div className="skeleton h-3 w-14" />
        </div>
      </div>
    </div>
  );
}
