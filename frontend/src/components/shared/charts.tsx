"use client";

import * as React from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

/** Charts follow the validated palette (CSS --series-N tokens), one axis only, thin marks, hover tooltips. */

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)",
  "var(--series-6)", "var(--series-7)", "var(--series-8)"];

function ChartTooltip({ active, payload, label, format, labelFormat }: {
  active?: boolean; payload?: { value: number; name: string; color?: string }[]; label?: string;
  format: (n: number) => string; labelFormat?: (l: string) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-[10px] border border-border-strong bg-elevated px-3 py-2 text-[12px] shadow-[var(--shadow-lg)]">
      <div className="mb-1 text-fg-3">{labelFormat ? labelFormat(String(label)) : label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="font-semibold tabular text-fg">{format(Number(p.value))}</span>
        </div>
      ))}
    </div>
  );
}

const axisProps = {
  tick: { fill: "var(--text-3)", fontSize: 11 },
  axisLine: false,
  tickLine: false,
} as const;

export function TrendChart({ data, dataKey, xKey = "date", format, height = 240, color = "var(--accent)", name }: {
  data: Record<string, unknown>[]; dataKey: string; xKey?: string; format: (n: number) => string; height?: number; color?: string; name: string;
}) {
  const id = React.useId().replace(/:/g, "");
  const labelFormat = (l: string) => new Date(l).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="0" />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={28}
          tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} />
        <YAxis {...axisProps} width={56} tickFormatter={(v: number) => format(v)} />
        <Tooltip cursor={{ stroke: "var(--chart-axis)", strokeWidth: 1 }} content={<ChartTooltip format={format} labelFormat={labelFormat} />} />
        <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#g-${id})`}
          activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)" }} dot={false} isAnimationActive />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function ColumnChart({ data, dataKey, xKey, format, height = 220, color = "var(--series-1)", name, xFormat }: {
  data: Record<string, unknown>[]; dataKey: string; xKey: string; format: (n: number) => string; height?: number; color?: string;
  name: string; xFormat?: (v: string) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={xKey} {...axisProps} minTickGap={16} tickFormatter={xFormat} />
        <YAxis {...axisProps} width={44} tickFormatter={(v: number) => format(v)} allowDecimals={false} />
        <Tooltip cursor={{ fill: "var(--hover)" }} content={<ChartTooltip format={format} labelFormat={xFormat} />} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Ranked horizontal bars (magnitude) — single hue, values as text labels, hover reveals exact value. */
export function BarList({ items, format, color = "var(--series-1)", empty = "No data for this period" }: {
  items: { label: React.ReactNode; value: number; sub?: React.ReactNode; key: string | number }[];
  format: (n: number) => string; color?: string; empty?: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="py-8 text-center text-[13px] text-fg-3">{empty}</div>;
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.key} className="group" title={format(i.value)}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate text-fg-2 group-hover:text-fg">{i.label}</span>
            <span className="shrink-0 font-medium tabular text-fg">{format(i.value)}{i.sub ? <span className="ml-1.5 font-normal text-fg-3">{i.sub}</span> : null}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${(i.value / max) * 100}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Part-to-whole as one segmented bar with a legend (instead of a pie). */
export function SegmentBar({ segments, format }: { segments: { label: string; value: number }[]; format: (n: number) => string }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (!total) return <div className="py-8 text-center text-[13px] text-fg-3">No data for this period</div>;
  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {segments.map((s, i) => s.value > 0 ? (
          <div key={s.label} title={`${s.label}: ${format(s.value)}`} className="h-full first:rounded-l-full last:rounded-r-full"
            style={{ width: `${(s.value / total) * 100}%`, background: SERIES[i % SERIES.length] }} />
        ) : null)}
      </div>
      <ul className="mt-4 space-y-2">
        {segments.map((s, i) => (
          <li key={s.label} className="flex items-center gap-2.5 text-[13px]">
            <span className="size-2.5 rounded-[3px]" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="flex-1 truncate text-fg-2">{s.label}</span>
            <span className="tabular text-fg">{format(s.value)}</span>
            <span className={cn("w-12 text-right tabular text-fg-3")}>{((s.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
