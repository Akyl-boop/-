"use client";

import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface Option { value: string; label: React.ReactNode; hint?: React.ReactNode; disabled?: boolean }

const EMPTY = "__empty__";

export function Select({ value, onChange, options, placeholder = "Select…", className, disabled, size = "md", allowEmpty }: {
  value: string | null | undefined; onChange: (v: string) => void; options: Option[]; placeholder?: string;
  className?: string; disabled?: boolean; size?: "sm" | "md"; allowEmpty?: string;
}) {
  const opts = allowEmpty ? [{ value: EMPTY, label: allowEmpty }, ...options] : options;
  return (
    <S.Root value={value ? value : allowEmpty ? EMPTY : undefined} onValueChange={(v) => onChange(v === EMPTY ? "" : v)} disabled={disabled}>
      <S.Trigger className={cn("inline-flex w-full items-center justify-between gap-2 rounded-[8px] border border-border bg-surface-2/60 px-3 text-left text-[13px] text-fg outline-none transition-colors hover:border-border-strong focus:border-accent/70 data-[placeholder]:text-fg-3 disabled:opacity-50",
        size === "sm" ? "h-7 text-[12.5px]" : "h-8", className)}>
        <span className="truncate"><S.Value placeholder={placeholder} /></span>
        <S.Icon><ChevronDown className="size-3.5 text-fg-3" /></S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={5} className="z-[95] max-h-[min(360px,var(--radix-select-content-available-height))] min-w-[var(--radix-select-trigger-width)] animate-pop-in overflow-hidden rounded-[11px] border border-border bg-elevated p-1 shadow-[var(--shadow-lg)]">
          <S.Viewport>
            {opts.map((o) => (
              <S.Item key={o.value} value={o.value} disabled={o.disabled}
                className="relative flex h-8 cursor-default select-none items-center justify-between gap-3 rounded-[7px] pl-2 pr-7 text-[13px] text-fg-2 outline-none data-[highlighted]:bg-hover data-[highlighted]:text-fg data-[disabled]:opacity-40">
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint ? <span className="text-xs text-fg-3">{o.hint}</span> : null}
                <S.ItemIndicator className="absolute right-2"><Check className="size-3.5 text-accent" /></S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
