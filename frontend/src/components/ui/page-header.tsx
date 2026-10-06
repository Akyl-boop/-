import * as React from "react";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions, className, eyebrow }: {
  title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string; eyebrow?: React.ReactNode;
}) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5 text-[12px] font-medium text-fg-3">{eyebrow}</div> : null}
        <h1 className="text-[22px] font-semibold tracking-[-0.025em] text-fg sm:text-[24px]">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-[13.5px] text-fg-3">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
