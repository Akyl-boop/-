"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import * as React from "react";
import { Skeleton } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

export function useCountUp(target: number, duration = 700) {
  const [v, setV] = React.useState(target);
  const prev = React.useRef(0);
  React.useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setV(target); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 3);
      setV(from + (target - from) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return v;
}

export function Delta({ change, inverse, className }: { change: number | null | undefined; inverse?: boolean; className?: string }) {
  if (change === null || change === undefined) {
    return <span className={cn("inline-flex items-center gap-0.5 text-[12px] text-fg-3", className)}><Minus className="size-3" />n/a</span>;
  }
  const up = change > 0;
  const good = inverse ? !up : up;
  const flat = change === 0;
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-1.5 py-px text-[11.5px] font-medium tabular",
      flat ? "text-fg-3" : good ? "bg-success-bg text-success" : "bg-danger-bg text-danger", className)}>
      {flat ? <Minus className="size-3" /> : up ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}
      {Math.abs(change).toFixed(1)}%
    </span>
  );
}

export function StatCard({ label, value, format, change, inverse, loading, icon, hint, className }: {
  label: string; value: number | null | undefined; format: (n: number) => string; change?: number | null; inverse?: boolean;
  loading?: boolean; icon?: React.ReactNode; hint?: React.ReactNode; className?: string;
}) {
  const animated = useCountUp(value ?? 0);
  return (
    <div className={cn("card group relative overflow-hidden p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] font-medium text-fg-3">{label}</span>
        {icon ? <span className="text-fg-3 [&_svg]:size-4">{icon}</span> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-28" />
      ) : (
        <div className="mt-2 flex items-end justify-between gap-2">
          <span className="text-[24px] font-semibold leading-none tracking-[-0.03em] text-fg">{value === null || value === undefined ? "—" : format(animated)}</span>
          {change !== undefined ? <Delta change={change} inverse={inverse} /> : null}
        </div>
      )}
      {hint ? <div className="mt-2 text-[12px] text-fg-3">{hint}</div> : null}
    </div>
  );
}
