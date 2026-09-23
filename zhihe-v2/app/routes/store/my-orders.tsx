import { ArrowRight, Mail, Receipt, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";
import { z } from "zod";
import { PageHeader } from "~/components/store/section-heading";
import { Button } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { TextField } from "~/components/ui/field";
import { useFeedbackToast } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { formatDate } from "~/lib/format";
import { forgetOrder, readRecentOrders, type RecentOrder } from "~/lib/recent-orders";
import { metaT, rootData, seo } from "~/lib/seo";
import { getRequestContext } from "~/server/context";
import { queryFirst } from "~/server/db.server";
import { sendOrderLinkEmail } from "~/server/fulfillment.server";
import { clientIp } from "~/server/http.server";
import { isEmailConfigured } from "~/server/notify/email.server";
import type { OrderRow } from "~/server/orders.server";
import { resolveLocale, serverT } from "~/server/locale.server";
import { hitRateLimit } from "~/server/rate-limit.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/my-orders";
import { OrderStatusBadge } from "~/components/ui/status-badge";
import { ORDER_STATUSES, type OrderStatus } from "~/lib/domain";

export async function loader({ context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  return { canEmail: isEmailConfigured(env) };
}

export const meta: Route.MetaFunction = ({ matches }) => {
  const root = rootData(matches);
  return seo(root, { title: metaT(root, "myOrders.title"), path: "/orders", noindex: true });
};

const lookupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  number: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^ZH-\d{4}-[A-Z0-9]{6}$/),
});

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const limit = await hitRateLimit(env.DB, `lookup:${clientIp(request)}`, 5, 15 * 60 * 1000);
  if (!limit.allowed) return { ok: false, error: serverT(locale, "error.rateLimited") };
  const parsed = lookupSchema.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { ok: false, error: serverT(locale, "myOrders.lookup.invalid") };
  const order = await queryFirst<OrderRow>(env.DB, "SELECT * FROM orders WHERE number = ? AND email = ? COLLATE NOCASE", parsed.data.number, parsed.data.email);
  // The response never reveals whether the order exists.
  if (order) ctx.waitUntil(sendOrderLinkEmail(env, order).then(() => undefined));
  return { ok: true, message: serverT(locale, "myOrders.lookup.sent") };
}

export default function MyOrders({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const [orders, setOrders] = useState<RecentOrder[] | null>(null);
  const fetcher = useFetcher<typeof action>();
  useFeedbackToast(fetcher.data);

  useEffect(() => setOrders(readRecentOrders()), []);

  return (
    <>
      <PageHeader eyebrow={t("myOrders.eyebrow")} title={t("myOrders.title")} description={t("myOrders.description")} />
      <div className="page-container grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="surface overflow-hidden">
          <div className="border-b border-line px-6 py-4">
            <h2 className="font-semibold">{t("myOrders.device")}</h2>
          </div>
          {orders === null ? (
            <div className="space-y-3 p-6">
              {[0, 1, 2].map((index) => (
                <div key={index} className="skeleton h-16" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t("myOrders.empty.title")}
              description={t("myOrders.empty.text")}
              action={
                <Link to="/catalog" className="btn btn-primary">
                  {t("home.cta.catalog")}
                  <ArrowRight className="size-4" />
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {orders.map((order) => (
                <li key={order.number} className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-white/[0.02]">
                  <Link to={`/order/${order.number}?key=${encodeURIComponent(order.key)}`} className="flex min-w-0 flex-1 items-center gap-4">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-strong bg-panel-3">
                      <Receipt className="size-4 text-fg-muted" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold">{order.number}</span>
                        {(ORDER_STATUSES as readonly string[]).includes(order.status) ? <OrderStatusBadge status={order.status as OrderStatus} /> : null}
                      </span>
                      <span className="mt-1 block truncate text-[13px] text-fg-subtle">
                        {order.product} · {formatDate(order.createdAt, locale)}
                      </span>
                    </span>
                    <span className="hidden text-sm font-semibold tabular sm:block">{order.total}</span>
                  </Link>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon btn-sm opacity-60 transition-opacity group-hover:opacity-100"
                    aria-label={t("myOrders.forget")}
                    onClick={() => {
                      forgetOrder(order.number);
                      setOrders(readRecentOrders());
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-6">
          <section className="surface p-6">
            <h2 className="flex items-center gap-2 font-semibold">
              <Search className="size-4 text-accent-strong" />
              {t("myOrders.lookup.title")}
            </h2>
            <p className="mt-1.5 text-[13px] leading-5 text-fg-muted">{loaderData.canEmail ? t("myOrders.lookup.text") : t("myOrders.lookup.noEmail")}</p>
            {loaderData.canEmail ? (
              <fetcher.Form method="post" className="mt-5 space-y-4">
                <TextField label={t("checkout.email")} name="email" type="email" required autoComplete="email" />
                <TextField label={t("myOrders.lookup.number")} name="number" required placeholder="ZH-2026-XXXXXX" className="font-mono uppercase" />
                <Button type="submit" variant="primary" className="w-full" loading={fetcher.state !== "idle"}>
                  <Mail className="size-4" />
                  {t("myOrders.lookup.submit")}
                </Button>
              </fetcher.Form>
            ) : (
              <Link to="/support" className="btn btn-secondary mt-5 w-full">
                {t("nav.support")}
              </Link>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
