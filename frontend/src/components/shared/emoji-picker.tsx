"use client";

import { Clock, Search, Smile, Sparkles, Star, X } from "lucide-react";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger, Spinner, Tooltip } from "@/components/ui/misc";
import { cn } from "@/lib/utils";

interface Emoji { unicode: string; label: string; group?: number; order?: number; tags?: string[] }

const GROUPS: { id: number | "recent" | "fav"; label: string; icon: string }[] = [
  { id: "recent", label: "Recent", icon: "🕘" }, { id: "fav", label: "Favorites", icon: "⭐" },
  { id: 0, label: "Smileys", icon: "😀" }, { id: 1, label: "People", icon: "👋" }, { id: 3, label: "Nature", icon: "🌿" },
  { id: 4, label: "Food", icon: "🍔" }, { id: 5, label: "Travel", icon: "✈️" }, { id: 6, label: "Activities", icon: "⚽" },
  { id: 7, label: "Objects", icon: "💡" }, { id: 8, label: "Symbols", icon: "💠" }, { id: 9, label: "Flags", icon: "🏳️" },
];

/* Store-relevant shortcuts shown first in search-less mode */
const POPULAR = ["🛍", "🛒", "📦", "💳", "💎", "⚡", "🔥", "✨", "🎁", "🏷", "⭐", "✅", "❌", "⏳", "🔒", "🛡", "💬", "❓", "👤", "🌐",
  "🤖", "🎮", "🎬", "🎧", "💻", "📱", "🔑", "🧠", "🚀", "💰", "📈", "🏆", "❤️", "👑", "🆕", "🔔"];

let cache: Emoji[] | null = null;
async function loadEmoji(): Promise<Emoji[]> {
  if (cache) return cache;
  const mod = await import("emojibase-data/en/compact.json");
  const data = (mod.default ?? mod) as Emoji[];
  cache = data.filter((e) => e.group !== 2 && e.group !== undefined).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return cache;
}

function useStored(key: string): [string[], (v: string[]) => void] {
  const [v, setV] = React.useState<string[]>([]);
  React.useEffect(() => {
    try { setV(JSON.parse(localStorage.getItem(key) || "[]")); } catch { /* ignore */ }
  }, [key]);
  const save = React.useCallback((next: string[]) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ }
  }, [key]);
  return [v, save];
}

export function EmojiGrid({ onPick, onCustom, allowCustom }: { onPick: (e: string) => void; onCustom?: (id: string, fallback: string) => void; allowCustom?: boolean }) {
  const [all, setAll] = React.useState<Emoji[] | null>(cache);
  const [q, setQ] = React.useState("");
  const [group, setGroup] = React.useState<number | "recent" | "fav">("recent");
  const [recent, setRecent] = useStored("nexa-emoji-recent");
  const [favs, setFavs] = useStored("nexa-emoji-favs");
  const [customId, setCustomId] = React.useState("");
  const [customFallback, setCustomFallback] = React.useState("⭐");
  const [hover, setHover] = React.useState<Emoji | null>(null);

  React.useEffect(() => { if (!all) loadEmoji().then(setAll); }, [all]);

  const pick = (e: string) => {
    setRecent([e, ...recent.filter((x) => x !== e)].slice(0, 32));
    onPick(e);
  };
  const toggleFav = (e: string) => setFavs(favs.includes(e) ? favs.filter((x) => x !== e) : [e, ...favs].slice(0, 48));

  const term = q.trim().toLowerCase();
  const list: Emoji[] = React.useMemo(() => {
    if (!all) return [];
    if (term) return all.filter((e) => e.label.toLowerCase().includes(term) || e.tags?.some((t) => t.includes(term))).slice(0, 160);
    if (group === "recent") {
      const base = recent.length ? recent : POPULAR;
      return base.map((u) => all.find((e) => e.unicode === u) ?? { unicode: u, label: u });
    }
    if (group === "fav") return favs.map((u) => all.find((e) => e.unicode === u) ?? { unicode: u, label: u });
    return all.filter((e) => e.group === group);
  }, [all, term, group, recent, favs]);

  return (
    <div className="w-[340px] max-w-[calc(100vw-32px)]">
      <div className="p-1.5">
        <Input icon={<Search />} autoFocus placeholder="Search emoji…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!term ? (
        <div className="flex gap-0.5 overflow-x-auto px-1.5 pb-1">
          {GROUPS.map((g) => (
            <Tooltip key={String(g.id)} content={g.label}>
              <button type="button" onClick={() => setGroup(g.id)}
                className={cn("flex size-7 shrink-0 items-center justify-center rounded-[7px] text-[15px] transition-colors hover:bg-hover", group === g.id && "bg-active")}>
                {g.id === "recent" ? <Clock className="size-3.5 text-fg-2" /> : g.id === "fav" ? <Star className="size-3.5 text-fg-2" /> : g.icon}
              </button>
            </Tooltip>
          ))}
        </div>
      ) : null}
      <div className="h-[216px] overflow-y-auto border-y border-border px-1.5 py-1">
        {!all ? (
          <div className="flex h-full items-center justify-center"><Spinner /></div>
        ) : !list.length ? (
          <div className="flex h-full items-center justify-center text-[12.5px] text-fg-3">{group === "fav" && !term ? "Right-click an emoji to favorite it" : "No emoji found"}</div>
        ) : (
          <div className="grid grid-cols-9 gap-0.5">
            {list.map((e) => (
              <button key={e.unicode} type="button" onClick={() => pick(e.unicode)} onMouseEnter={() => setHover(e)}
                onContextMenu={(ev) => { ev.preventDefault(); toggleFav(e.unicode); }}
                className="relative flex size-[34px] items-center justify-center rounded-[7px] text-[20px] transition-transform hover:scale-110 hover:bg-hover">
                {e.unicode}
                {favs.includes(e.unicode) ? <span className="absolute right-0.5 top-0.5 size-1 rounded-full bg-warning" /> : null}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex h-9 items-center gap-2 px-2.5 text-[12px] text-fg-3">
        {hover ? (<><span className="text-[18px]">{hover.unicode}</span><span className="truncate capitalize">{hover.label}</span>
          <button type="button" className="ml-auto text-fg-3 hover:text-warning" onClick={() => toggleFav(hover.unicode)} aria-label="Toggle favorite">
            <Star className={cn("size-3.5", favs.includes(hover.unicode) && "fill-warning text-warning")} />
          </button></>) : <span>Right-click to add to favorites</span>}
      </div>
      {allowCustom && onCustom ? (
        <div className="border-t border-border p-2">
          <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-fg-2"><Sparkles className="size-3.5 text-accent" />Telegram custom emoji</div>
          <div className="flex gap-1.5">
            <Input placeholder="Custom emoji ID" inputMode="numeric" value={customId} onChange={(e) => setCustomId(e.target.value.replace(/\D/g, ""))} className="flex-1 font-mono" />
            <Input value={customFallback} onChange={(e) => setCustomFallback(e.target.value)} className="w-12 text-center" aria-label="Fallback emoji" title="Fallback emoji" />
            <Button size="md" variant="primary" disabled={!customId} onClick={() => onCustom(customId, customFallback || "⭐")}>Use</Button>
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-fg-3">To get an ID, send an animated emoji to your bot from your linked admin account (or use /emojiid): it replies with the ID and tells you whether Telegram lets the bot send it. Elsewhere the fallback emoji is shown.</p>
        </div>
      ) : null}
    </div>
  );
}

/** Button that shows the current emoji and opens the picker. */
export function EmojiPicker({ value, onChange, customEmojiId, onCustomEmojiChange, size = "md", placeholder }: {
  value?: string | null; onChange: (v: string | null) => void; customEmojiId?: string | null;
  onCustomEmojiChange?: (id: string | null) => void; size?: "sm" | "md"; placeholder?: string;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="inline-flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button type="button" aria-label="Choose emoji"
            className={cn("relative inline-flex items-center justify-center rounded-[8px] border border-border bg-surface-2/60 transition-colors hover:border-border-strong",
              size === "sm" ? "size-7 text-[15px]" : "size-8 text-[17px]")}>
            {value ? value : <Smile className="size-4 text-fg-3" />}
            {customEmojiId ? <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full bg-accent text-[8px] text-accent-fg">✦</span> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent className="p-0">
          <EmojiGrid
            onPick={(e) => { onChange(e); setOpen(false); }}
            allowCustom={!!onCustomEmojiChange}
            onCustom={(id, fb) => { onCustomEmojiChange?.(id); onChange(fb); setOpen(false); }}
          />
        </PopoverContent>
      </Popover>
      {value || customEmojiId ? (
        <button type="button" aria-label="Clear emoji" className="rounded p-0.5 text-fg-3 hover:text-fg" onClick={() => { onChange(null); onCustomEmojiChange?.(null); }}>
          <X className="size-3.5" />
        </button>
      ) : placeholder ? <span className="text-xs text-fg-3">{placeholder}</span> : null}
    </div>
  );
}
