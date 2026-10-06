"use client";

import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { Check, Copy, Inbox, Loader2, Minus } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { cn, hashHue, initials } from "@/lib/utils";

/* ── Badge ─────────────────────────────────────────────────────────────── */
const tones = {
  neutral: "bg-surface-3 text-fg-2 ring-border",
  accent: "bg-accent/12 text-accent ring-accent/25",
  success: "bg-success-bg text-success ring-success/20",
  warning: "bg-warning-bg text-warning ring-warning/20",
  danger: "bg-danger-bg text-danger ring-danger/20",
  info: "bg-info-bg text-info ring-info/20",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", dot, className, children, style }: {
  tone?: Tone; dot?: boolean; className?: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  return (
    <span style={style} className={cn("inline-flex h-5 items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[11.5px] font-medium ring-1 ring-inset", tones[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

/* ── Card ──────────────────────────────────────────────────────────────── */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...p} />;
}
export function CardHeader({ title, description, action, className }: {
  title: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0">
        <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-[12.5px] text-fg-3">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...p} />;
}

/* ── Switch / Checkbox ─────────────────────────────────────────────────── */
export function Switch({ checked, onCheckedChange, disabled, className, id }: {
  checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; className?: string; id?: string;
}) {
  return (
    <SwitchPrimitive.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
      className={cn("relative inline-flex h-[18px] w-8 shrink-0 cursor-pointer items-center rounded-full border border-border bg-surface-3 transition-colors data-[state=checked]:border-transparent data-[state=checked]:bg-accent disabled:opacity-50", className)}>
      <SwitchPrimitive.Thumb className="block size-3.5 translate-x-[1px] rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-[14px]" />
    </SwitchPrimitive.Root>
  );
}

export function Checkbox({ checked, onCheckedChange, className, ...p }: {
  checked: boolean | "indeterminate"; onCheckedChange: (v: boolean) => void; className?: string; "aria-label"?: string;
}) {
  return (
    <CheckboxPrimitive.Root checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)}
      className={cn("flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface-2 transition-colors data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=indeterminate]:border-accent data-[state=indeterminate]:bg-accent", className)} {...p}>
      <CheckboxPrimitive.Indicator className="text-white">
        {checked === "indeterminate" ? <Minus className="size-3" /> : <Check className="size-3" strokeWidth={3} />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* ── Tabs ──────────────────────────────────────────────────────────────── */
export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex items-center gap-1 overflow-x-auto border-b border-border", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn("relative -mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 border-transparent px-2.5 text-[13px] font-medium text-fg-3 transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg [&_svg]:size-4", className)}
      {...p}
    />
  );
}

/* ── Segmented control ─────────────────────────────────────────────────── */
export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center rounded-[9px] border border-border bg-surface-2/70 p-0.5", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn("h-7 rounded-[7px] px-2.5 text-[12.5px] font-medium text-fg-3 transition-all hover:text-fg",
            value === o.value && "bg-surface-3 text-fg shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_0_0_1px_var(--border)]")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ── Tooltip / Popover ─────────────────────────────────────────────────── */
export function Tooltip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  if (!content) return <>{children}</>;
  return (
    <TooltipPrimitive.Root delayDuration={250}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content side={side} sideOffset={6}
          className="z-[80] max-w-xs animate-fade-in rounded-[7px] border border-border bg-surface-3 px-2 py-1 text-xs text-fg shadow-lg">
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export const TooltipProvider = TooltipPrimitive.Provider;

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export function PopoverContent({ className, align = "start", ...p }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content align={align} sideOffset={6}
        className={cn("z-[70] animate-pop-in rounded-[12px] border border-border bg-elevated p-2 shadow-[var(--shadow-lg)] outline-none", className)} {...p} />
    </PopoverPrimitive.Portal>
  );
}

/* ── Skeleton / Spinner / Kbd / Separator ──────────────────────────────── */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={cn("skeleton h-4", className)} style={style} />;
}
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-fg-3", className)} />;
}
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border bg-surface-2 px-1 font-sans text-[10.5px] font-medium text-fg-3", className)}>{children}</kbd>;
}
export function Separator({ className }: { className?: string }) {
  return <div className={cn("h-px w-full bg-border", className)} />;
}

/* ── Empty state ───────────────────────────────────────────────────────── */
export function EmptyState({ icon, title, description, action, className }: {
  icon?: React.ReactNode; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="relative mb-4">
        <div className="absolute inset-0 -m-3 rounded-full bg-accent/10 blur-xl" />
        <div className="relative flex size-11 items-center justify-center rounded-[12px] border border-border bg-surface-2 text-fg-2 [&_svg]:size-5">
          {icon ?? <Inbox />}
        </div>
      </div>
      <h3 className="text-sm font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-fg-3">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/* ── Avatar ────────────────────────────────────────────────────────────── */
export function Avatar({ name, size = 28, className }: { name?: string | null; size?: number; className?: string }) {
  const hue = hashHue(name || "?");
  return (
    <span className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${hue} 55% 52%), hsl(${(hue + 40) % 360} 60% 38%))` }}>
      {initials(name)}
    </span>
  );
}

/* ── Copy button ───────────────────────────────────────────────────────── */
export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <button type="button" aria-label={label ?? "Copy"}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setDone(false), 1400);
        } catch {
          toast.error("Clipboard is not available");
        }
      }}
      className={cn("inline-flex size-6 items-center justify-center rounded-[6px] text-fg-3 transition-colors hover:bg-hover hover:text-fg", className)}>
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/* ── Stat line ─────────────────────────────────────────────────────────── */
export function KeyValue({ label, children, className }: { label: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 py-2 text-[13px]", className)}>
      <span className="shrink-0 text-fg-3">{label}</span>
      <span className="min-w-0 text-right text-fg">{children}</span>
    </div>
  );
}
