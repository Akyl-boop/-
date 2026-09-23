import { useT } from "~/i18n/react";
import type { OrderStatus, PaymentStatus } from "~/lib/domain";
import { Badge, type Tone } from "./badge";

const ORDER_TONES: Record<OrderStatus, Tone> = {
  pending: "neutral",
  waiting_payment: "warning",
  paid: "info",
  processing: "accent",
  completed: "success",
  cancelled: "neutral",
  refunded: "danger",
  failed: "danger",
};

const PAYMENT_TONES: Record<PaymentStatus, Tone> = {
  unpaid: "neutral",
  pending: "warning",
  paid: "success",
  refunded: "danger",
  failed: "danger",
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const t = useT();
  return (
    <Badge tone={ORDER_TONES[status]} dot className={className}>
      {t(`status.${status}`)}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const t = useT();
  return (
    <Badge tone={PAYMENT_TONES[status]} dot>
      {t(`paymentStatus.${status}`)}
    </Badge>
  );
}
