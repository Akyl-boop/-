"use client";

import { CalendarDays, Check } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger, Separator } from "@/components/ui/misc";

export interface RangeValue { range: string; date_from?: string; date_to?: string }

export const RANGES = [
  { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" }, { value: "90d", label: "Last 90 days" }, { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
];

export function rangeLabel(v: RangeValue) {
  if (v.range === "custom") return `${v.date_from} → ${v.date_to}`;
  return RANGES.find((r) => r.value === v.range)?.label ?? v.range;
}

export function DateRangePicker({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const [open, setOpen] = React.useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = React.useState(value.date_from ?? today);
  const [to, setTo] = React.useState(value.date_to ?? today);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary"><CalendarDays />{rangeLabel(value)}</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        {RANGES.map((r) => (
          <button key={r.value} type="button" onClick={() => { onChange({ range: r.value }); setOpen(false); }}
            className="flex h-8 w-full items-center justify-between rounded-[7px] px-2.5 text-[13px] text-fg-2 hover:bg-hover hover:text-fg">
            {r.label}{value.range === r.value ? <Check className="size-4 text-accent" strokeWidth={2.6} /> : null}
          </button>
        ))}
        <Separator className="my-1" />
        <div className="space-y-2 p-2">
          <div className="text-[11.5px] font-medium text-fg-3">Custom range</div>
          <div className="flex gap-1.5">
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <Input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
          </div>
          <Button size="sm" variant="primary" className="w-full" disabled={!from || !to || from > to}
            onClick={() => { onChange({ range: "custom", date_from: from, date_to: to }); setOpen(false); }}>Apply</Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
