import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/format";

export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
      <div className="relative mb-5 grid size-12 place-items-center rounded-2xl border border-line-strong bg-panel-2">
        <div className="absolute inset-0 rounded-2xl bg-accent/10 blur-xl" aria-hidden="true" />
        <Icon className="relative size-5 text-fg-muted" />
      </div>
      <h3 className="text-[15px] font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-sm text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
