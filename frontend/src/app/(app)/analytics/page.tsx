"use client";

import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import * as React from "react";
import { BarList, ColumnChart, TrendChart } from "@/components/shared/charts";
import { DateRangePicker, type RangeValue } from "@/components/shared/date-range";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, number, pct } from "@/lib/utils";

interface Kpi { value: number; change: number | null }
interface Report {
  kpis: Record<string, Kpi>;
  series: { date: string; revenue: number | null; orders: number; created: number; customers: number }[];
  advanced: {
    retention: { repeat_customers: number; buyers: number; repeat_rate: number };
    cohorts: { cohort: string; customers: number; repeat: number }[];
    promo_performance: { code: string; uses: number; discount: number; revenue: number }[];
    referral_performance: { registered: number; converted: number; revenue: number; rewards: number };
    categories: { name: string; quantity: number; revenue: number; profit: number }[];
    hours: { hour: number; orders: number }[];
  };
}

export default function AnalyticsPage() {
  const { can } = useSession();
  const [range, setRange] = React.useState<RangeValue>({ range: "30d" });
  const q = useQuery({ queryKey: ["analytics", range], placeholderData: (p) => p, queryFn: () => api.get<Report>("/analytics", { ...range }) });
  const d = q.data;
  const k = d?.kpis ?? {};
  const loading = q.isLoading;
  const rev = can("revenue.view");
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: `${String(h).padStart(2, "0")}:00`, orders: d?.advanced.hours.find((x) => x.hour === h)?.orders ?? 0 }));
  return (
    <div>
      <PageHeader title="Analytics" description="Deep-dive into revenue, profit, conversion and retention — all computed from real orders."
        actions={<>
          <DateRangePicker value={range} onChange={setRange} />
          {can("analytics.export") ? (<>
            <Button onClick={() => download("/analytics/export", { kind: "daily", ...range })}><Download />Daily CSV</Button>
            <Button onClick={() => download("/analytics/export", { kind: "orders", ...range })}><Download />Orders CSV</Button>
          </>) : null}
        </>} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {rev ? <StatCard label="Net revenue" loading={loading} value={k.revenue?.value} change={k.revenue?.change} format={(n) => money(n)} /> : null}
        {rev ? <StatCard label="Profit" loading={loading} value={k.profit?.value} change={k.profit?.change} format={(n) => money(n)} hint={k.margin ? `${pct(k.margin.value)} margin on costed orders` : undefined} /> : null}
        <StatCard label="Paid orders" loading={loading} value={k.orders?.value} change={k.orders?.change} format={(n) => number(n)} />
        {rev ? <StatCard label="Average order" loading={loading} value={k.aov?.value} change={k.aov?.change} format={(n) => money(n)} /> : null}
        <StatCard label="Checkout conversion" loading={loading} value={k.conversion_rate?.value} change={k.conversion_rate?.change} format={(n) => pct(n)} hint="Paid ÷ created orders" />
        <StatCard label="Payment success" loading={loading} value={k.payment_success_rate?.value} change={k.payment_success_rate?.change} format={(n) => pct(n)} />
        <StatCard label="Refund rate" loading={loading} value={k.refund_rate?.value} change={k.refund_rate?.change} inverse format={(n) => pct(n)} />
        <StatCard label="Repeat purchase rate" loading={loading} value={d?.advanced.retention.repeat_rate} format={(n) => pct(n)} hint={d ? `${d.advanced.retention.repeat_customers} of ${d.advanced.retention.buyers} buyers` : undefined} />
        <StatCard label="New customers" loading={loading} value={k.new_customers?.value} change={k.new_customers?.change} format={(n) => number(n)} />
        <StatCard label="Products sold" loading={loading} value={k.products_sold?.value} change={k.products_sold?.change} format={(n) => number(n)} />
      </div>
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
        {rev ? (
          <Card><CardHeader title="Revenue" description="Paid orders per day" /><CardBody>{loading ? <Skeleton className="h-60" /> : <TrendChart data={d?.series ?? []} dataKey="revenue" name="Revenue" format={(n) => money(n, undefined, { compact: true })} />}</CardBody></Card>
        ) : null}
        <Card><CardHeader title="New customers" description="Bot sign-ups per day" /><CardBody>{loading ? <Skeleton className="h-60" /> : <TrendChart data={d?.series ?? []} dataKey="customers" name="Customers" format={(n) => number(n)} color="var(--series-3)" />}</CardBody></Card>
        <Card><CardHeader title="Paid orders" /><CardBody>{loading ? <Skeleton className="h-56" /> : <ColumnChart data={d?.series ?? []} dataKey="orders" xKey="date" name="Orders" format={(n) => number(n)} xFormat={(v) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />}</CardBody></Card>
        <Card><CardHeader title="Orders by hour" description="When customers buy (store timezone)" /><CardBody>{loading ? <Skeleton className="h-56" /> : <ColumnChart data={hours} dataKey="orders" xKey="hour" name="Orders" color="var(--series-7)" format={(n) => number(n)} />}</CardBody></Card>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Categories" description="Revenue and profit by category" />
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-border bg-surface-2/40 text-[11.5px] uppercase tracking-wide text-fg-3"><th className="px-4 py-2 text-left font-medium">Category</th><th className="px-4 py-2 text-right font-medium">Units</th>{rev ? <><th className="px-4 py-2 text-right font-medium">Revenue</th><th className="px-4 py-2 text-right font-medium">Profit</th></> : null}</tr></thead>
              <tbody>{(d?.advanced.categories ?? []).map((c) => (
                <tr key={c.name} className="border-b border-border last:border-0"><td className="px-4 py-2.5">{c.name}</td><td className="px-4 text-right tabular">{number(c.quantity)}</td>{rev ? <><td className="px-4 text-right tabular">{money(c.revenue)}</td><td className="px-4 text-right tabular text-success">{money(c.profit)}</td></> : null}</tr>
              ))}</tbody>
            </table>
            {!d?.advanced.categories.length ? <p className="py-8 text-center text-[13px] text-fg-3">No sales in this period</p> : null}
          </div>
        </Card>
        <Card>
          <CardHeader title="Referral program" />
          <CardBody className="space-y-3">
            {[["Registered via links", number(d?.advanced.referral_performance.registered)], ["Converted", number(d?.advanced.referral_performance.converted)],
              ["Revenue", money(d?.advanced.referral_performance.revenue)], ["Rewards paid", money(d?.advanced.referral_performance.rewards)]].map(([l, v]) => (
              <div key={l} className="flex justify-between text-[13px]"><span className="text-fg-3">{l}</span><span className="font-medium tabular">{v}</span></div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Promo code performance" />
          <CardBody>
            <BarList format={(n) => money(n)} color="var(--series-2)" empty="No promo usage in this period"
              items={(d?.advanced.promo_performance ?? []).map((p) => ({ key: p.code, label: <span className="font-mono">{p.code}</span>, value: p.revenue, sub: `${p.uses} uses · −${money(p.discount)}` }))} />
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Customer cohorts" description="Buyers by month of first purchase and how many came back" />
          <CardBody>
            {!d?.advanced.cohorts.length ? <p className="py-6 text-center text-[13px] text-fg-3">No buyers yet</p> : (
              <div className="space-y-2">
                {d.advanced.cohorts.map((c) => {
                  const rate = c.customers ? (c.repeat / c.customers) * 100 : 0;
                  return (
                    <div key={c.cohort} className="grid grid-cols-[80px_1fr_120px] items-center gap-3 text-[13px]">
                      <span className="font-mono text-fg-2">{c.cohort}</span>
                      <div className="h-6 overflow-hidden rounded-[6px] bg-surface-3"><div className="flex h-full items-center rounded-[6px] px-2 text-[11px] font-medium text-white" style={{ width: `${Math.max(rate, 4)}%`, background: "var(--series-1)" }}>{rate.toFixed(0)}%</div></div>
                      <span className="text-right text-fg-3 tabular">{c.repeat}/{c.customers} returned</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
