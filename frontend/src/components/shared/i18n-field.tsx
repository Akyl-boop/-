"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";
import { Input, Textarea } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { Language } from "@/lib/types";
import { cn, type I18n } from "@/lib/utils";

export function useLanguages() {
  return useQuery({ queryKey: ["languages"], queryFn: () => api.get<Language[]>("/languages"), staleTime: 300_000 });
}

/** Language tabs (EN · RU · 中文 · …) with a filled-state indicator for each translation. */
export function LangTabs({ value, onChange, filled, className }: {
  value: string; onChange: (c: string) => void; filled?: (code: string) => boolean; className?: string;
}) {
  const langs = useLanguages().data ?? [{ code: "en", native_name: "English", flag: "🇬🇧" } as Language];
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-[8px] border border-border bg-surface-2/60 p-0.5", className)}>
      {langs.map((l) => (
        <button key={l.code} type="button" onClick={() => onChange(l.code)}
          className={cn("relative h-6 rounded-[6px] px-2 text-[11.5px] font-medium uppercase text-fg-3 transition-colors hover:text-fg",
            value === l.code && "bg-surface-3 text-fg shadow-sm")}>
          {l.code === "zh" ? "中文" : l.code}
          {filled ? <span className={cn("absolute right-0.5 top-0.5 size-1 rounded-full", filled(l.code) ? "bg-success" : "bg-fg-3/40")} /> : null}
        </button>
      ))}
    </div>
  );
}

export function I18nInput({ value, onChange, multiline, placeholder, rows = 4, render }: {
  value: I18n | null | undefined; onChange: (v: I18n) => void; multiline?: boolean; placeholder?: string; rows?: number;
  render?: (v: string, set: (s: string) => void, lang: string) => React.ReactNode;
}) {
  const [lang, setLang] = React.useState("en");
  const v = value ?? {};
  const set = (s: string) => onChange({ ...v, [lang]: s });
  return (
    <div className="space-y-1.5">
      <LangTabs value={lang} onChange={setLang} filled={(c) => !!v[c]?.trim()} />
      {render ? render(v[lang] ?? "", set, lang) : multiline ? (
        <Textarea rows={rows} value={v[lang] ?? ""} onChange={(e) => set(e.target.value)} placeholder={lang !== "en" && v.en ? `EN: ${v.en.slice(0, 60)}` : placeholder} />
      ) : (
        <Input value={v[lang] ?? ""} onChange={(e) => set(e.target.value)} placeholder={lang !== "en" && v.en ? `EN: ${v.en}` : placeholder} />
      )}
    </div>
  );
}
