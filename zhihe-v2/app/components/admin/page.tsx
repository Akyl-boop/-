import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { cn } from "~/lib/format";

export function AdminPageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string } }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back ? (
          <Link to={back.to} className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-fg-subtle transition-colors hover:text-fg">
            <ArrowLeft className="size-3.5" />
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <p className="mt-1.5 text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, description, actions, children, className, bodyClassName, id }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string; id?: string }) {
  return (
    <section id={id} className={cn("surface overflow-hidden", className)}>
      {title ? (
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold">{title}</h2>
            {description ? <p className="mt-0.5 text-[13px] text-fg-subtle">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={cn(bodyClassName ?? "p-5")}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, icon: Icon, tone = "neutral" }: { label: string; value: ReactNode; hint?: ReactNode; icon?: React.ComponentType<{ className?: string }>; tone?: "neutral" | "accent" | "success" | "warning" }) {
  const toneClass = {
    neutral: "text-fg-muted bg-white/[0.04] border-line-strong",
    accent: "text-accent-strong bg-accent-soft border-accent/25",
    success: "text-success bg-success-soft border-success/25",
    warning: "text-warning bg-warning-soft border-warning/25",
  }[tone];
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[13px] text-fg-muted">{label}</p>
        {Icon ? (
          <span className={cn("grid size-8 place-items-center rounded-lg border", toneClass)}>
            <Icon className="size-4" />
          </span>
        ) : null}
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {hint ? <p className="mt-1 text-xs text-fg-subtle">{hint}</p> : null}
    </div>
  );
}

export function TableShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">{children}</div>
      {footer}
    </div>
  );
}
