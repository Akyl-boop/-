"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ title, description, children, className, size = "md", footer }: {
  title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string;
  size?: "sm" | "md" | "lg" | "xl"; footer?: React.ReactNode;
}) {
  const widths = { sm: "max-w-[420px]", md: "max-w-[560px]", lg: "max-w-[760px]", xl: "max-w-[1040px]" };
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] animate-fade-in bg-black/55 backdrop-blur-[2px]" />
      <DialogPrimitive.Content
        className={cn("fixed left-1/2 top-[max(5vh,24px)] z-[61] flex max-h-[90vh] w-[calc(100vw-24px)] -translate-x-1/2 animate-pop-in flex-col overflow-hidden rounded-[16px] border border-border bg-elevated shadow-[var(--shadow-lg)] outline-none", widths[size], className)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold tracking-[-0.01em]">{title}</DialogPrimitive.Title>
            {description ? <DialogPrimitive.Description className="mt-1 text-[13px] text-fg-3">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>}
          </div>
          <DialogPrimitive.Close className="-mr-1 rounded-[7px] p-1 text-fg-3 transition-colors hover:bg-hover hover:text-fg" aria-label="Close">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border bg-surface/50 px-5 py-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function SheetContent({ title, description, children, className, footer, width = 520 }: {
  title: React.ReactNode; description?: React.ReactNode; children?: React.ReactNode; className?: string; footer?: React.ReactNode; width?: number;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] animate-fade-in bg-black/45" />
      <DialogPrimitive.Content style={{ maxWidth: width }}
        className={cn("fixed inset-y-0 right-0 z-[61] flex w-full animate-slide-in flex-col border-l border-border bg-elevated shadow-[var(--shadow-lg)] outline-none", className)}>
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-[15px] font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className={description ? "mt-1 text-[13px] text-fg-3" : "sr-only"}>{description ?? "Panel"}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close className="rounded-[7px] p-1 text-fg-3 hover:bg-hover hover:text-fg" aria-label="Close"><X className="size-4" /></DialogPrimitive.Close>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div> : null}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
