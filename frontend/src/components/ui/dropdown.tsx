"use client";

import * as DM from "@radix-ui/react-dropdown-menu";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dropdown = DM.Root;
export const DropdownTrigger = DM.Trigger;

export function DropdownContent({ className, align = "end", ...p }: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content align={align} sideOffset={6}
        className={cn("z-[70] min-w-[180px] animate-pop-in rounded-[11px] border border-border bg-elevated p-1 shadow-[var(--shadow-lg)]", className)} {...p} />
    </DM.Portal>
  );
}

export function DropdownItem({ className, danger, icon, children, ...p }: React.ComponentProps<typeof DM.Item> & { danger?: boolean; icon?: React.ReactNode }) {
  return (
    <DM.Item
      className={cn("flex h-8 cursor-default select-none items-center gap-2 rounded-[7px] px-2 text-[13px] text-fg-2 outline-none transition-colors data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[disabled]:opacity-40 [&_svg]:size-4",
        danger && "text-danger data-[highlighted]:bg-danger-bg data-[highlighted]:text-danger", className)} {...p}>
      {icon}
      {children}
    </DM.Item>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return <DM.Label className="px-2 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-fg-3">{children}</DM.Label>;
}

export function DropdownSeparator() {
  return <DM.Separator className="-mx-1 my-1 h-px bg-border" />;
}
