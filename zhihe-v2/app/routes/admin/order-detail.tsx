import { Ban, CheckCircle2, ExternalLink, KeyRound, Mail, PackageCheck, RefreshCw, Send, StickyNote, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { ConfirmAction } from "~/components/admin/confirm";
import { AdminPageHeader, Panel } from "~/components/admin/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { OrderStatusBadge, PaymentStatusBadge } from "~/components/ui/status-badge";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { cn, formatDateTime } from "~/lib/format";
import { parseLocalized, pickText } from "~/lib/localized";
import { formatMoney } from "~/lib/money";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { randomToken } from "~/server/crypto.server";
import { applyPayment, cancelUnpaidOrder, deliverManually, deliverOrder, markRefunded, notifyDelivered, sendOrderLinkEmail } from "~/server/fulfillment.server";
import { notFound } from "~/server/http.server";
import { isEmailConfigured } from "~/server/notify/email.server";
import { EVENT, eventStatement, getOrderById, loadOrderBundle, orderLink } from "~/server/orders.server";
import type { Route } from "./+types/order-detail";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env, db, locale } = await adminContext(context, request);
  const order = await getOrderById(db, params.id);
  if (!order) notFound();
  const bundle = await loadOrderBundle(db, order);
  return {
    order: { ...bundle.order, access_salt: undefined },
    items: bundle.items.map((item) => ({
      ...item,
      name: pickText(parseLocalized(item.product_name), locale),
      variant: item.variant_name ? pickText(parseLocalized(item.variant_name), locale) : null,
      units: bundle.units.filter((unit) => unit.order_item_id === item.id),
    })),
    payments: bundle.payments,
    events: bundle.events,
    customerLink: await orderLink(env, order),
    canEmail: isEmailConfigured(env),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx, db, admin, t } = await adminContext(context, request);
  const order = await getOrderById(db, params.id);
  if (!order) notFound();
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const actor = `admin:${admin.email}`;
  const log = (action: string, summary = "") => auditStatement(db, request, admin, { action, entityType: "order", entityId: order.id, summary: `${order.number} ${summary}`.trim() }).run();

  switch (intent) {
    case "approve_payment": {
      const reference = String(form.get("reference") ?? "").trim().slice(0, 200) || null;
      const result = await applyPayment(env, ctx, { orderId: order.id, actor, reference: reference ?? "manual approval" });
      if (!result.applied) return fail(t("admin.order.error.notPayable"));
      await log("order.approve_payment", reference ?? "");
      return ok(t("admin.order.approved"));
    }
    case "retry_delivery": {
      await deliverOrder(env, ctx, order.id, actor);
      await log("order.retry_delivery");
      return ok(t("admin.order.deliveryRetried"));
    }
    case "deliver_manual": {
      const itemId = String(form.get("itemId") ?? "");
      const content = String(form.get("content") ?? "").trim().slice(0, 20_000);
      if (!content) return fail(t("admin.order.error.contentRequired"));
      const done = await deliverManually(env, ctx, order.id, itemId, content, actor);
      if (!done) return fail(t("admin.order.error.cannotDeliver"));
      await log("order.deliver_manual");
      return ok(t("admin.order.delivered"));
    }
    case "resend": {
      const sent = order.status === "completed" ? await notifyDelivered(env, order.id).then(() => true) : await sendOrderLinkEmail(env, order);
      await db.batch([eventStatement(db, order.id, EVENT.deliveryResent, { actor, internal: true })]);
      await log("order.resend");
      return sent ? ok(t("admin.order.resent")) : fail(t("admin.order.error.email"));
    }
    case "cancel": {
      const done = await cancelUnpaidOrder(env, order.id, { actor, reason: "cancelled", message: String(form.get("reason") ?? "").slice(0, 300) });
      if (!done) return fail(t("admin.order.error.cannotCancel"));
      await log("order.cancel");
      return ok(t("admin.order.cancelled"));
    }
    case "refund": {
      const done = await markRefunded(env, order.id, actor, String(form.get("reason") ?? "").slice(0, 300));
      if (!done) return fail(t("admin.order.error.cannotRefund"));
      await log("order.refund");
      return ok(t("admin.order.refunded"));
    }
    case "complete": {
      const now = Date.now();
      const result = await db
        .prepare("UPDATE orders SET status = 'completed', completed_at = ?1, delivered_at = COALESCE(delivered_at, ?1), updated_at = ?1 WHERE id = ?2 AND status IN ('paid', 'processing')")
        .bind(now, order.id)
        .run();
      if (!result.meta.changes) return fail(t("admin.order.error.cannotComplete"));
      await db.batch([eventStatement(db, order.id, EVENT.completed, { actor })]);
      await log("order.complete");
      return ok(t("admin.order.completed"));
    }
    case "note": {
      const note = String(form.get("note") ?? "").trim().slice(0, 2000);
      if (!note) return fail(t("admin.order.error.noteRequired"));
      await db.batch([eventStatement(db, order.id, EVENT.note, { actor, message: note, internal: true })]);
      return ok(t("admin.order.noteAdded"));
    }
    case "rotate_link": {
      await db.prepare("UPDATE orders SET access_salt = ?, updated_at = ? WHERE id = ?").bind(randomToken(16), Date.now(), order.id).run();
      await log("order.rotate_link");
      return ok(t("admin.order.linkRotated"));
    }
    default:
      return fail(t("error.generic"));
  }
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 py-2 text-[13px]">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className={cn("min-w-0 text-right break-words text-fg-muted", mono && "font-mono text-xs")}>{children}</dd>
    </div>
  );
}

export default function OrderDetail({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { order, items, payments, events, customerLink, canEmail } = loaderData;
  const money = (value: number) => formatMoney(value, order.currency, locale);
  const fetcher = useFetcher<ActionFeedback>();
  const noteRef = useRef<HTMLFormElement>(null);
  useFeedbackToast(fetcher.data);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) noteRef.current?.reset();
  }, [fetcher.state, fetcher.data]);

  const unpaid = ["pending", "waiting_payment", "failed", "cancelled"].includes(order.status);
  const paid = ["paid", "processing", "completed"].includes(order.status);
  const needsDelivery = items.some((item) => item.delivered_quantity < item.quantity);
  const payment = payments[0];
  const busy = (intent: string) => fetcher.state !== "idle" && fetcher.formData?.get("intent") === intent;

  return (
    <>
      <AdminPageHeader
        back={{ to: "/admin/orders", label: t("admin.nav.orders") }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{order.number}</span>
            <OrderStatusBadge status={order.status} />
          </span>
        }
        description={`${t("admin.order.created")} ${formatDateTime(order.created_at, locale)}`}
        actions={
          <>
            <CopyButton value={customerLink} label={t("admin.order.copyLink")} />
            <a href={customerLink} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              <ExternalLink className="size-3.5" />
              {t("admin.order.openAsCustomer")}
            </a>
          </>
        }
      />

      {unpaid && payment?.tx_reference ? (
        <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-info/25 bg-info-soft p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            <p className="font-medium text-fg">{t("admin.order.referenceSubmitted")}</p>
            <p className="mt-0.5 font-mono text-xs break-all text-fg-muted">{payment.tx_reference}</p>
          </div>
          <ConfirmAction intent="approve_payment" fields={{ reference: payment.tx_reference }} variant="primary" title={t("admin.order.approveTitle")} description={t("admin.order.approveText", { amount: money(order.total) })} confirmLabel={t("admin.order.approve")}>
            <CheckCircle2 className="size-4" />
            {t("admin.order.approve")}
          </ConfirmAction>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Panel title={t("admin.order.items")} bodyClassName="divide-y divide-line">
            {items.map((item) => (
              <div key={item.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {item.name}
                      {item.variant ? <span className="text-fg-subtle"> · {item.variant}</span> : null}
                    </p>
                    <p className="mt-1 text-xs text-fg-subtle">
                      {money(item.unit_price)} × {item.quantity} · {t(`admin.delivery.${item.delivery_type}`)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular">{money(item.total)}</p>
                    <Badge tone={item.delivered_quantity >= item.quantity ? "success" : paid ? "warning" : "neutral"} className="mt-1">
                      {t("admin.order.deliveredCount", { done: item.delivered_quantity, total: item.quantity })}
                    </Badge>
                  </div>
                </div>
                {item.units.length > 0 ? (
                  <ul className="mt-4 space-y-1.5">
                    {item.units.map((unit) => (
                      <li key={unit.id} className="flex items-center gap-2 rounded-lg border border-line bg-canvas/60 py-1.5 pr-1.5 pl-3">
                        <KeyRound className="size-3.5 shrink-0 text-fg-subtle" />
                        <code className="min-w-0 flex-1 truncate font-mono text-xs">{unit.content}</code>
                        <span className="hidden text-[11px] text-fg-subtle sm:inline">{formatDateTime(unit.sold_at, locale)}</span>
                        <CopyButton value={unit.content} className="h-7 px-2" />
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.delivery_content ? (
                  <pre className="mt-4 rounded-lg border border-line bg-canvas/60 p-3 font-mono text-xs whitespace-pre-wrap break-all">{item.delivery_content}</pre>
                ) : null}
                {paid && item.delivery_type !== "inventory" && item.delivered_quantity < item.quantity ? (
                  <fetcher.Form method="post" className="mt-4 space-y-2">
                    <input type="hidden" name="intent" value="deliver_manual" />
                    <input type="hidden" name="itemId" value={item.id} />
                    <label className="field-label" htmlFor={`content-${item.id}`}>
                      {t("admin.order.manualDelivery")}
                    </label>
                    <textarea id={`content-${item.id}`} name="content" rows={3} className="input font-mono text-[13px]" placeholder={t("admin.order.manualPlaceholder")} required />
                    <Button type="submit" variant="primary" size="sm" loading={busy("deliver_manual")}>
                      <PackageCheck className="size-3.5" />
                      {t("admin.order.deliver")}
                    </Button>
                  </fetcher.Form>
                ) : null}
              </div>
            ))}
            <div className="space-y-1.5 bg-panel-2/40 p-5 text-sm">
              <div className="flex justify-between text-fg-muted">
                <span>{t("admin.order.subtotal")}</span>
                <span className="tabular">{money(order.subtotal)}</span>
              </div>
              {order.discount_total > 0 ? (
                <div className="flex justify-between text-success">
                  <span>
                    {t("admin.order.discount")}
                    {order.promo_code ? ` · ${order.promo_code}` : ""}
                  </span>
                  <span className="tabular">−{money(order.discount_total)}</span>
                </div>
              ) : null}
              <div className="flex justify-between pt-1 text-base font-semibold">
                <span>{t("checkout.total")}</span>
                <span className="tabular">{money(order.total)}</span>
              </div>
            </div>
          </Panel>

          <Panel title={t("admin.order.payment")}>
            <dl className="divide-y divide-line">
              <Field label={t("admin.orders.col.method")}>{t(`payment.method.${order.payment_method}`)}</Field>
              <Field label={t("admin.order.paymentStatus")}>
                <PaymentStatusBadge status={order.payment_status} />
              </Field>
              {payment?.provider_ref ? <Field label={t("admin.order.providerRef")} mono>{payment.provider_ref}</Field> : null}
              {payment?.tx_reference ? <Field label={t("admin.order.reference")} mono>{payment.tx_reference}</Field> : null}
              <Field label={t("admin.order.paidAt")}>{formatDateTime(order.paid_at, locale)}</Field>
              <Field label={t("admin.order.deliveredAt")}>{formatDateTime(order.delivered_at, locale)}</Field>
              {order.expires_at ? <Field label={t("admin.order.expiresAt")}>{formatDateTime(order.expires_at, locale)}</Field> : null}
            </dl>
          </Panel>

          <Panel title={t("admin.order.timeline")}>
            <ol className="space-y-0">
              {events.map((event, index) => (
                <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
                  {index < events.length - 1 ? <span className="absolute top-4 bottom-0 left-[5px] w-px bg-line-strong" aria-hidden="true" /> : null}
                  <span className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full border-2", event.type === "note" ? "border-warning bg-warning/30" : event.is_internal ? "border-line-strong bg-panel-3" : "border-accent bg-accent/30")} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-[13px] font-medium">{t(`admin.event.${event.type}` as never) || event.type}</p>
                      <p className="text-xs text-fg-subtle">{formatDateTime(event.created_at, locale)}</p>
                    </div>
                    {event.message ? <p className="mt-1 text-[13px] break-words whitespace-pre-wrap text-fg-muted">{event.message}</p> : null}
                    <p className="mt-0.5 text-[11px] text-fg-subtle">{event.actor}</p>
                  </div>
                </li>
              ))}
            </ol>
            <fetcher.Form ref={noteRef} method="post" className="mt-6 flex flex-col gap-2 border-t border-line pt-5 sm:flex-row">
              <input type="hidden" name="intent" value="note" />
              <input name="note" className="input" placeholder={t("admin.order.notePlaceholder")} aria-label={t("admin.order.addNote")} required maxLength={2000} />
              <Button type="submit" loading={busy("note")}>
                <StickyNote className="size-4" />
                {t("admin.order.addNote")}
              </Button>
            </fetcher.Form>
          </Panel>
        </div>

        <aside className="space-y-6 xl:sticky xl:top-24 xl:self-start">
          <Panel title={t("admin.order.customer")}>
            <dl className="divide-y divide-line">
              <Field label="Email">
                <a href={`/admin/orders?customer=${encodeURIComponent(order.email)}`} className="hover:text-fg">
                  {order.email}
                </a>
              </Field>
              <Field label="Telegram">
                {order.telegram ? (
                  <a href={`https://t.me/${order.telegram}`} target="_blank" rel="noopener noreferrer" className="hover:text-fg">
                    @{order.telegram}
                  </a>
                ) : (
                  "—"
                )}
              </Field>
              <Field label={t("admin.order.language")}>{order.locale.toUpperCase()}</Field>
              <Field label="IP" mono>
                {order.ip ?? "—"}
              </Field>
            </dl>
          </Panel>

          <Panel title={t("admin.order.actions")} bodyClassName="grid gap-2 p-5">
            {unpaid ? (
              <ConfirmAction
                intent="approve_payment"
                variant="primary"
                title={t("admin.order.approveTitle")}
                description={t("admin.order.approveText", { amount: money(order.total) })}
                confirmLabel={t("admin.order.approve")}
                extra={<input name="reference" className="input mb-2 font-mono text-xs sm:mb-0" placeholder={t("admin.order.referenceOptional")} defaultValue={payment?.tx_reference ?? ""} />}
              >
                <CheckCircle2 className="size-4" />
                {t("admin.order.markPaid")}
              </ConfirmAction>
            ) : null}
            {paid && needsDelivery ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="retry_delivery" />
                <Button type="submit" className="w-full" loading={busy("retry_delivery")}>
                  <RefreshCw className="size-4" />
                  {t("admin.order.retryDelivery")}
                </Button>
              </fetcher.Form>
            ) : null}
            {order.status === "processing" || order.status === "paid" ? (
              <ConfirmAction intent="complete" title={t("admin.order.completeTitle")} description={t("admin.order.completeText")} confirmLabel={t("admin.order.complete")}>
                <CheckCircle2 className="size-4" />
                {t("admin.order.complete")}
              </ConfirmAction>
            ) : null}
            {canEmail ? (
              <fetcher.Form method="post">
                <input type="hidden" name="intent" value="resend" />
                <Button type="submit" className="w-full" loading={busy("resend")}>
                  <Mail className="size-4" />
                  {t("admin.order.resend")}
                </Button>
              </fetcher.Form>
            ) : null}
            {order.telegram ? (
              <a href={`https://t.me/${order.telegram}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full">
                <Send className="size-4" />
                {t("admin.order.messageCustomer")}
              </a>
            ) : null}
            <ConfirmAction intent="rotate_link" title={t("admin.order.rotateTitle")} description={t("admin.order.rotateText")} confirmLabel={t("admin.order.rotate")}>
              <KeyRound className="size-4" />
              {t("admin.order.rotate")}
            </ConfirmAction>
            {order.status === "pending" || order.status === "waiting_payment" ? (
              <ConfirmAction intent="cancel" danger variant="danger" title={t("admin.order.cancelTitle")} description={t("admin.order.cancelText")} confirmLabel={t("admin.order.cancel")}>
                <Ban className="size-4" />
                {t("admin.order.cancel")}
              </ConfirmAction>
            ) : null}
            {paid ? (
              <ConfirmAction intent="refund" danger variant="danger" title={t("admin.order.refundTitle")} description={t("admin.order.refundText")} confirmLabel={t("admin.order.refund")}>
                <Undo2 className="size-4" />
                {t("admin.order.refund")}
              </ConfirmAction>
            ) : null}
          </Panel>
        </aside>
      </div>
    </>
  );
}
