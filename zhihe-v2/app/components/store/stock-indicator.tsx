import { useT } from "~/i18n/react";
import { cn } from "~/lib/format";

export function StockIndicator({ stock, className }: { stock: number | null; className?: string }) {
  const t = useT();
  const state = stock === null || stock > 5 ? "in" : stock > 0 ? "low" : "out";
  const label = state === "in" ? t("stock.inStock") : state === "low" ? t("stock.low", { count: stock ?? 0 }) : t("stock.out");
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", state === "in" ? "text-success" : state === "low" ? "text-warning" : "text-fg-subtle", className)}>
      <span className="relative flex size-1.5">
        {state === "in" ? <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-40" /> : null}
        <span className="relative inline-flex size-1.5 rounded-full bg-current" />
      </span>
      {label}
    </span>
  );
}
