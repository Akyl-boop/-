import { Badge, type Tone } from "@/components/ui/misc";
import { titleCase } from "@/lib/utils";

const MAP: Record<string, [Tone, string]> = {
  // orders
  pending: ["neutral", "Pending"], awaiting_payment: ["warning", "Awaiting payment"],
  awaiting_confirmation: ["info", "Verifying payment"], paid: ["success", "Paid"], processing: ["info", "Processing"],
  completed: ["success", "Completed"], cancelled: ["neutral", "Cancelled"], expired: ["neutral", "Expired"],
  failed: ["danger", "Failed"], refunded: ["danger", "Refunded"], partially_refunded: ["warning", "Partially refunded"],
  // delivery
  delivered: ["success", "Delivered"], partial: ["warning", "Partial"], manual: ["warning", "Manual"],
  // products
  active: ["success", "Active"], draft: ["neutral", "Draft"], hidden: ["neutral", "Hidden"], out_of_stock: ["danger", "Out of stock"],
  archived: ["neutral", "Archived"],
  // inventory
  available: ["success", "Available"], reserved: ["warning", "Reserved"], invalid: ["danger", "Invalid"], disabled: ["neutral", "Disabled"],
  // tickets
  open: ["info", "Open"], waiting_customer: ["neutral", "Waiting for customer"], waiting_admin: ["warning", "Waiting for admin"],
  resolved: ["success", "Resolved"], closed: ["neutral", "Closed"],
  // broadcasts
  scheduled: ["info", "Scheduled"], sending: ["accent", "Sending"],
  // reviews
  approved: ["success", "Approved"],
  // recipients
  sent: ["success", "Sent"], blocked: ["danger", "Blocked"],
  success: ["success", "Delivered"],
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const [tone, text] = MAP[status] ?? ["neutral", titleCase(status)];
  return <Badge tone={tone} dot>{label ?? text}</Badge>;
}

export function statusLabel(status: string) {
  return MAP[status]?.[1] ?? titleCase(status);
}

export const ORDER_STATUSES = ["pending", "awaiting_payment", "awaiting_confirmation", "paid", "processing", "completed",
  "cancelled", "expired", "failed", "refunded", "partially_refunded"];
