import type { ReactNode } from "react";
import { cn } from "~/lib/format";

export function SegmentedTabs<T extends string>({ value, onChange, options, className, size = "md" }: { value: T; onChange: (value: T) => void; options: { value: T; label: ReactNode }[]; className?: string; size?: "sm" | "md" }) {
  return (
    <div role="tablist" className={cn("inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-xl border border-line bg-panel-2/60 p-1 scrollbar-none", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg font-medium whitespace-nowrap transition-[background-color,color] duration-200",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
            value === option.value ? "bg-panel-3 text-fg shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset,0_1px_3px_rgb(0_0_0/0.4)]" : "text-fg-muted hover:text-fg",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
