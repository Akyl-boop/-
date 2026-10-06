"use client";

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { arrayMove, horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, EyeOff, GripVertical, Plus, Save, Trash2, Undo2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { I18nInput, LangTabs, useLanguages } from "@/components/shared/i18n-field";
import { TelegramPreview } from "@/components/shared/telegram-preview";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader, Checkbox, Segmented, Skeleton, Switch } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Category, Paged, Product } from "@/lib/types";
import { cn, tr, type I18n } from "@/lib/utils";

interface MenuBtn {
  uid: string; id?: number; label: I18n; emoji?: string | null; custom_emoji_id?: string | null; style?: string | null; action: string;
  action_value?: string | null; visible: boolean; languages: string[];
}
type Rows = MenuBtn[][];

const ACTION_LABELS: Record<string, string> = {
  catalog: "Catalog", cart: "Cart", orders: "My orders", profile: "Profile", support: "Support", faq: "FAQ", search: "Search",
  favorites: "Favorites", recent: "Recently viewed", referrals: "Referrals", language: "Language", page: "Open page", terms: "Terms page",
  category: "Open category", product: "Open product", url: "External URL", payment: "Unpaid orders (payment)", custom: "Custom message",
};
let uidSeq = 0;
const uid = () => `b${++uidSeq}`;

function toRows(buttons: (Omit<MenuBtn, "uid"> & { row: number; position: number })[]): Rows {
  const map = new Map<number, MenuBtn[]>();
  [...buttons].sort((a, b) => a.row - b.row || a.position - b.position).forEach((b) => {
    if (!map.has(b.row)) map.set(b.row, []);
    map.get(b.row)!.push({ ...b, uid: uid() });
  });
  return [...map.values()];
}

export function MenuBuilder() {
  const [menu, setMenu] = React.useState<"main" | "profile">("main");
  const qc = useQueryClient();
  const { brand } = useSession();
  const q = useQuery({ queryKey: ["menu", menu], queryFn: () => api.get<{ buttons: (Omit<MenuBtn, "uid"> & { row: number; position: number })[] }>(`/menus/${menu}`) });
  const [rows, setRows] = React.useState<Rows>([]);
  const [sel, setSel] = React.useState<string | null>(null);
  const [lang, setLang] = React.useState("en");
  const [dirty, setDirty] = React.useState(false);
  React.useEffect(() => { if (q.data) { setRows(toRows(q.data.buttons)); setDirty(false); setSel(null); } }, [q.data]);
  const update = (r: Rows) => { setRows(r.filter((row) => row.length)); setDirty(true); };
  const save = useMutation({
    mutationFn: () => api.put(`/menus/${menu}`, { buttons: rows.flatMap((row, ri) => row.map((b, pi) => ({
      id: b.id, label: b.label, emoji: b.emoji || null, custom_emoji_id: b.custom_emoji_id || null, style: b.style || null, action: b.action,
      action_value: b.action_value || null, row: ri, position: pi, visible: b.visible, languages: b.languages,
    }))) }),
    onSuccess: () => { toast.success("Menu saved — live in the bot"); qc.invalidateQueries({ queryKey: ["menu", menu] }); },
  });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const selected = rows.flat().find((b) => b.uid === sel) ?? null;
  const setSelected = (patch: Partial<MenuBtn>) => update(rows.map((row) => row.map((b) => (b.uid === sel ? { ...b, ...patch } : b))));
  const selRow = rows.findIndex((row) => row.some((b) => b.uid === sel));

  const onDragEnd = (ri: number) => (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const row = rows[ri];
    const from = row.findIndex((b) => b.uid === e.active.id);
    const to = row.findIndex((b) => b.uid === e.over!.id);
    update(rows.map((r, i) => (i === ri ? arrayMove(r, from, to) : r)));
  };
  const moveRow = (ri: number, dir: -1 | 1) => { const n = [...rows]; [n[ri], n[ri + dir]] = [n[ri + dir], n[ri]]; update(n); };
  const moveToRow = (target: number) => {
    if (!selected || target === selRow) return;
    const n = rows.map((r) => r.filter((b) => b.uid !== sel));
    if (target >= n.length) n.push([selected]); else n[target] = [...n[target], selected];
    update(n);
  };
  const add = () => {
    const b: MenuBtn = { uid: uid(), label: { en: "New button" }, action: "catalog", visible: true, languages: [] };
    update([...rows, [b]]);
    setSel(b.uid);
  };

  if (q.isLoading) return <Skeleton className="h-[500px]" />;
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented value={menu} onChange={(v) => { if (!dirty || window.confirm("Discard unsaved changes?")) setMenu(v); }} options={[{ value: "main", label: "Main menu" }, { value: "profile", label: "Profile menu" }]} />
          <div className="ml-auto flex gap-2">
            {dirty ? <Button variant="ghost" onClick={() => q.data && (setRows(toRows(q.data.buttons)), setDirty(false))}><Undo2 />Discard</Button> : null}
            <Button onClick={add}><Plus />Add button</Button>
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={() => save.mutate()}><Save />Save menu</Button>
          </div>
        </div>
        <Card className="p-3">
          <div className="space-y-2">
            {rows.map((row, ri) => (
              <div key={ri} className="flex items-center gap-2 rounded-[11px] border border-dashed border-border p-2">
                <div className="flex flex-col">
                  <button type="button" disabled={ri === 0} onClick={() => moveRow(ri, -1)} className="rounded p-0.5 text-fg-3 hover:text-fg disabled:opacity-30" aria-label="Move row up"><ArrowUp className="size-3.5" /></button>
                  <button type="button" disabled={ri === rows.length - 1} onClick={() => moveRow(ri, 1)} className="rounded p-0.5 text-fg-3 hover:text-fg disabled:opacity-30" aria-label="Move row down"><ArrowDown className="size-3.5" /></button>
                </div>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd(ri)}>
                  <SortableContext items={row.map((b) => b.uid)} strategy={horizontalListSortingStrategy}>
                    <div className="flex min-w-0 flex-1 gap-2">
                      {row.map((b) => <ButtonChip key={b.uid} b={b} lang={lang} active={b.uid === sel} onClick={() => setSel(b.uid)} />)}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            ))}
            {!rows.length ? <p className="py-8 text-center text-[13px] text-fg-3">No buttons yet — add one.</p> : null}
          </div>
          <p className="mt-3 text-[12px] text-fg-3">Drag buttons to reorder within a row; use arrows to reorder rows. Buttons for disabled features (e.g. cart, referrals) are hidden automatically.</p>
        </Card>
        {selected ? <ButtonEditor b={selected} onChange={setSelected} row={selRow} rowCount={rows.length} onMoveRow={moveToRow}
          onDelete={() => { update(rows.map((r) => r.filter((x) => x.uid !== sel))); setSel(null); }} /> : null}
      </div>
      <div className="xl:sticky xl:top-20 xl:self-start">
        <div className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-fg-2">Keyboard preview<LangTabs value={lang} onChange={setLang} /></div>
        <TelegramPreview botName={brand?.store_name} html={menu === "main" ? `<b>Welcome to ${brand?.store_name ?? "our store"}</b> ✨\n\nPremium digital products with instant delivery.` : "👤 <b>Profile</b>\n\n📦 Orders: <b>3</b>\n💸 Spent: <b>$128</b>"}
          keyboard={rows.map((row) => row.filter((b) => b.visible && (!b.languages.length || b.languages.includes(lang))).map((b) => ({
            text: `${b.custom_emoji_id ? "" : b.emoji ? `${b.emoji} ` : ""}${tr(b.label, lang)}`, url: b.action === "url", style: b.style, icon: b.custom_emoji_id ? "✦" : null,
          }))).filter((r) => r.length)} />
      </div>
    </div>
  );
}

function ButtonChip({ b, lang, active, onClick }: { b: MenuBtn; lang: string; active: boolean; onClick: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: b.uid });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("flex min-w-0 flex-1 items-center gap-1 rounded-[9px] border border-border bg-surface-2 pr-2 text-[12.5px] transition-colors",
        active && "border-accent ring-1 ring-accent/40", isDragging && "z-10 shadow-lg", !b.visible && "opacity-50")}>
      <span {...attributes} {...listeners} className="flex h-8 cursor-grab touch-none items-center px-1 text-fg-3"><GripVertical className="size-3.5" /></span>
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left">
        <span>{b.emoji}</span><span className="truncate">{tr(b.label, lang) || "Untitled"}</span>
        {!b.visible ? <EyeOff className="ml-auto size-3 shrink-0" /> : null}
      </button>
    </div>
  );
}

function ButtonEditor({ b, onChange, onDelete, row, rowCount, onMoveRow }: {
  b: MenuBtn; onChange: (p: Partial<MenuBtn>) => void; onDelete: () => void; row: number; rowCount: number; onMoveRow: (r: number) => void;
}) {
  const langs = useLanguages().data ?? [];
  const pages = useQuery({ queryKey: ["pages"], queryFn: () => api.get<{ slug: string; title: I18n }[]>("/pages") });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories") });
  const products = useQuery({ queryKey: ["products", "all-min"], queryFn: () => api.get<Paged<Product>>("/products", { page_size: 200 }) });
  return (
    <Card>
      <CardHeader title="Button settings" action={<Button size="sm" variant="danger-ghost" onClick={onDelete}><Trash2 />Remove</Button>} />
      <CardBody className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
          <Field label="Emoji"><EmojiPicker value={b.emoji} onChange={(v) => onChange({ emoji: v })} customEmojiId={b.custom_emoji_id} onCustomEmojiChange={(v) => onChange({ custom_emoji_id: v })} /></Field>
          <Field label="Label"><I18nInput value={b.label} onChange={(v) => onChange({ label: v })} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Action"><Select value={b.action} onChange={(v) => onChange({ action: v, action_value: null })} options={Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label }))} /></Field>
          {b.action === "page" ? <Field label="Page"><Select value={b.action_value ?? ""} onChange={(v) => onChange({ action_value: v })} options={(pages.data ?? []).map((p) => ({ value: p.slug, label: tr(p.title) }))} /></Field> : null}
          {b.action === "category" ? <Field label="Category"><Select value={b.action_value ?? ""} onChange={(v) => onChange({ action_value: v })} options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: `${c.emoji ?? ""} ${tr(c.name)}` }))} /></Field> : null}
          {b.action === "product" ? <Field label="Product"><Select value={b.action_value ?? ""} onChange={(v) => onChange({ action_value: v })} options={(products.data?.items ?? []).map((p) => ({ value: String(p.id), label: `${p.emoji ?? ""} ${p.display_name}` }))} /></Field> : null}
          {b.action === "url" ? <Field label="URL"><Input value={b.action_value ?? ""} onChange={(e) => onChange({ action_value: e.target.value })} placeholder="https://…" /></Field> : null}
          <Field label="Row"><Select value={String(row)} onChange={(v) => onMoveRow(Number(v))} options={[...Array.from({ length: rowCount }, (_, i) => ({ value: String(i), label: `Row ${i + 1}` })), { value: String(rowCount), label: "New row" }]} /></Field>
        </div>
        {b.action === "custom" ? <Field label="Message shown when pressed"><TgEditor value={b.action_value ?? ""} onChange={(v) => onChange({ action_value: v })} rows={4} /></Field> : null}
        <Field label="Button color" help="Bot API button styles; can be turned off in Appearance.">
          <Segmented value={b.style ?? "none"} onChange={(v) => onChange({ style: v === "none" ? null : v })} options={[{ value: "none", label: "Default" }, { value: "primary", label: "Blue" }, { value: "success", label: "Green" }, { value: "danger", label: "Red" }]} />
        </Field>
        <Field label="Show for languages" help="Leave empty to show to everyone.">
          <div className="flex flex-wrap gap-3">{langs.map((l) => (
            <label key={l.code} className="flex items-center gap-2 text-[13px]"><Checkbox checked={b.languages.includes(l.code)} onCheckedChange={(v) => onChange({ languages: v ? [...b.languages, l.code] : b.languages.filter((x) => x !== l.code) })} />{l.flag} {l.native_name}</label>
          ))}</div>
        </Field>
        <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={b.visible} onCheckedChange={(v) => onChange({ visible: v })} />Visible</label>
      </CardBody>
    </Card>
  );
}
