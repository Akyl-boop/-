"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleDot, RotateCcw, Save, Search } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { LangTabs } from "@/components/shared/i18n-field";
import { TelegramPreview, type PreviewButton } from "@/components/shared/telegram-preview";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Badge, Card, Skeleton } from "@/components/ui/misc";
import { useDebounce } from "@/hooks/use-debounce";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

interface TextItem { key: string; section: string; description: string; variables: string[]; values: Record<string, string>; defaults: Record<string, string>; overridden: string[] }

const SAMPLE_KEYBOARDS: Record<string, PreviewButton[][]> = {
  "home.text": [[{ text: "🛍 Catalog", style: "primary" }], [{ text: "🛒 Cart" }, { text: "📦 My orders" }], [{ text: "👤 Profile" }, { text: "🎁 Invite friends" }], [{ text: "💬 Support" }, { text: "❓ FAQ" }]],
  "product.card": [[{ text: "🛒 Add to cart" }, { text: "⚡ Buy now", style: "success" }], [{ text: "← Back" }, { text: "🏠 Home" }]],
  "payment.crypto": [[{ text: "⧉ Copy address" }, { text: "⧉ Copy amount" }], [{ text: "▦ QR code" }, { text: "🔄 Check payment", style: "primary" }]],
};

export function TextsTab() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { brand } = useSession();
  const q = useQuery({ queryKey: ["bot-texts"], queryFn: () => api.get<{ items: TextItem[]; sections: { name: string; count: number }[] }>("/content/texts") });
  const [search, setSearch] = React.useState("");
  const [section, setSection] = React.useState<string>("Home");
  const [key, setKey] = React.useState("home.text");
  const [lang, setLang] = React.useState("en");
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const item = q.data?.items.find((t) => t.key === key);
  React.useEffect(() => { if (item) setDraft({ ...item.values }); }, [item]);
  const value = draft[lang] ?? "";
  const dirty = item ? Object.keys(draft).some((l) => (draft[l] ?? "") !== (item.values[l] ?? "")) : false;
  const debounced = useDebounce(value, 250);
  const preview = useQuery({
    queryKey: ["preview", key, debounced], enabled: !!item && !key.startsWith("btn."), placeholderData: (p) => p,
    queryFn: () => api.post<{ html: string }>("/content/preview", { text: debounced, variables: { store_name: brand?.store_name ?? "Nexa Store" } }),
  });
  const save = useMutation({
    mutationFn: () => api.put(`/content/texts/${key}`, { values: draft }),
    onSuccess: () => { toast.success("Saved — the bot uses the new text immediately"); qc.invalidateQueries({ queryKey: ["bot-texts"] }); },
  });
  const reset = useMutation({ mutationFn: () => api.post(`/content/texts/${key}/reset`), onSuccess: () => { toast.success("Reset to default"); qc.invalidateQueries({ queryKey: ["bot-texts"] }); } });

  const term = search.trim().toLowerCase();
  const visible = (q.data?.items ?? []).filter((t) => term ? t.key.includes(term) || Object.values(t.values).some((v) => v.toLowerCase().includes(term)) : t.section === section);
  const selectKey = async (k: string) => {
    if (dirty && !(await confirm({ title: "Discard unsaved changes?", confirmLabel: "Discard", danger: true })).ok) return;
    setKey(k);
  };

  if (q.isLoading) return <Skeleton className="h-[600px]" />;
  return (
    <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_380px]">
      <Card className="flex max-h-[calc(100dvh-220px)] flex-col overflow-hidden">
        <div className="border-b border-border p-2"><Input icon={<Search />} placeholder="Search texts…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {!term ? (
          <div className="flex flex-wrap gap-1 border-b border-border p-2">
            {q.data?.sections.map((s) => (
              <button key={s.name} type="button" onClick={() => setSection(s.name)}
                className={cn("rounded-full border border-border px-2 py-0.5 text-[11.5px] text-fg-3 hover:text-fg", section === s.name && "border-accent/50 bg-accent/10 text-fg")}>{s.name}</button>
            ))}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {visible.map((t) => (
            <button key={t.key} type="button" onClick={() => selectKey(t.key)}
              className={cn("w-full rounded-[8px] px-2.5 py-2 text-left transition-colors hover:bg-hover", key === t.key && "bg-active")}>
              <div className="flex items-center gap-1.5 font-mono text-[11.5px] text-fg-2">{t.key}{t.overridden.length ? <CircleDot className="size-3 text-accent" /> : null}</div>
              <div className="mt-0.5 line-clamp-1 text-[12px] text-fg-3">{(t.values.en ?? "").replace(/<[^>]+>/g, "")}</div>
            </button>
          ))}
        </div>
      </Card>

      <div className="min-w-0 space-y-3">
        {item ? (
          <Card className="p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-mono text-[13px] font-semibold">{item.key}</div>
                <div className="text-[12.5px] text-fg-3">{item.description || item.section}{item.overridden.length ? <> · <Badge tone="accent">customized: {item.overridden.join(", ").toUpperCase()}</Badge></> : null}</div>
              </div>
              <LangTabs value={lang} onChange={setLang} filled={(c) => !!draft[c]?.trim()} />
            </div>
            <TgEditor value={value} onChange={(v) => setDraft({ ...draft, [lang]: v })} variables={item.variables} rows={key.startsWith("btn.") ? 2 : 10} singleLine={key.startsWith("btn.")} />
            {key.startsWith("btn.") ? <p className="mt-2 text-[12px] text-fg-3">Button labels are plain text (Telegram doesn&apos;t format buttons). Emoji are welcome.</p> : null}
            {item.defaults[lang] && value !== item.defaults[lang] ? (
              <details className="mt-3 text-[12.5px]"><summary className="cursor-pointer text-fg-3 hover:text-fg">Show default text</summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-[8px] bg-surface-2 p-2.5 font-mono text-[12px] text-fg-3">{item.defaults[lang]}</pre></details>
            ) : null}
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {item.overridden.length ? <Button variant="ghost" onClick={async () => { if ((await confirm({ title: "Reset to the default text?", description: "All languages of this text return to the built-in defaults.", confirmLabel: "Reset" })).ok) reset.mutate(); }}><RotateCcw />Reset to default</Button> : null}
              <Button variant="ghost" disabled={!dirty} onClick={() => setDraft({ ...item.values })}>Discard</Button>
              <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}><Save />Save</Button>
            </div>
          </Card>
        ) : null}
        <p className="px-1 text-[12px] leading-relaxed text-fg-3">
          Supported formatting: bold, italic, underline, strikethrough, spoiler, monospace, links and quotes. <span className="font-mono">{"{placeholders}"}</span> are filled in by the bot.
          Custom emoji (<span className="font-mono">tg-emoji</span>) render only if your bot is allowed to send them (enable in Appearance); otherwise the fallback emoji is shown.
        </p>
      </div>

      <div className="xl:sticky xl:top-20 xl:self-start">
        <div className="mb-2 text-[12.5px] font-medium text-fg-2">Live preview · {lang.toUpperCase()}</div>
        {key.startsWith("btn.") ? (
          <TelegramPreview compact botName={brand?.store_name} html="Button preview" keyboard={[[{ text: value || "Button" }]]} />
        ) : (
          <TelegramPreview botName={brand?.store_name} html={preview.data?.html ?? ""} keyboard={SAMPLE_KEYBOARDS[key]} />
        )}
      </div>
    </div>
  );
}
