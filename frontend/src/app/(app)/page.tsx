"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Boxes, CircleDollarSign, Clock3, Download, Percent, Receipt, RotateCcw, ShoppingBag, UserPlus, Users, XCircle,
} from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BarList, ColumnChart, SegmentBar, TrendChart } from "@/components/shared/charts";
import { DateRangePicker, type RangeValue } from "@/components/shared/date-range";
import { StatCard } from "@/components/shared/stat-card";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Avatar, Card, CardBody, CardHeader, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import { compact, money, number, pct, timeAgo, toNum } from "@/lib/utils";

interface Kpi { value: number; previous: number; change: number | null }
interface Overview {
  period: { key: string; start: string; end: string; tz: string };
  kpis: Record<string, Kpi>;
  totals: { customers: number; pending_orders: number; processing_orders: number; stock_alerts: number };
  series: { date: string; revenue: number | null; orders: number; created: number; customers: number }[];
  top_products: { product_id: number; name: string; quantity: number; revenue: number | null }[];
  revenue_by_category: { category_id: number | null; name: string; revenue: number | null }[];
  payment_methods: { method: string; orders: number; revenue: number | null }[];
  top_customers: { user_id: number; name: string; username?: string; orders: number; revenue: number | null }[];
  new_vs_returning: { new: number; returning: number };
  languages: { language: string; customers: number }[];
  recent_orders: { id: number; number: string; status: string; total: number | null; currency: string; customer: string; created_at: string }[];
}

const LANG_NAMES: Record<string, string> = { en: "English", ru: "Russian", zh: "Chinese" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function DashboardPage() {
  const { admin, can } = useSession();
  const [range, setRange] = React.useState<RangeValue>({ range: "30d" });
  const q = useQuery({
    queryKey: ["dashboard", range], placeholderData: (p) => p,
    queryFn: () => api.get<Overview>("/dashboard", { ...range }), refetchInterval: 60_000,
  });
  const d = q.data;
  const k = d?.kpis;
  const loading = q.isLoading;
  const showMoney = can("revenue.view");
  const m = (n: number) => money(n, undefined, { compact: n >= 100000 });

  return (
    <div>
      <PageHeader
        eyebrow={new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        title={`${greeting()}, ${admin?.name.split(" ")[0] ?? ""}`}
        description="Here's how your store is performing."
        actions={<>
          <DateRangePicker value={range} onChange={setRange} />
          {can("analytics.export") ? <Button onClick={() => download("/analytics/export", { kind: "daily", ...range })}><Download />Export</Button> : null}
        </>}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {showMoney ? (
          <StatCard label="Revenue" icon={<CircleDollarSign />} loading={loading} value={k?.revenue?.value} change={k?.revenue?.change} format={m}
            hint={k ? `Gross ${money(k.gross_revenue?.value)} · refunds ${money(k.refunds?.value)}` : undefined} />
        ) : null}
        <StatCard label="Paid orders" icon={<ShoppingBag />} loading={loading} value={k?.orders?.value} change={k?.orders?.change} format={(n) => number(n)}
          hint={k ? `${number(k.orders_created?.value)} created` : undefined} />
        <StatCard label="New customers" icon={<UserPlus />} loading={loading} value={k?.new_customers?.value} change={k?.new_customers?.change} format={(n) => number(n)}
          hint={d ? `${number(d.totals.customers)} customers total` : undefined} />
        {showMoney ? (
          <StatCard label="Avg. order value" icon={<Receipt />} loading={loading} value={k?.aov?.value} change={k?.aov?.change} format={(n) => money(n)} />
        ) : (
          <StatCard label="Products sold" icon={<Boxes />} loading={loading} value={k?.products_sold?.value} change={k?.products_sold?.change} format={(n) => number(n)} />
        )}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <MiniStat label="Conversion" icon={<Percent />} loading={loading} value={k ? pct(k.conversion_rate.value) : "—"} />
        <MiniStat label="Products sold" icon={<Boxes />} loading={loading} value={k ? number(k.products_sold.value) : "—"} />
        <MiniStat label="Pending orders" icon={<Clock3 />} loading={loading} value={d ? number(d.totals.pending_orders) : "—"} href="/orders?status=awaiting_payment,awaiting_confirmation,pending" />
        <MiniStat label="Failed payments" icon={<XCircle />} loading={loading} value={k ? number(k.failed_payments.value) : "—"} href="/payments?status=failed,expired" tone={k && k.failed_payments.value > 0 ? "warning" : undefined} />
        <MiniStat label="Refunded orders" icon={<RotateCcw />} loading={loading} value={k ? number(k.refunded_orders.value) : "—"} href="/orders?status=refunded,partially_refunded" />
        <MiniStat label="Stock alerts" icon={<AlertTriangle />} loading={loading} value={d ? number(d.totals.stock_alerts) : "—"} href="/inventory?low=1" tone={d && d.totals.stock_alerts > 0 ? "danger" : undefined} />
      </div>

      <div className="mt-3 grid gap-3 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title={showMoney ? "Revenue" : "Paid orders"} description="Paid orders by day, store timezone" />
          <CardBody>{loading ? <Skeleton className="h-[240px]" /> : (
            <TrendChart data={d?.series ?? []} dataKey={showMoney ? "revenue" : "orders"} name={showMoney ? "Revenue" : "Orders"}
              format={showMoney ? (n) => money(n, undefined, { compact: true }) : (n) => number(n)} />
          )}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Orders created" description="All orders by day, including unpaid" />
          <CardBody>{loading ? <Skeleton className="h-[240px]" /> : (
            <ColumnChart data={d?.series ?? []} dataKey="created" xKey="date" name="Orders" format={(n) => compact(n)} height={240}
              color="var(--series-1)" xFormat={(v) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />
          )}</CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top products" description={showMoney ? "By revenue" : "By quantity"} action={<Link href="/analytics" className="text-[12.5px] text-fg-3 hover:text-fg">Details</Link>} />
          <CardBody>{loading ? <ListSkeleton /> : (
            <BarList format={showMoney ? (n) => money(n) : (n) => number(n)}
              items={(d?.top_products ?? []).map((p) => ({ key: p.product_id ?? p.name, label: p.name, value: showMoney ? toNum(p.revenue) : p.quantity, sub: showMoney ? `${p.quantity} sold` : undefined }))} />
          )}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Revenue by category" />
          <CardBody>{loading ? <ListSkeleton /> : showMoney ? (
            <BarList color="var(--series-3)" format={(n) => money(n)} items={(d?.revenue_by_category ?? []).map((c) => ({ key: c.category_id ?? c.name, label: c.name, value: toNum(c.revenue) }))} />
          ) : <p className="py-8 text-center text-[13px] text-fg-3">Revenue data requires the “View revenue” permission.</p>}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Payment methods" description="Share of paid orders" />
          <CardBody>{loading ? <ListSkeleton /> : (
            <SegmentBar format={(n) => number(n)} segments={(d?.payment_methods ?? []).slice(0, 7).map((p) => ({ label: p.method, value: p.orders }))} />
          )}</CardBody>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top customers" action={<Link href="/customers?sort=-total_spent" className="text-[12.5px] text-fg-3 hover:text-fg">All</Link>} />
          <CardBody className="px-2">
            {loading ? <ListSkeleton /> : !d?.top_customers.length ? <p className="py-8 text-center text-[13px] text-fg-3">No buyers in this period</p> : (
              <ul>{d.top_customers.slice(0, 6).map((c) => (
                <li key={c.user_id}>
                  <Link href={`/customers/${c.user_id}`} className="flex items-center gap-3 rounded-[9px] px-3 py-2 transition-colors hover:bg-hover">
                    <Avatar name={c.name} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-medium">{c.name}</div>
                      <div className="text-[12px] text-fg-3">{c.orders} order{c.orders === 1 ? "" : "s"}{c.username ? ` · @${c.username}` : ""}</div>
                    </div>
                    {showMoney ? <span className="text-[13px] font-medium tabular">{money(c.revenue)}</span> : null}
                  </Link>
                </li>
              ))}</ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="New vs returning buyers" description="Buyers in this period" />
          <CardBody>{loading ? <ListSkeleton /> : (
            <SegmentBar format={(n) => number(n)} segments={[{ label: "New buyers", value: d?.new_vs_returning.new ?? 0 }, { label: "Returning buyers", value: d?.new_vs_returning.returning ?? 0 }]} />
          )}</CardBody>
        </Card>
        <Card>
          <CardHeader title="Customer languages" description="All customers" />
          <CardBody>{loading ? <ListSkeleton /> : (
            <SegmentBar format={(n) => number(n)} segments={(d?.languages ?? []).slice(0, 6).map((l) => ({ label: LANG_NAMES[l.language] ?? l.language.toUpperCase(), value: l.customers }))} />
          )}</CardBody>
        </Card>
      </div>

      {can("orders.view") ? (
        <Card className="mt-3">
          <CardHeader title="Recent orders" description="Updates live as orders come in" action={<Link href="/orders"><Button size="sm" variant="ghost">View all</Button></Link>} />
          <div className="border-t border-border">
            {loading ? <div className="p-5"><ListSkeleton /></div> : (
              <ul className="divide-y divide-border">
                {(d?.recent_orders ?? []).map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center gap-3 px-5 py-2.5 text-[13px] transition-colors hover:bg-hover">
                      <span className="w-24 shrink-0 font-mono text-[12.5px] text-fg">{o.number}</span>
                      <span className="min-w-0 flex-1 truncate text-fg-2">{o.customer}</span>
                      <span className="hidden sm:block"><StatusBadge status={o.status} /></span>
                      <span className="w-20 text-right font-medium tabular">{o.total === null ? "" : money(o.total, o.currency)}</span>
                      <span className="hidden w-20 text-right text-fg-3 md:block">{timeAgo(o.created_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      ) : null}
      <div className="mt-6 flex items-center gap-2 text-[12px] text-fg-3"><Users className="size-3.5" />Changes are compared with the previous period of equal length.</div>
    </div>
  );
}

function ListSkeleton() {
  return <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-5" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}

function MiniStat({ label, value, icon, loading, href, tone }: {
  label: string; value: string; icon: React.ReactNode; loading?: boolean; href?: string; tone?: "warning" | "danger";
}) {
  const inner = (
    <div className="card flex items-center gap-3 px-3.5 py-3 transition-colors hover:border-border-strong">
      <div className={`flex size-8 items-center justify-center rounded-[9px] bg-surface-2 [&_svg]:size-4 ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-fg-3"}`}>{icon}</div>
      <div className="min-w-0">
        <div className="truncate text-[12px] text-fg-3">{label}</div>
        {loading ? <Skeleton className="mt-1 h-4 w-10" /> : <div className="text-[15px] font-semibold tabular">{value}</div>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
