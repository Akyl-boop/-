"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CornerDownRight, EyeOff, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { I18nInput } from "@/components/shared/i18n-field";
import { MediaPicker } from "@/components/shared/media-picker";
import { SortableList } from "@/components/shared/sortable";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, EmptyState, Skeleton, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Category } from "@/lib/types";
import { tr } from "@/lib/utils";

type Draft = Partial<Category> & { name: Record<string, string> };

export default function CategoriesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories") });
  const [editing, setEditing] = React.useState<Draft | null>(null);
  const [order, setOrder] = React.useState<Category[]>([]);
  React.useEffect(() => { if (q.data) setOrder(q.data); }, [q.data]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["categories"] });

  const save = useMutation({
    mutationFn: (d: Draft) => d.id ? api.put(`/categories/${d.id}`, d) : api.post("/categories", d),
    onSuccess: () => { toast.success("Category saved"); setEditing(null); invalidate(); },
  });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/categories/${id}`), onSuccess: () => { toast.success("Category deleted"); invalidate(); } });
  const reorder = useMutation({ mutationFn: (ids: number[]) => api.post("/categories/reorder", { ids }), onSuccess: invalidate });

  const roots = order.filter((c) => !c.parent_id);
  const children = (id: number) => order.filter((c) => c.parent_id === id);
  const editable = can("categories.edit");

  const row = (c: Category, handle: React.ReactNode, child = false) => (
    <div className="group flex items-center gap-3 border-b border-border px-3 py-2.5 last:border-0 hover:bg-hover">
      {editable ? handle : null}
      {child ? <CornerDownRight className="size-4 text-fg-3" /> : null}
      <span className="flex size-8 items-center justify-center rounded-[8px] bg-surface-2 text-[16px]">{c.emoji || "📁"}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[13.5px] font-medium">{tr(c.name)}{!c.is_visible ? <Badge><EyeOff className="size-3" />Hidden</Badge> : null}</div>
        <div className="text-[12px] text-fg-3">/{c.slug} · {c.product_count ?? 0} products</div>
      </div>
      {editable ? (
        <div className="flex gap-1 opacity-70 group-hover:opacity-100">
          {!child ? <Button size="sm" variant="ghost" onClick={() => setEditing({ name: { en: "" }, parent_id: c.id, is_visible: true })}><Plus />Sub</Button> : null}
          <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(c)}><Pencil /></Button>
          <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => {
            const r = await confirm({ title: `Delete “${tr(c.name)}”?`, description: "Sub-categories move up one level. Categories with products can't be deleted.", danger: true, confirmLabel: "Delete" });
            if (r.ok) del.mutate(c.id);
          }}><Trash2 /></Button>
        </div>
      ) : null}
    </div>
  );

  return (
    <div>
      <PageHeader title="Categories" description="Organise the catalog. Drag to change the order customers see in the bot."
        actions={editable ? <Button variant="primary" onClick={() => setEditing({ name: { en: "" }, is_visible: true })}><Plus />New category</Button> : null} />
      <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
        {q.isLoading ? <div className="space-y-3 p-4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div> : !roots.length ? (
          <EmptyState icon={<FolderTree />} title="No categories yet" description="Categories group products in the bot's catalog." />
        ) : (
          <SortableList items={roots} getId={(c) => c.id} onReorder={(items) => {
            const next = [...items, ...order.filter((c) => c.parent_id)];
            setOrder(next);
            reorder.mutate(items.map((c) => c.id));
          }} render={(c, handle) => (
            <div>
              {row(c, handle)}
              {children(c.id).length ? (
                <div className="bg-surface-2/30 pl-8">
                  <SortableList items={children(c.id)} getId={(x) => x.id} onReorder={(items) => {
                    const ids = new Set(items.map((x) => x.id));
                    setOrder([...order.filter((x) => !ids.has(x.id)), ...items]);
                    reorder.mutate(items.map((x) => x.id));
                  }} render={(x, h) => row(x, h, true)} />
                </div>
              ) : null}
            </div>
          )} />
        )}
      </div>
      {editing ? (
        <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
          <DialogContent size="lg" title={editing.id ? "Edit category" : "New category"}
            footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(editing)}>Save</Button></>}>
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <Field label="Emoji"><EmojiPicker value={editing.emoji} onChange={(v) => setEditing({ ...editing, emoji: v })} customEmojiId={editing.custom_emoji_id} onCustomEmojiChange={(v) => setEditing({ ...editing, custom_emoji_id: v })} /></Field>
                <Field label="Name" required><I18nInput value={editing.name} onChange={(v) => setEditing({ ...editing, name: v })} /></Field>
              </div>
              <Field label="Description"><I18nInput value={editing.description ?? {}} onChange={(v) => setEditing({ ...editing, description: v })} render={(val, s) => <TgEditor value={val} onChange={s} rows={3} />} /></Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Parent category">
                  <Select value={editing.parent_id ? String(editing.parent_id) : ""} allowEmpty="Top level" onChange={(v) => setEditing({ ...editing, parent_id: v ? Number(v) : null })}
                    options={roots.filter((c) => c.id !== editing.id).map((c) => ({ value: String(c.id), label: `${c.emoji ?? ""} ${tr(c.name)}` }))} />
                </Field>
                <Field label="Slug"><Input value={editing.slug ?? ""} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} placeholder="auto-generated" /></Field>
              </div>
              <Field label="Banner" help="Shown on the category screen. Falls back to the global “Categories” banner."><MediaPicker value={editing.media_id} onChange={(v) => setEditing({ ...editing, media_id: v })} className="max-w-sm" /></Field>
              <label className="flex items-center gap-2.5 text-[13px] text-fg-2"><Switch checked={editing.is_visible ?? true} onCheckedChange={(v) => setEditing({ ...editing, is_visible: v })} />Visible in the bot</label>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
