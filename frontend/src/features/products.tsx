import { Badge } from "@/components/ui/misc";
import { number } from "@/lib/utils";

export const PRODUCT_STATUSES = [
  { value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "hidden", label: "Hidden" },
  { value: "out_of_stock", label: "Out of stock" }, { value: "archived", label: "Archived" },
];

export function StockCell({ stock, threshold = 5 }: { stock: number | null; threshold?: number }) {
  if (stock === null) return <span className="text-fg-3">∞ Unlimited</span>;
  if (stock === 0) return <Badge tone="danger">Out of stock</Badge>;
  if (stock <= threshold) return <Badge tone="warning">{stock} left</Badge>;
  return <span className="tabular">{number(stock)}</span>;
}

