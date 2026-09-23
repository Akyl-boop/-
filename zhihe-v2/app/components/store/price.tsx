import { useLocale } from "~/i18n/react";
import { cn } from "~/lib/format";
import { formatMoney } from "~/lib/money";

export function Price({ amount, oldAmount, currency, className, size = "md", from }: { amount: number; oldAmount?: number | null; currency: string; className?: string; size?: "sm" | "md" | "lg"; from?: string }) {
  const locale = useLocale();
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-2 tabular", className)}>
      {from ? <span className="text-xs text-fg-subtle">{from}</span> : null}
      <span className={cn("font-semibold tracking-tight text-fg", size === "lg" ? "text-3xl" : size === "sm" ? "text-sm" : "text-lg")}>{formatMoney(amount, currency, locale)}</span>
      {oldAmount && oldAmount > amount ? (
        <span className={cn("text-fg-subtle line-through decoration-fg-subtle/60", size === "lg" ? "text-base" : "text-xs")}>{formatMoney(oldAmount, currency, locale)}</span>
      ) : null}
    </span>
  );
}
