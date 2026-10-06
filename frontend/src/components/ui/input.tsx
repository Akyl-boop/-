"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const base =
  "w-full rounded-[8px] border border-border bg-surface-2/60 px-3 text-[13px] text-fg placeholder:text-fg-3 transition-colors outline-none hover:border-border-strong focus:border-accent/70 focus:ring-3 focus:ring-accent/15 disabled:opacity-50 aria-[invalid=true]:border-danger/70";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { icon?: React.ReactNode; suffix?: React.ReactNode }>(
  ({ className, icon, suffix, ...props }, ref) => {
    if (!icon && !suffix) return <input ref={ref} className={cn(base, "h-8", className)} {...props} />;
    return (
      <div className={cn("relative flex items-center", className)}>
        {icon ? <span className="pointer-events-none absolute left-2.5 text-fg-3 [&_svg]:size-4">{icon}</span> : null}
        <input ref={ref} className={cn(base, "h-8", icon && "pl-8", suffix && "pr-14")} {...props} />
        {suffix ? <span className="absolute right-2.5 text-xs text-fg-3">{suffix}</span> : null}
      </div>
    );
  },
);
Input.displayName = "Input";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(base, "min-h-[84px] py-2 leading-relaxed", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[12.5px] font-medium text-fg-2", className)} {...props} />;
}

export function Field({ label, help, error, children, className, required, action }: {
  label?: React.ReactNode; help?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string;
  required?: boolean; action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label ? (
        <div className="flex items-center justify-between gap-2">
          <Label>
            {label}
            {required ? <span className="ml-0.5 text-danger">*</span> : null}
          </Label>
          {action}
        </div>
      ) : null}
      {children}
      {error ? <p className="text-xs text-danger">{error}</p> : help ? <p className="text-xs text-fg-3 leading-relaxed">{help}</p> : null}
    </div>
  );
}
