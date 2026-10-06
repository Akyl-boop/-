"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, HelpCircle, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { I18nInput, LangTabs } from "@/components/shared/i18n-field";
import { MediaPicker, mediaUrl } from "@/components/shared/media-picker";
import { SortableList } from "@/components/shared/sortable";
import { TelegramPreview } from "@/components/shared/telegram-preview";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card, EmptyState, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { tr, type I18n } from "@/lib/utils";

interface PageBtn { label: I18n; emoji?: string | null; action: string; value: string }
interface BotPage { id?: number; slug: string; title: I18n; content: I18n; emoji?: string | null; media_id?: string | null; buttons: PageBtn[]; enabled: boolean; is_system?: boolean; sort_order: number }
interface Faq { id?: number; question: I18n; answer: I18n; emoji?: string | null; enabled: boolean; sort_order: number }

export default function PagesPage() {
  return (
    <div>
      <PageHeader title="Pages & FAQ" description="Informational screens of your bot: terms, help, about, and the FAQ. Link pages from the menu builder." />
      <Tabs defaultValue="pages">
        <TabsList className="mb-4"><TabsTrigger value="pages"><FileText />Pages</TabsTrigger><TabsTrigger value="faq"><HelpCircle />FAQ</TabsTrigger></TabsList>
        <TabsContent value="pages"><PagesList /></TabsContent>
        <TabsContent value="faq"><FaqList /></TabsContent>
      </Tabs>
    </div>
  );
}

function PagesList() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["pages"], queryFn: () => api.get<BotPage[]>("/pages") });
  const [edit, setEdit] = React.useState<BotPage | null>(null);
  const del = useMutation({ mutationFn: (id: number) => api.del(`/pages/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["pages"] }) });
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setEdit({ slug: "", title: { en: "" }, content: { en: "" }, buttons: [], enabled: true, sort_order: 0 })}><Plus />New page</Button></div>
      {q.isLoading ? <Skeleton className="h-40" /> : !q.data?.length ? <Card><EmptyState icon={<FileText />} title="No pages" /></Card> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <Card key={p.id} className="flex flex-col p-4">
              <div className="flex items-start gap-3">
                <span className="text-[22px]">{p.emoji ?? "📄"}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">{tr(p.title)}{p.is_system ? <Lock className="size-3 text-fg-3" /> : null}</div>
                  <div className="font-mono text-[12px] text-fg-3">/{p.slug}</div>
                </div>
                {!p.enabled ? <Badge>Disabled</Badge> : null}
              </div>
              <p className="mt-2 line-clamp-3 text-[12.5px] text-fg-3">{tr(p.content).replace(/<[^>]+>/g, "")}</p>
              <div className="mt-auto flex gap-1.5 pt-3">
                <Button size="sm" onClick={() => setEdit(p)}><Pencil />Edit</Button>
                {!p.is_system ? <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: `Delete page “${tr(p.title)}”?`, danger: true, confirmLabel: "Delete" })).ok) del.mutate(p.id!); }}><Trash2 /></Button> : null}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit ? <PageEditor page={edit} onClose={() => setEdit(null)} /> : null}
    </>
  );
}

function PageEditor({ page, onClose }: { page: BotPage; onClose: () => void }) {
  const qc = useQueryClient();
  const { brand } = useSession();
  const [p, setP] = React.useState(page);
  const [lang, setLang] = React.useState("en");
  const save = useMutation({
    mutationFn: () => p.id ? api.put(`/pages/${p.id}`, p) : api.post("/pages", p),
    onSuccess: () => { toast.success("Page saved"); qc.invalidateQueries({ queryKey: ["pages"] }); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" title={p.id ? `Edit “${tr(p.title)}”` : "New page"}
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save page</Button></>}>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[auto_1fr_200px]">
              <Field label="Emoji"><EmojiPicker value={p.emoji} onChange={(v) => setP({ ...p, emoji: v })} /></Field>
              <Field label="Title"><I18nInput value={p.title} onChange={(v) => setP({ ...p, title: v })} /></Field>
              <Field label="Slug"><Input disabled={p.is_system} value={p.slug} onChange={(e) => setP({ ...p, slug: e.target.value })} placeholder="auto" /></Field>
            </div>
            <Field label={`Content · ${lang.toUpperCase()}`} action={<LangTabs value={lang} onChange={setLang} filled={(c) => !!p.content[c]?.trim()} />}>
              <TgEditor rows={10} value={p.content[lang] ?? ""} onChange={(v) => setP({ ...p, content: { ...p.content, [lang]: v } })} />
            </Field>
            <Field label="Image"><MediaPicker value={p.media_id} onChange={(v) => setP({ ...p, media_id: v })} className="max-w-xs" /></Field>
            <div>
              <div className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-fg-2">Buttons<Button size="sm" variant="ghost" onClick={() => setP({ ...p, buttons: [...p.buttons, { label: { en: "" }, action: "url", value: "" }] })}><Plus />Add</Button></div>
              {p.buttons.map((b, i) => (
                <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_140px_1fr_auto]">
                  <Input placeholder={`Label (${lang})`} value={b.label[lang] ?? ""} onChange={(e) => setP({ ...p, buttons: p.buttons.map((x, j) => j === i ? { ...x, label: { ...x.label, [lang]: e.target.value } } : x) })} />
                  <Select value={b.action} onChange={(v) => setP({ ...p, buttons: p.buttons.map((x, j) => j === i ? { ...x, action: v } : x) })} options={[{ value: "url", label: "URL" }, { value: "page", label: "Page" }, { value: "category", label: "Category ID" }, { value: "product", label: "Product ID" }]} />
                  <Input value={b.value} onChange={(e) => setP({ ...p, buttons: p.buttons.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} placeholder={b.action === "url" ? "https://…" : b.action === "page" ? "slug" : "ID"} />
                  <Button size="icon" variant="danger-ghost" aria-label="Remove" onClick={() => setP({ ...p, buttons: p.buttons.filter((_, j) => j !== i) })}><Trash2 /></Button>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={p.enabled} onCheckedChange={(v) => setP({ ...p, enabled: v })} />Enabled</label>
          </div>
          <TelegramPreview botName={brand?.store_name} media={p.media_id ? { url: mediaUrl(p.media_id), kind: "image" } : null}
            html={`${p.emoji ? `${p.emoji} ` : ""}<b>${tr(p.title, lang)}</b>\n\n${p.content[lang] ?? ""}`}
            keyboard={[...p.buttons.map((b) => [{ text: tr(b.label, lang) || "Button", url: b.action === "url" }]), [{ text: "← Back" }, { text: "🏠 Home" }]]} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function FaqList() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["faq"], queryFn: () => api.get<Faq[]>("/faq") });
  const [items, setItems] = React.useState<Faq[]>([]);
  React.useEffect(() => { if (q.data) setItems(q.data); }, [q.data]);
  const [edit, setEdit] = React.useState<Faq | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ["faq"] });
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.post("/faq/reorder", { ids }) });
  const save = useMutation({ mutationFn: (f: Faq) => f.id ? api.put(`/faq/${f.id}`, f) : api.post("/faq", f), onSuccess: () => { toast.success("Saved"); setEdit(null); inv(); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/faq/${id}`), onSuccess: inv });
  return (
    <>
      <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setEdit({ question: { en: "" }, answer: { en: "" }, enabled: true, sort_order: items.length })}><Plus />New question</Button></div>
      <Card className="overflow-hidden">
        {!items.length ? <EmptyState icon={<HelpCircle />} title="No FAQ entries" /> : (
          <SortableList items={items} getId={(f) => f.id!} onReorder={(n) => { setItems(n); reorder.mutate(n.map((f) => f.id!)); }} render={(f, handle) => (
            <div className="flex items-center gap-3 border-b border-border px-3 py-3 last:border-0">
              {handle}<span className="text-[18px]">{f.emoji ?? "❓"}</span>
              <div className="min-w-0 flex-1"><div className="truncate text-[13.5px] font-medium">{tr(f.question)}</div><div className="truncate text-[12px] text-fg-3">{tr(f.answer).replace(/<[^>]+>/g, "")}</div></div>
              {!f.enabled ? <Badge>Hidden</Badge> : null}
              <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEdit(f)}><Pencil /></Button>
              <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: "Delete this question?", danger: true, confirmLabel: "Delete" })).ok) del.mutate(f.id!); }}><Trash2 /></Button>
            </div>
          )} />
        )}
      </Card>
      {edit ? (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent size="lg" title={edit.id ? "Edit question" : "New question"} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(edit)}>Save</Button></>}>
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
                <Field label="Emoji"><EmojiPicker value={edit.emoji} onChange={(v) => setEdit({ ...edit, emoji: v })} /></Field>
                <Field label="Question"><I18nInput value={edit.question} onChange={(v) => setEdit({ ...edit, question: v })} /></Field>
              </div>
              <Field label="Answer"><I18nInput value={edit.answer} onChange={(v) => setEdit({ ...edit, answer: v })} render={(val, s) => <TgEditor value={val} onChange={s} rows={6} />} /></Field>
              <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={edit.enabled} onCheckedChange={(v) => setEdit({ ...edit, enabled: v })} />Visible</label>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
