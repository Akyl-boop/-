import { ArrowUpRight, BookOpen, CheckCircle2, CircleAlert, Clock, Download, ExternalLink, Hourglass, Mail, PackageCheck, RefreshCw, Send, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useFetcher, useRevalidator, useSearchParams } from "react-router";
import { InstructionView } from "~/components/store/instruction-view";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { OrderStatusBadge } from "~/components/ui/status-badge";
import { useFeedbackToast } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import type { StoreMessageKey } from "~/i18n/messages";
import { cn, formatDateTime } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import { rememberOrder } from "~/lib/recent-orders";
import { useRootData } from "~/lib/root-data";
import { metaT, rootData, seo } from "~/lib/seo";
import { getRequestContext } from "~/server/context";
import { sendOrderLinkEmail } from "~/server/fulfillment.server";
import { notFound } from "~/server/http.server";
import { isEmailConfigured } from "~/server/notify/email.server";
import { buildCustomerOrderView } from "~/server/order-view.server";
import { getOrderByAccessKey, loadOrderBundle } from "~/server/orders.server";
import { reconcileOrderPayment, submitManualPayment } from "~/server/payments/confirm.server";
import { resolveLocale, serverT } from "~/server/locale.server";
import { hitRateLimit } from "~/server/rate-limit.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/order";

async function authorize(request: Request, params: { number: string }, env: Env) {
  const key = new URL(request.url).searchParams.get("key");
  const order = await getOrderByAccessKey(env, params.number, key);
  if (!order) notFound();
  return order;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const order = await authorize(request, params, env);
  const bundle = await loadOrderBundle(env.DB, order);
  const view = await buildCustomerOrderView(env.DB, bundle, locale);
  return { order: view, canEmail: isEmailConfigured(env), manualInstructions: settings.payments.manualInstructions[locale] ?? settings.payments.manualInstructions.en ?? "" };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  return seo(root, { title: `${metaT(root, "order.title")} ${loaderData?.order.number ?? ""}`, path: "/orders", noindex: true });
};

export async function action({ request, params, context }: Route.ActionArgs) {
  const { env, ctx } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const order = await authorize(request, params, env);
  const form = await request.formData();
  const intent = form.get("intent");
  const limit = await hitRateLimit(env.DB, `order:${order.id}:${intent}`, 6, 10 * 60 * 1000);
  if (!limit.allowed) return { ok: false, error: serverT(locale, "error.rateLimited") };

  if (intent === "check") {
    const paid = await reconcileOrderPayment(env, ctx, order);
    return paid ? { ok: true, message: serverT(locale, "order.check.paid") } : { ok: true, message: serverT(locale, "order.check.pending") };
  }
  if (intent === "submit_reference") {
    const reference = String(form.get("reference") ?? "").trim();
    if (reference.length < 6 || reference.length > 200) return { ok: false, error: serverT(locale, "order.manual.invalid") };
    const saved = await submitManualPayment(env, ctx, order, reference);
    return saved ? { ok: true, message: serverT(locale, "order.manual.submitted") } : { ok: false, error: serverT(locale, "error.generic") };
  }
  if (intent === "email_link") {
    const sent = await sendOrderLinkEmail(env, order);
    return sent ? { ok: true, message: serverT(locale, "order.email.sent") } : { ok: false, error: serverT(locale, "error.generic") };
  }
  return { ok: false, error: serverT(locale, "error.generic") };
}

const TIMELINE_LABELS: Record<string, StoreMessageKey> = {
  created: "timeline.created",
  payment_pending: "timeline.payment_pending",
  payment_submitted: "timeline.payment_submitted",
  payment_received: "timeline.payment_received",
  delivered: "timeline.delivered",
  awaiting_fulfillment: "timeline.awaiting_fulfillment",
  completed: "timeline.completed",
  cancelled: "timeline.cancelled",
  expired: "timeline.expired",
  refunded: "timeline.refunded",
  failed: "timeline.failed",
};

function useCountdown(target: number | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [target]);
  if (!target) return null;
  const remaining = Math.max(0, target - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function OrderPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { settings } = useRootData();
  const { order, canEmail, manualInstructions } = loaderData;
  const [searchParams] = useSearchParams();
  const key = searchParams.get("key") ?? "";
  const isNew = searchParams.get("new") === "1";
  const fetcher = useFetcher<typeof action>();
  const revalidator = useRevalidator();
  const countdown = useCountdown(order.expiresAt);
  const money = (value: number) => formatMoney(value, order.currency, locale);
  const waiting = order.status === "waiting_payment" || order.status === "pending";
  const fulfilled = ["paid", "processing", "completed", "refunded"].includes(order.status);
  useFeedbackToast(fetcher.data);

  useEffect(() => {
    rememberOrder({
      number: order.number,
      key,
      product: order.items.map((item) => item.name).join(", "),
      total: money(order.total),
      status: order.status,
      createdAt: order.createdAt,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.number, order.status, key]);

  useEffect(() => {
    if (!waiting && order.status !== "paid" && order.status !== "processing") return;
    const interval = order.paymentMethod === "cryptobot" && waiting ? 5000 : 20000;
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch(`/api/order-status/${order.number}?key=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" } });
        if (!response.ok) return;
        const data = (await response.json()) as { status: string; delivered: number };
        const deliveredNow = order.items.reduce((sum, item) => sum + item.deliveredQuantity, 0);
        if (data.status !== order.status || data.delivered !== deliveredNow) revalidator.revalidate();
      } catch {
        // network hiccup; next tick retries
      }
    }, interval);
    return () => window.clearInterval(timer);
  }, [waiting, order.status, order.paymentMethod, order.number, order.items, key, revalidator]);

  const [shareLink, setShareLink] = useState("");
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    setShareLink(url.toString());
  }, []);

  const allUnits = useMemo(() => order.items.flatMap((item) => item.units), [order.items]);
  const downloadUnits = () => {
    const blob = new Blob([allUnits.join("\n") + "\n"], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${order.number}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="page-container pt-8 sm:pt-12">
      {isNew && waiting ? (
        <div className="mb-6 flex animate-rise items-start gap-3 rounded-2xl border border-success/25 bg-success-soft px-5 py-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
          <div>
            <p className="font-medium text-fg">{t("order.created.title")}</p>
            <p className="mt-0.5 text-sm text-fg-muted">{t("order.created.text")}</p>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">{t("order.title")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-semibold tracking-tight sm:text-3xl">{order.number}</h1>
            <OrderStatusBadge status={order.status} />
          </div>
          <p className="mt-2 text-sm text-fg-subtle">
            {t("order.placed")} {formatDateTime(order.createdAt, locale)}
          </p>
        </div>
        <div className="flex gap-2">
          <CopyButton value={shareLink} label={t("order.copyLink")} />
          {canEmail ? (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="email_link" />
              <Button type="submit" size="sm" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "email_link"}>
                <Mail className="size-3.5" />
                {t("order.emailLink")}
              </Button>
            </fetcher.Form>
          ) : null}
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_360px] lg:gap-8">
        <div className="min-w-0 space-y-6">
          {waiting && order.paymentMethod === "cryptobot" && order.payment?.payUrl ? (
            <section className="surface relative overflow-hidden p-6 sm:p-8">
              <div className="absolute inset-0 bg-[radial-gradient(70%_100%_at_100%_0%,rgba(124,108,255,0.14),transparent)]" aria-hidden="true" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold">{t("order.pay.title")}</h2>
                    <p className="mt-1 text-sm text-fg-muted">{t("order.pay.text")}</p>
                  </div>
                  {countdown ? (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 font-mono text-xs text-fg-muted tabular">
                      <Clock className="size-3.5" />
                      {countdown}
                    </span>
                  ) : null}
                </div>
                <p className="mt-6 text-3xl font-semibold tracking-tight tabular">{money(order.total)}</p>
                {order.payment.network === "testnet" ? <p className="mt-1 text-xs text-warning">{t("order.pay.testnet")}</p> : null}
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <a href={order.payment.payUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
                    {t("order.pay.cta")}
                    <ExternalLink className="size-4" />
                  </a>
                  <fetcher.Form method="post">
                    <input type="hidden" name="intent" value="check" />
                    <Button type="submit" size="lg" className="w-full" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "check"}>
                      <RefreshCw className="size-4" />
                      {t("order.pay.check")}
                    </Button>
                  </fetcher.Form>
                </div>
                <p className="mt-4 flex items-center gap-2 text-xs text-fg-subtle">
                  <ShieldCheck className="size-3.5" />
                  {t("order.pay.auto")}
                </p>
              </div>
            </section>
          ) : null}

          {waiting && order.paymentMethod === "manual_crypto" ? (
            <section className="surface p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold">
                    <Wallet className="size-5 text-accent-strong" />
                    {t("order.manual.title")}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-fg-muted">{manualInstructions}</p>
                </div>
                {countdown ? (
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2.5 py-1 font-mono text-xs text-fg-muted tabular">
                    <Clock className="size-3.5" />
                    {countdown}
                  </span>
                ) : null}
              </div>
              <div className="mt-6 flex items-center justify-between rounded-xl border border-line bg-canvas/60 px-4 py-3">
                <span className="text-sm text-fg-muted">{t("order.manual.amount")}</span>
                <span className="text-xl font-semibold tabular">{money(order.total)}</span>
              </div>
              <div className="mt-4 space-y-3">
                {order.payment?.wallets.map((wallet) => (
                  <div key={wallet.id} className="rounded-xl border border-line bg-panel-2/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {wallet.label || wallet.asset} <span className="font-normal text-fg-subtle">· {wallet.network}</span>
                      </p>
                      <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[11px] text-accent-strong">{wallet.asset}</span>
                    </div>
                    <div className="mt-3 flex items-center gap-2">
                      <code className="min-w-0 flex-1 rounded-lg border border-line bg-canvas px-3 py-2 font-mono text-[13px] break-all">{wallet.address}</code>
                      <CopyButton value={wallet.address} />
                    </div>
                    {wallet.memo ? (
                      <p className="mt-2 text-xs text-warning">
                        {t("order.manual.memo")}: <span className="font-mono">{wallet.memo}</span>
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
              {order.payment?.reference ? (
                <div className="mt-5 flex items-start gap-3 rounded-xl border border-info/25 bg-info-soft px-4 py-3">
                  <Hourglass className="mt-0.5 size-4 shrink-0 text-info" />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium text-fg">{t("order.manual.pending")}</p>
                    <p className="mt-0.5 font-mono text-xs break-all text-fg-muted">{order.payment.reference}</p>
                  </div>
                </div>
              ) : (
                <fetcher.Form method="post" className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <input type="hidden" name="intent" value="submit_reference" />
                  <input name="reference" required minLength={6} maxLength={200} placeholder={t("order.manual.reference")} aria-label={t("order.manual.reference")} className="input font-mono text-[13px]" />
                  <Button type="submit" variant="primary" loading={fetcher.state !== "idle" && fetcher.formData?.get("intent") === "submit_reference"}>
                    {t("order.manual.submit")}
                  </Button>
                </fetcher.Form>
              )}
            </section>
          ) : null}

          {(order.status === "cancelled" || order.status === "failed") && (
            <section className="surface flex items-start gap-4 p-6">
              <CircleAlert className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
              <div>
                <h2 className="font-semibold">{t(order.status === "failed" ? "order.failed.title" : "order.cancelled.title")}</h2>
                <p className="mt-1 text-sm text-fg-muted">{t("order.cancelled.text")}</p>
                {order.items[0]?.slug ? (
                  <Link to={`/product/${order.items[0].slug}`} className="btn btn-secondary btn-sm mt-4">
                    {t("order.orderAgain")}
                  </Link>
                ) : null}
              </div>
            </section>
          )}

          {fulfilled ? (
            <section className="surface overflow-hidden">
              <div className="flex items-center justify-between gap-4 border-b border-line px-6 py-4">
                <h2 className="flex items-center gap-2 font-semibold">
                  <PackageCheck className="size-5 text-success" />
                  {t("order.delivery.title")}
                </h2>
                {allUnits.length > 1 ? (
                  <div className="flex gap-2">
                    <CopyButton value={allUnits.join("\n")} label={t("order.delivery.copyAll")} />
                    <Button size="sm" onClick={downloadUnits} aria-label={t("order.delivery.download")}>
                      <Download className="size-3.5" />
                      <span className="hidden sm:inline">.txt</span>
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="divide-y divide-line">
                {order.items.map((item) => {
                  const pending = item.deliveredQuantity < item.quantity;
                  return (
                    <div key={item.id} className="p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="font-medium text-fg">
                            {item.name}
                            {item.variant ? <span className="text-fg-subtle"> · {item.variant}</span> : null}
                          </p>
                          <p className="mt-0.5 text-xs text-fg-subtle">{t("order.delivery.progress", { done: item.deliveredQuantity, total: item.quantity })}</p>
                        </div>
                        {!pending ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                            <CheckCircle2 className="size-3.5" />
                            {t("order.delivery.delivered")}
                          </span>
                        ) : null}
                      </div>
                      {item.units.length > 0 ? (
                        <ul className="mt-4 space-y-2">
                          {item.units.map((unit, index) => (
                            <li key={index} className="flex items-center gap-2 rounded-xl border border-line bg-canvas/70 py-2 pr-2 pl-4">
                              <code className="min-w-0 flex-1 font-mono text-[13px] leading-6 break-all whitespace-pre-wrap text-fg">{unit}</code>
                              <CopyButton value={unit} />
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {item.content ? (
                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-line bg-canvas/70 py-2 pr-2 pl-4">
                          <pre className="min-w-0 flex-1 py-1 font-mono text-[13px] leading-6 break-all whitespace-pre-wrap text-fg">{item.content}</pre>
                          <CopyButton value={item.content} />
                        </div>
                      ) : null}
                      {pending && order.status !== "refunded" ? (
                        <div className="mt-4 flex items-start gap-3 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3">
                          <Hourglass className="mt-0.5 size-4 shrink-0 text-accent-strong" />
                          <p className="text-sm text-fg-muted">{t(item.deliveryType === "manual" ? "order.delivery.manualPending" : "order.delivery.shortage")}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {fulfilled
            ? order.items
                .filter((item) => item.instruction && item.instruction.blocks.length > 0)
                .map((item) => (
                  <section key={item.id} className="surface p-6 sm:p-8">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="eyebrow flex items-center gap-2 text-accent-strong">
                          <BookOpen className="size-3.5" />
                          {t("order.instructions")}
                        </p>
                        <h2 className="mt-2 text-lg font-semibold">{item.instruction?.title}</h2>
                      </div>
                      <Link to={`/instructions/${item.instruction?.slug}`} className="btn btn-ghost btn-sm">
                        {t("order.instructions.open")}
                        <ArrowUpRight className="size-3.5" />
                      </Link>
                    </div>
                    <InstructionView blocks={item.instruction?.blocks ?? []} className="mt-6" />
                  </section>
                ))
            : null}
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section className="surface p-6">
            <h2 className="text-sm font-semibold">{t("order.summary")}</h2>
            <dl className="mt-4 space-y-3 text-sm">
              {order.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-4">
                  <dt className="min-w-0 text-fg-muted">
                    {item.name}
                    {item.variant ? <span className="text-fg-subtle"> · {item.variant}</span> : null}
                    <span className="text-fg-subtle"> × {item.quantity}</span>
                  </dt>
                  <dd className="shrink-0 tabular">{money(item.unitPrice * item.quantity)}</dd>
                </div>
              ))}
              {order.discountTotal > 0 ? (
                <div className="flex justify-between gap-4 text-success">
                  <dt>{order.promoCode ? t("checkout.promoDiscount", { code: order.promoCode }) : t("order.discount")}</dt>
                  <dd className="tabular">−{money(order.discountTotal)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between gap-4 border-t border-line pt-3 text-base font-semibold">
                <dt>{t("checkout.total")}</dt>
                <dd className="tabular">{money(order.total)}</dd>
              </div>
            </dl>
            <dl className="mt-5 space-y-2.5 border-t border-line pt-5 text-[13px]">
              <Row label={t("order.payment")} value={t(`payment.method.${order.paymentMethod}`)} />
              <Row label={t("order.email")} value={order.email} />
              {order.paidAt ? <Row label={t("order.paidAt")} value={formatDateTime(order.paidAt, locale)} /> : null}
              {order.deliveredAt ? <Row label={t("order.deliveredAt")} value={formatDateTime(order.deliveredAt, locale)} /> : null}
            </dl>
          </section>

          <section className="surface p-6">
            <h2 className="text-sm font-semibold">{t("order.timeline")}</h2>
            <ol className="mt-5 space-y-0">
              {order.timeline.map((event, index) => {
                const last = index === order.timeline.length - 1;
                const negative = ["cancelled", "expired", "failed", "refunded"].includes(event.type);
                return (
                  <li key={`${event.type}-${index}`} className="relative flex gap-3 pb-5 last:pb-0">
                    {!last ? <span className="absolute top-4 bottom-0 left-[5px] w-px bg-line-strong" aria-hidden="true" /> : null}
                    <span className={cn("relative mt-1.5 size-[11px] shrink-0 rounded-full border-2", last ? (negative ? "border-danger bg-danger/30" : "border-accent bg-accent/40") : "border-line-strong bg-panel-3")} />
                    <div className="min-w-0">
                      <p className={cn("text-[13px] font-medium", last ? "text-fg" : "text-fg-muted")}>{t(TIMELINE_LABELS[event.type] ?? "timeline.created")}</p>
                      <p className="mt-0.5 text-xs text-fg-subtle">{formatDateTime(event.at, locale)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="surface p-6">
            <h2 className="text-sm font-semibold">{t("order.help.title")}</h2>
            <p className="mt-1.5 text-[13px] leading-5 text-fg-muted">{t("order.help.text")}</p>
            {settings.telegram ? (
              <a href={`https://t.me/${settings.telegram}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-4 w-full">
                <Send className="size-3.5" />
                {t("cta.support.telegram")}
              </a>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-subtle">{label}</dt>
      <dd className="min-w-0 truncate text-right text-fg-muted">{value}</dd>
    </div>
  );
}
