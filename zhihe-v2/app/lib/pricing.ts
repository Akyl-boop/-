import type { QuantityDiscount } from "./domain";

export function quantityDiscountPercent(tiers: QuantityDiscount[], quantity: number): number {
  let percent = 0;
  for (const tier of tiers) if (quantity >= tier.minQuantity) percent = tier.percent;
  return percent;
}
