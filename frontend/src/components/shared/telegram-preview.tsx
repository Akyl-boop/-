"use client";

import { ArrowUpRight, BadgeCheck, CheckCheck, MoreVertical } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

const ALLOWED: Record<string, string> = {
  b: "b", strong: "b", i: "i", em: "i", u: "u", ins: "u", s: "s", strike: "s", del: "s", code: "code", pre: "pre",
  a: "a", blockquote: "blockquote", "tg-spoiler": "span", span: "span", "tg-emoji": "span",
};

/** Render Telegram-HTML safely as React elements (no innerHTML). */
export function TgHtml({ html, className }: { html: string; className?: string }) {
  const nodes = React.useMemo(() => {
    if (typeof window === "undefined") return [html];
    const doc = new DOMParser().parseFromString(`<div>${html.replace(/\n/g, "<br/>")}</div>`, "text/html");
    let key = 0;
    const walk = (node: Node): React.ReactNode => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      const el = node as Element;
      const tag = el.tagName.toLowerCase();
      const children = Array.from(el.childNodes).map(walk);
      if (tag === "br") return <br key={key++} />;
      const mapped = ALLOWED[tag];
      if (!mapped) return <React.Fragment key={key++}>{children}</React.Fragment>;
      if (tag === "a") {
        const href = el.getAttribute("href") ?? "";
        const safe = /^(https?:|tg:|mailto:)/i.test(href) ? href : undefined;
        return <a key={key++} href={safe} target="_blank" rel="noopener noreferrer">{children}</a>;
      }
      if (tag === "tg-spoiler" || (tag === "span" && el.getAttribute("class") === "tg-spoiler")) {
        return <span key={key++} className="tg-spoiler">{children}</span>;
      }
      if (tag === "tg-emoji") {
        return <span key={key++} title={`Custom emoji ${el.getAttribute("emoji-id") ?? ""}`} className="rounded-sm ring-1 ring-[var(--tg-link)]/40">{children}</span>;
      }
      return React.createElement(mapped, { key: key++ }, children);
    };
    return Array.from(doc.body.firstChild?.childNodes ?? []).map(walk);
  }, [html]);
  return <div className={cn("tg-html whitespace-pre-wrap break-words", className)}>{nodes}</div>;
}

export interface PreviewButton { text: string; url?: boolean; style?: string | null; icon?: string | null }

const styleCls: Record<string, string> = {
  primary: "bg-[#3390ec]/85 text-white",
  success: "bg-[#31b545]/85 text-white",
  danger: "bg-[#e53935]/85 text-white",
};

export function TelegramPreview({ html, media, keyboard, botName = "Nexa Store", className, compact, children }: {
  html: string; media?: { url: string; kind: string } | null; keyboard?: PreviewButton[][]; botName?: string;
  className?: string; compact?: boolean; children?: React.ReactNode;
}) {
  const time = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={cn("overflow-hidden rounded-[18px] border border-border bg-[var(--tg-bg)] shadow-[var(--shadow-lg)]", className)}>
      <div className="flex items-center gap-2.5 border-b border-black/20 bg-black/25 px-3.5 py-2.5 text-white backdrop-blur">
        <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#7c5cff] to-[#3390ec] text-[13px] font-semibold">
          {botName.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex items-center gap-1 truncate text-[13.5px] font-semibold">{botName}<BadgeCheck className="size-3.5 text-[#6ab3f3]" /></div>
          <div className="text-[11.5px] text-white/55">bot</div>
        </div>
        <MoreVertical className="size-4 text-white/60" />
      </div>
      <div className={cn("flex flex-col gap-1.5 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.05),transparent_40%)] p-3", compact ? "min-h-[200px]" : "min-h-[340px]")}>
        {children}
        <div className="mt-auto max-w-[92%] self-start">
          <div className="overflow-hidden rounded-[14px] rounded-bl-[5px] bg-[var(--tg-bubble)] text-[13.5px] leading-[1.38] text-[var(--tg-text)] shadow-[0_1px_1px_rgba(0,0,0,0.25)]">
            {media ? (
              media.kind === "video" ? (
                <video src={media.url} className="max-h-[240px] w-full object-cover" muted autoPlay loop playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={media.url} alt="" className="max-h-[260px] w-full object-cover" />
              )
            ) : null}
            <div className="px-3 pb-1.5 pt-2">
              <TgHtml html={html || "<i>Empty message</i>"} />
              <div className="mt-0.5 flex items-center justify-end gap-1 text-[10.5px] text-[var(--tg-text)]/45">
                {time}<CheckCheck className="size-3" />
              </div>
            </div>
          </div>
          {keyboard?.length ? (
            <div className="mt-1 flex flex-col gap-1">
              {keyboard.map((row, i) => (
                <div key={i} className="flex gap-1">
                  {row.map((b, j) => (
                    <div key={j}
                      className={cn("relative flex h-[34px] min-w-0 flex-1 items-center justify-center rounded-[10px] bg-[var(--tg-btn)] px-2 text-center text-[12.5px] font-medium text-white backdrop-blur-sm",
                        b.style && styleCls[b.style])}>
                      <span className="truncate">{b.icon ? <span className="mr-1">{b.icon}</span> : null}{b.text}</span>
                      {b.url ? <ArrowUpRight className="absolute right-1 top-1 size-2.5 opacity-70" /> : null}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
