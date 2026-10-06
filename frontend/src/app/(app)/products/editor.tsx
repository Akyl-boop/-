"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Boxes, Plus, Save, Sparkles, Trash2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { z } from "zod";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { I18nInput, LangTabs, useLanguages } from "@/components/shared/i18n-field";
import { MediaPicker, mediaUrl } from "@/components/shared/media-picker";
import { StatusBadge } from "@/components/shared/status";
import { TelegramPreview, type PreviewButton } from "@/components/shared/telegram-preview";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card, CardBody, CardHeader, Checkbox, Segmented, Switch } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { PRODUCT_STATUSES } from "@/features/products";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Category, Product, Variant } from "@/lib/types";
import { cn, money, toNum, tr, type I18n } from "@/lib/utils";

type Group = { key: string; name: I18n; values?: string };
type FormState = Omit<Product, "id" | "display_name" | "category" | "price_min" | "price_max" | "stock" | "sold_count" | "views_count" | "rating_avg" | "rating_count" | "variants_count" | "created_at" | "updated_at" | "option_groups"> & { option_groups: Group[] };

const DELIVERY = [
  { value: "inventory", label: "Automatic · inventory", hint: "Codes/keys from stock" },
  { value: "text", label: "Automatic · static text", hint: "Same link/text for everyone" },
  { value: "file", label: "Automatic · file", hint: "A file from the media library" },
  { value: "api", label: "API fulfillment", hint: "Your API returns the goods" },
  { value: "webhook", label: "Webhook fulfillment", hint: "Your system calls back later" },
  { value: "manual", label: "Manual delivery", hint: "An admin delivers it" },
];

const schema = z.object({
  name: z.record(z.string(), z.string()).refine((v) => Object.values(v).some((x) => x.trim()), "Product name is required"),
  variants: z.array(z.object({ price: z.coerce.number().min(0, "Price must be positive"), name: z.record(z.string(), z.string()) })).min(1, "Add at least one variant"),
  min_quantity: z.coerce.number().int().min(1),
});

function blankVariant(i = 0): Variant {
  return { sku: "", name: { en: i === 0 ? "Standard" : `Option ${i + 1}` }, attributes: {}, price: 0, old_price: null, cost_price: null, manual_stock: 0, is_active: true };
}

function initial(p?: Product): FormState {
  return {
    slug: p?.slug ?? "", name: p?.name ?? { en: "" }, emoji: p?.emoji ?? null, custom_emoji_id: p?.custom_emoji_id ?? null,
    category_id: p?.category_id ?? null, media_id: p?.media_id ?? null, status: p?.status ?? "draft", sort_order: p?.sort_order ?? 0,
    is_featured: p?.is_featured ?? false, tags: p?.tags ?? [], stock_mode: p?.stock_mode ?? "inventory",
    delivery_mode: p?.delivery_mode ?? "inventory", short_description: p?.short_description ?? {}, description: p?.description ?? {},
    currency: p?.currency ?? null, warranty: p?.warranty ?? {}, delivery_instructions: p?.delivery_instructions ?? {},
    fulfillment_config: p?.fulfillment_config ?? {}, min_quantity: p?.min_quantity ?? 1, max_quantity: p?.max_quantity ?? null,
    max_per_customer: p?.max_per_customer ?? null, regions: p?.regions ?? [], languages: p?.languages ?? [],
    option_groups: (p?.option_groups ?? []).map((g) => ({ ...g, values: "" })), variants: p?.variants?.length ? p.variants : [blankVariant()],
    low_stock_threshold: p?.low_stock_threshold ?? 5,
  };
}

export function ProductEditor({ product }: { product?: Product }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { can, brand } = useSession();
  const [form, setForm] = React.useState<FormState>(() => initial(product));
  const [dirty, setDirty] = React.useState(false);
  const [previewLang, setPreviewLang] = React.useState("en");
  const [errors, setErrors] = React.useState<string[]>([]);
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories") });
  const langs = useLanguages().data ?? [];
  const canEdit = can("products.edit");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true); };
  const setVariant = (i: number, patch: Partial<Variant>) => set("variants", form.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  const cfg = form.fulfillment_config ?? {};
  const setCfg = (patch: Record<string, unknown>) => set("fulfillment_config", { ...cfg, ...patch });

  React.useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        option_groups: form.option_groups.filter((g) => g.key || tr(g.name)).map(({ key, name }) => ({ key, name })),
        variants: form.variants.map((v) => ({
          ...v, price: toNum(v.price), old_price: v.old_price === null || v.old_price === "" ? null : toNum(v.old_price),
          cost_price: v.cost_price === null || v.cost_price === "" ? null : toNum(v.cost_price), manual_stock: toNum(v.manual_stock),
          fulfillment_config: v.fulfillment_config && Object.keys(v.fulfillment_config).length ? v.fulfillment_config : null,
        })),
        min_quantity: toNum(form.min_quantity) || 1, max_quantity: form.max_quantity ? toNum(form.max_quantity) : null,
        max_per_customer: form.max_per_customer ? toNum(form.max_per_customer) : null, sort_order: toNum(form.sort_order),
        low_stock_threshold: toNum(form.low_stock_threshold),
      };
      return product ? api.put<Product>(`/products/${product.id}`, payload) : api.post<Product>("/products", payload);
    },
    onSuccess: (p) => {
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.setQueryData(["product", p.id], p);
      toast.success(product ? "Product saved" : "Product created");
      if (!product) router.replace(`/products/${p.id}`);
      else setForm(initial(p));
    },
  });

  const submit = () => {
    const r = schema.safeParse(form);
    if (!r.success) { setErrors(r.error.issues.map((i) => i.message)); toast.error(r.error.issues[0]?.message ?? "Check the form"); return; }
    setErrors([]);
    save.mutate();
  };

  // ── Variant generator from option groups ──
  const generate = () => {
    const groups = form.option_groups.filter((g) => g.key && (g.values ?? "").trim());
    if (!groups.length) { toast.error("Add option values, e.g. “Plus, Pro”"); return; }
    let combos: Record<string, string>[] = [{}];
    for (const g of groups) {
      const values = (g.values ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      combos = combos.flatMap((c) => values.map((v) => ({ ...c, [g.key]: v })));
    }
    const existing = new Map(form.variants.map((v) => [JSON.stringify(v.attributes), v]));
    const base = toNum(form.variants[0]?.price);
    const variants = combos.map((attrs, i) => existing.get(JSON.stringify(attrs)) ?? {
      ...blankVariant(i), attributes: attrs, name: { en: Object.values(attrs).join(" · ") }, price: base,
    });
    set("variants", variants);
    toast.success(`${variants.length} variants ready — set their prices`);
  };

  // ── Preview ──
  const L = previewLang;
  const active = form.variants.filter((v) => v.is_active);
  const prices = active.map((v) => toNum(v.price));
  const single = active.length <= 1;
  const v0 = active[0];
  const priceLine = single && v0
    ? (toNum(v0.old_price) > toNum(v0.price) ? `💰 <b>${money(v0.price)}</b>  <s>${money(v0.old_price)}</s>  <i>−${Math.round((1 - toNum(v0.price) / toNum(v0.old_price)) * 100)}%</i>` : `💰 <b>${money(v0?.price)}</b>`)
    : `💰 from <b>${money(Math.min(...(prices.length ? prices : [0])))}</b>`;
  const stockLine = form.stock_mode === "unlimited" ? "🟢 In stock" : product?.stock === 0 ? "🔴 Out of stock" : "🟢 In stock";
  const w = tr(form.warranty, L);
  const previewHtml = [
    `${form.emoji ?? ""} <b>${tr(form.name, L) || "Product name"}</b>`.trim(), tr(form.short_description, L), "", priceLine, stockLine, "",
    tr(form.description, L), w ? `\n🛡 <b>Warranty:</b> ${w}` : "",
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const groupKey = form.option_groups.find((g) => g.key)?.key;
  const keyboard: PreviewButton[][] = single
    ? [[{ text: "−" }, { text: "× 1" }, { text: "+" }], [{ text: "🛒 Add to cart" }, { text: "⚡ Buy now", style: "success" }], [{ text: "♡ Save" }], [{ text: "← Back" }, { text: "🏠 Home" }]]
    : [...Array.from(new Set(active.map((v) => groupKey ? v.attributes[groupKey] : tr(v.name, L)))).slice(0, 6).map((val) => [{ text: `${val} · ${money(Math.min(...active.filter((v) => (groupKey ? v.attributes[groupKey] : tr(v.name, L)) === val).map((v) => toNum(v.price))))}` }]), [{ text: "← Back" }, { text: "🏠 Home" }]];

  return (
    <div>
      <Link href="/products" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5" />Products</Link>
      <div className="sticky top-14 z-10 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-transparent bg-bg/80 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[26px]">{form.emoji || "📦"}</span>
          <div className="min-w-0">
            <h1 className="truncate text-[20px] font-semibold tracking-[-0.02em]">{tr(form.name) || "New product"}</h1>
            <div className="flex items-center gap-2 text-[12.5px] text-fg-3"><StatusBadge status={form.status} />{dirty ? <span>Unsaved changes</span> : product ? <span>All changes saved</span> : null}</div>
          </div>
        </div>
        <div className="flex gap-2">
          {product ? <Link href={`/inventory?product=${product.id}`}><Button><Boxes />Inventory</Button></Link> : null}
          {canEdit ? <Button variant="primary" onClick={submit} loading={save.isPending}><Save />{product ? "Save changes" : "Create product"}</Button> : null}
        </div>
      </div>
      {errors.length ? <div className="mb-4 rounded-[10px] border border-danger/30 bg-danger-bg px-4 py-3 text-[13px] text-danger">{errors.join(" · ")}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <fieldset disabled={!canEdit} className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Basics" description="Name, description and how the product is presented" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
                <Field label="Emoji"><EmojiPicker value={form.emoji} onChange={(v) => set("emoji", v)} customEmojiId={form.custom_emoji_id} onCustomEmojiChange={(v) => set("custom_emoji_id", v)} /></Field>
                <Field label="Name" required><I18nInput value={form.name} onChange={(v) => set("name", v)} placeholder="e.g. ChatGPT Plus" /></Field>
              </div>
              <Field label="Short description" help="One line under the name in the bot."><I18nInput value={form.short_description} onChange={(v) => set("short_description", v)} /></Field>
              <Field label="Full description" help="Telegram formatting is supported.">
                <I18nInput value={form.description} onChange={(v) => set("description", v)} render={(val, s) => <TgEditor value={val} onChange={s} rows={6} />} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Category">
                  <Select value={form.category_id ? String(form.category_id) : ""} onChange={(v) => set("category_id", v ? Number(v) : null)} allowEmpty="No category"
                    options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: `${c.emoji ?? ""} ${tr(c.name)}`.trim() }))} />
                </Field>
                <Field label="Status">
                  <Select value={form.status} onChange={(v) => set("status", v)} options={PRODUCT_STATUSES} />
                </Field>
                <Field label="URL slug" help="Used in deep links: t.me/bot?start=p_ID"><Input value={form.slug} onChange={(e) => set("slug", e.target.value)} placeholder="auto-generated" /></Field>
                <Field label="Tags" help="Comma separated, used by search">
                  <Input value={form.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean))} />
                </Field>
              </div>
              <label className="flex items-center gap-2.5 text-[13px] text-fg-2"><Switch checked={form.is_featured} onCheckedChange={(v) => set("is_featured", v)} />Featured product</label>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Image" description="Shown above the product card in Telegram (JPG, PNG, WebP, GIF or MP4)" />
            <CardBody><MediaPicker value={form.media_id} onChange={(v) => set("media_id", v)} className="max-w-md" /></CardBody>
          </Card>

          <Card>
            <CardHeader title="Pricing & variants" description="Each variant has its own price, SKU, stock and delivery"
              action={<Button size="sm" onClick={() => set("variants", [...form.variants, blankVariant(form.variants.length)])}><Plus />Variant</Button>} />
            <CardBody className="space-y-4">
              <div className="rounded-[12px] border border-border bg-surface-2/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[13px] font-medium">Option groups <span className="font-normal text-fg-3">— customers pick step by step (e.g. Plan → Duration)</span></div>
                  {form.option_groups.length < 3 ? <Button size="sm" variant="ghost" onClick={() => set("option_groups", [...form.option_groups, { key: "", name: { en: "" }, values: "" }])}><Plus />Group</Button> : null}
                </div>
                {form.option_groups.length ? (
                  <div className="space-y-2">
                    {form.option_groups.map((g, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[160px_120px_1fr_auto]">
                        <Input placeholder="Name (e.g. Plan)" value={g.name.en ?? ""} onChange={(e) => set("option_groups", form.option_groups.map((x, j) => j === i ? { ...x, name: { ...x.name, en: e.target.value }, key: x.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_") } : x))} />
                        <Input placeholder="key" className="font-mono" value={g.key} onChange={(e) => set("option_groups", form.option_groups.map((x, j) => j === i ? { ...x, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") } : x))} />
                        <Input placeholder="Values for generator: Plus, Pro" value={g.values ?? ""} onChange={(e) => set("option_groups", form.option_groups.map((x, j) => j === i ? { ...x, values: e.target.value } : x))} />
                        <Button size="icon" variant="danger-ghost" aria-label="Remove group" onClick={() => set("option_groups", form.option_groups.filter((_, j) => j !== i))}><Trash2 /></Button>
                      </div>
                    ))}
                    <Button size="sm" onClick={generate}><Wand2 />Generate variant combinations</Button>
                  </div>
                ) : <p className="text-[12.5px] text-fg-3">No groups: customers choose from a flat list of variants (or skip selection when there&apos;s only one).</p>}
              </div>

              <div className="space-y-2">
                {form.variants.map((v, i) => (
                  <div key={v.id ?? `new-${i}`} className={cn("rounded-[12px] border border-border p-3", !v.is_active && "opacity-60")}>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,0.7fr))]">
                      <Field label={`Variant ${i + 1}`}><Input value={v.name.en ?? ""} onChange={(e) => setVariant(i, { name: { ...v.name, en: e.target.value } })} placeholder="e.g. Plus · 1 month" /></Field>
                      <Field label="Price"><Input type="number" step="0.01" min="0" value={String(v.price ?? "")} onChange={(e) => setVariant(i, { price: e.target.value })} suffix={brand?.currency} /></Field>
                      <Field label="Old price"><Input type="number" step="0.01" min="0" value={v.old_price === null || v.old_price === undefined ? "" : String(v.old_price)} onChange={(e) => setVariant(i, { old_price: e.target.value || null })} placeholder="—" /></Field>
                      <Field label="Cost"><Input type="number" step="0.01" min="0" value={v.cost_price === null || v.cost_price === undefined ? "" : String(v.cost_price)} onChange={(e) => setVariant(i, { cost_price: e.target.value || null })} placeholder="for profit" /></Field>
                    </div>
                    <div className="mt-2 flex flex-wrap items-end gap-2">
                      {form.option_groups.filter((g) => g.key).map((g) => (
                        <Field key={g.key} label={tr(g.name) || g.key} className="w-36">
                          <Input value={v.attributes[g.key] ?? ""} onChange={(e) => setVariant(i, { attributes: { ...v.attributes, [g.key]: e.target.value } })} />
                        </Field>
                      ))}
                      <Field label="SKU" className="w-44"><Input className="font-mono" value={v.sku} onChange={(e) => setVariant(i, { sku: e.target.value })} placeholder="auto" /></Field>
                      {form.stock_mode === "manual" ? <Field label="Stock" className="w-24"><Input type="number" min="0" value={String(v.manual_stock)} onChange={(e) => setVariant(i, { manual_stock: Number(e.target.value) })} /></Field> : null}
                      {v.stock !== undefined && v.stock !== null && form.stock_mode === "inventory" ? <Badge tone={v.stock ? "success" : "danger"} className="mb-1.5">{v.stock} in stock</Badge> : null}
                      <label className="mb-1.5 ml-auto flex items-center gap-2 text-[12.5px] text-fg-2"><Switch checked={v.is_active} onCheckedChange={(x) => setVariant(i, { is_active: x })} />Active</label>
                      {form.variants.length > 1 ? <Button size="icon" variant="danger-ghost" aria-label="Remove variant" onClick={() => set("variants", form.variants.filter((_, j) => j !== i))}><Trash2 /></Button> : null}
                    </div>
                    {Object.keys(v.name).length > 0 && langs.length > 1 ? (
                      <details className="mt-2 text-[12.5px]"><summary className="cursor-pointer text-fg-3 hover:text-fg">Translations & instructions</summary>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <Field label="Variant name"><I18nInput value={v.name} onChange={(x) => setVariant(i, { name: x })} /></Field>
                          <Field label="Variant-specific instructions"><I18nInput multiline rows={2} value={v.instructions ?? {}} onChange={(x) => setVariant(i, { instructions: x })} /></Field>
                        </div>
                      </details>
                    ) : null}
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Stock & delivery" description="How stock is counted and how the product reaches the customer after payment" />
            <CardBody className="space-y-4">
              <Field label="Stock mode">
                <Segmented value={form.stock_mode} onChange={(v) => set("stock_mode", v)} options={[{ value: "inventory", label: "Inventory items" }, { value: "unlimited", label: "Unlimited" }, { value: "manual", label: "Manual counter" }]} />
              </Field>
              <Field label="Delivery">
                <div className="grid gap-2 sm:grid-cols-3">
                  {DELIVERY.map((d) => (
                    <button key={d.value} type="button" onClick={() => set("delivery_mode", d.value)}
                      className={cn("rounded-[10px] border border-border p-2.5 text-left transition-colors hover:border-border-strong", form.delivery_mode === d.value && "border-accent bg-accent/[0.06] ring-1 ring-accent/30")}>
                      <div className="text-[12.5px] font-medium">{d.label}</div>
                      <div className="mt-0.5 text-[11.5px] text-fg-3">{d.hint}</div>
                    </button>
                  ))}
                </div>
              </Field>
              {form.delivery_mode === "inventory" && form.stock_mode !== "inventory" ? <p className="rounded-[9px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning">Inventory delivery needs the “Inventory items” stock mode.</p> : null}
              {form.delivery_mode === "text" ? (
                <Field label="Delivered text" help="Sent to every buyer (e.g. an activation link)."><I18nInput multiline rows={3} value={(cfg.text as I18n) ?? {}} onChange={(v) => setCfg({ text: v })} /></Field>
              ) : null}
              {form.delivery_mode === "file" ? (
                <Field label="Delivered file"><MediaPicker value={(cfg.media_id as string) ?? null} onChange={(v) => setCfg({ media_id: v })} kinds={["document", "image", "video", "animation"]} label="Choose file" aspect="aspect-[3/1]" className="max-w-md" /></Field>
              ) : null}
              {form.delivery_mode === "api" || form.delivery_mode === "webhook" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Endpoint URL" className="sm:col-span-2" help={form.delivery_mode === "api" ? "We POST the order (JSON, HMAC-signed). Respond with {\"items\": [\"code\", …]}." : "We POST the order; deliver later by calling the callback_url with {\"items\": [...]} signed with the same secret."}>
                    <Input value={(cfg.url as string) ?? ""} onChange={(e) => setCfg({ url: e.target.value })} placeholder="https://api.example.com/fulfill" />
                  </Field>
                  <Field label="Signing secret" help={cfg.secret_set ? "A secret is set. Enter a new one to replace it." : "Used for X-Nexa-Signature (HMAC-SHA256)."}>
                    <Input type="password" value={(cfg.secret as string) ?? ""} onChange={(e) => setCfg({ secret: e.target.value })} placeholder={cfg.secret_set ? "••••••••" : ""} />
                  </Field>
                  {form.delivery_mode === "api" ? (
                    <Field label="Authorization header" help={cfg.auth_set ? "Set. Enter a new value to replace." : "Optional, e.g. Bearer …"}>
                      <Input type="password" value={(cfg.auth as string) ?? ""} onChange={(e) => setCfg({ auth: e.target.value })} placeholder={cfg.auth_set ? "••••••••" : ""} />
                    </Field>
                  ) : null}
                </div>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Delivery instructions" help="Shown with the delivered product."><I18nInput multiline rows={3} value={form.delivery_instructions} onChange={(v) => set("delivery_instructions", v)} /></Field>
                <Field label="Warranty"><I18nInput value={form.warranty} onChange={(v) => set("warranty", v)} placeholder="e.g. 30 days" /></Field>
              </div>
              <Field label="Low stock alert at" className="w-48"><Input type="number" min="0" value={String(form.low_stock_threshold ?? 5)} onChange={(e) => set("low_stock_threshold", Number(e.target.value))} /></Field>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Limits & availability" />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                <Field label="Min. quantity"><Input type="number" min="1" value={String(form.min_quantity ?? 1)} onChange={(e) => set("min_quantity", Number(e.target.value))} /></Field>
                <Field label="Max. per order"><Input type="number" min="1" value={form.max_quantity ? String(form.max_quantity) : ""} placeholder="∞" onChange={(e) => set("max_quantity", e.target.value ? Number(e.target.value) : null)} /></Field>
                <Field label="Max. per customer"><Input type="number" min="1" value={form.max_per_customer ? String(form.max_per_customer) : ""} placeholder="∞" onChange={(e) => set("max_per_customer", e.target.value ? Number(e.target.value) : null)} /></Field>
                <Field label="Sort order"><Input type="number" value={String(form.sort_order)} onChange={(e) => set("sort_order", Number(e.target.value))} /></Field>
              </div>
              <Field label="Visible for languages" help="Leave all unchecked to show the product to everyone.">
                <div className="flex flex-wrap gap-3">
                  {langs.map((l) => (
                    <label key={l.code} className="flex items-center gap-2 text-[13px] text-fg-2">
                      <Checkbox checked={(form.languages ?? []).includes(l.code)} onCheckedChange={(c) => set("languages", c ? [...(form.languages ?? []), l.code] : (form.languages ?? []).filter((x) => x !== l.code))} />
                      {l.flag} {l.native_name}
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Regions" help="Informational region codes (e.g. US, EU, GLOBAL) shown to admins and in exports.">
                <Input value={(form.regions ?? []).join(", ")} onChange={(e) => set("regions", e.target.value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))} />
              </Field>
            </CardBody>
          </Card>
        </fieldset>

        <div className="xl:sticky xl:top-[120px] xl:self-start">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-fg-2"><Sparkles className="size-3.5 text-accent" />Live preview</div>
            <LangTabs value={previewLang} onChange={setPreviewLang} />
          </div>
          <TelegramPreview botName={brand?.store_name} html={previewHtml} keyboard={keyboard}
            media={form.media_id ? { url: mediaUrl(form.media_id), kind: "image" } : null} />
          {product ? (
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              {[["Sold", product.sold_count], ["Views", product.views_count], ["Rating", product.rating_count ? `${toNum(product.rating_avg).toFixed(1)}★` : "—"]].map(([l, v]) => (
                <div key={String(l)} className="card px-2 py-2.5"><div className="text-[11.5px] text-fg-3">{l}</div><div className="text-[14px] font-semibold tabular">{v}</div></div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
