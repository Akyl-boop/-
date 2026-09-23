import type { ReactNode } from "react";
import { cn } from "~/lib/format";

export function SectionHeading({ eyebrow, title, description, action, className, align = "left" }: { eyebrow?: string; title: string; description?: string; action?: ReactNode; className?: string; align?: "left" | "center" }) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", align === "center" && "items-center text-center sm:flex-col sm:items-center", className)}>
      <div className={cn("max-w-2xl", align === "center" && "mx-auto")}>
        {eyebrow ? <p className="eyebrow mb-3 text-accent-strong">{eyebrow}</p> : null}
        <h2 className="text-2xl font-semibold tracking-tight text-fg sm:text-[28px]">{title}</h2>
        {description ? <p className="mt-2.5 text-[15px] leading-7 text-fg-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, children }: { eyebrow?: string; title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="page-container pt-12 pb-8 sm:pt-16 sm:pb-10">
      {eyebrow ? <p className="eyebrow mb-3 text-accent-strong">{eyebrow}</p> : null}
      <h1 className="text-gradient text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-[1.1]">{title}</h1>
      {description ? <p className="mt-3 max-w-2xl text-[15px] leading-7 text-fg-muted">{description}</p> : null}
      {children}
    </div>
  );
}
