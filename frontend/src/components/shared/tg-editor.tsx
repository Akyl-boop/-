"use client";

import { Bold, Braces, Code, EyeOff, Italic, Link2, Quote, Smile, Strikethrough, Underline } from "lucide-react";
import * as React from "react";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { EmojiGrid } from "./emoji-picker";

/** Textarea editor for Telegram HTML: formatting toolbar, emoji (incl. custom emoji), variables. */
export function TgEditor({ value, onChange, variables = [], rows = 6, placeholder, className, singleLine }: {
  value: string; onChange: (v: string) => void; variables?: string[]; rows?: number; placeholder?: string; className?: string;
  singleLine?: boolean;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [emojiOpen, setEmojiOpen] = React.useState(false);

  const apply = (before: string, after = "", placeholderText = "") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || placeholderText;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = s + before.length;
      el.setSelectionRange(pos, pos + sel.length);
    });
  };
  const insert = (text: string) => {
    const el = ref.current;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, s) + text + value.slice(e));
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(s + text.length, s + text.length); });
  };

  const tools: { icon: React.ReactNode; label: string; run: () => void; hide?: boolean }[] = [
    { icon: <Bold />, label: "Bold", run: () => apply("<b>", "</b>", "bold") },
    { icon: <Italic />, label: "Italic", run: () => apply("<i>", "</i>", "italic") },
    { icon: <Underline />, label: "Underline", run: () => apply("<u>", "</u>", "underline") },
    { icon: <Strikethrough />, label: "Strikethrough", run: () => apply("<s>", "</s>", "text") },
    { icon: <EyeOff />, label: "Spoiler", run: () => apply("<tg-spoiler>", "</tg-spoiler>", "hidden") },
    { icon: <Code />, label: "Monospace", run: () => apply("<code>", "</code>", "code") },
    { icon: <Link2 />, label: "Link", run: () => { const url = window.prompt("Link URL (https://…)", "https://"); if (url && /^(https?:|tg:)/.test(url)) apply(`<a href="${url.replace(/"/g, "")}">`, "</a>", "link"); } },
    { icon: <Quote />, label: "Blockquote", run: () => apply("<blockquote>", "</blockquote>", "quote"), hide: singleLine },
  ];

  return (
    <div className={cn("overflow-hidden rounded-[10px] border border-border bg-surface-2/50 transition-colors focus-within:border-accent/60 focus-within:ring-3 focus-within:ring-accent/15", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border px-1.5 py-1">
        {tools.filter((t) => !t.hide).map((t) => (
          <Tooltip key={t.label} content={t.label}>
            <button type="button" onClick={t.run} aria-label={t.label}
              className="flex size-7 items-center justify-center rounded-[6px] text-fg-3 transition-colors hover:bg-hover hover:text-fg [&_svg]:size-[15px]">{t.icon}</button>
          </Tooltip>
        ))}
        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="Emoji" className="flex size-7 items-center justify-center rounded-[6px] text-fg-3 hover:bg-hover hover:text-fg"><Smile className="size-[15px]" /></button>
          </PopoverTrigger>
          <PopoverContent className="p-0">
            <EmojiGrid allowCustom onPick={(e) => { insert(e); setEmojiOpen(false); }}
              onCustom={(id, fb) => { insert(`<tg-emoji emoji-id="${id}">${fb}</tg-emoji>`); setEmojiOpen(false); }} />
          </PopoverContent>
        </Popover>
        {variables.length ? (
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" className="ml-auto flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] text-fg-3 hover:bg-hover hover:text-fg">
                <Braces className="size-3.5" />Variables
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              <div className="px-2 py-1 text-[11px] uppercase tracking-wider text-fg-3">Insert placeholder</div>
              {variables.map((v) => (
                <button key={v} type="button" onClick={() => insert(`{${v}}`)} className="flex h-7 w-full items-center rounded-[6px] px-2 font-mono text-[12px] text-fg-2 hover:bg-hover hover:text-fg">{`{${v}}`}</button>
              ))}
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
      <textarea ref={ref} value={value} rows={singleLine ? 2 : rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} spellCheck
        className="block w-full resize-y bg-transparent px-3 py-2.5 font-mono text-[12.5px] leading-relaxed text-fg outline-none placeholder:text-fg-3" />
    </div>
  );
}
