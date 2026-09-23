import { ArrowDown, ArrowUp, Boxes, ImagePlus, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link } from "react-router";
import { LocalizedField } from "~/components/admin/localized-input";
import { MediaLibraryDialog, MediaPicker, useImageUpload } from "~/components/admin/media-picker";
import { MoneyInput } from "~/components/admin/money-input";
import { Panel } from "~/components/admin/page";
import { Button } from "~/components/ui/button";
import { SwitchField } from "~/components/ui/field";
import { useT } from "~/i18n/react";
import { DELIVERY_TYPES } from "~/lib/domain";
import { cn, slugify } from "~/lib/format";
import { SUPPORTED_CURRENCIES } from "~/lib/money";
import type { Option, SectionProps } from "./types";

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list];
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target] as T, next[index] as T];
  return next;
}

export function BasicsSection({ draft, set, categories, errors }: SectionProps & { categories: Option[]; errors: Record<string, string> }) {
  const t = useT();
  return (
    <Panel id="basics" title={t("admin.product.section.basics")}>
      <div className="grid gap-5">
        <LocalizedField label={t("admin.product.name")} value={draft.name} onChange={(value) => set("name", value)} required error={errors.name} />
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="slug">
              {t("admin.product.slug")}
            </label>
            <input
              id="slug"
              className="input font-mono text-[13px]"
              value={draft.slug}
              placeholder={slugify(draft.name.en ?? draft.name.ru ?? "") || "product-slug"}
              onChange={(event) => set("slug", slugify(event.target.value) || event.target.value.toLowerCase())}
              aria-invalid={errors.slug ? true : undefined}
            />
            {errors.slug ? <p className="field-error">{errors.slug}</p> : <p className="field-hint">/product/{draft.slug || slugify(draft.name.en ?? "") || "…"}</p>}
          </div>
          <div>
            <label className="field-label" htmlFor="category">
              {t("admin.product.category")}
            </label>
            <select id="category" className="input" value={draft.categoryId ?? ""} onChange={(event) => set("categoryId", event.target.value || null)}>
              <option value="">{t("admin.product.noCategory")}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <LocalizedField label={t("admin.product.shortDescription")} value={draft.shortDescription} onChange={(value) => set("shortDescription", value)} multiline rows={2} />
        <LocalizedField label={t("admin.product.description")} value={draft.description} onChange={(value) => set("description", value)} multiline rows={8} hint={t("admin.markdownHint")} />
        <div>
          <label className="field-label" htmlFor="tags">
            {t("admin.product.tags")}
          </label>
          <input id="tags" className="input" value={draft.tags} placeholder="ai, chatgpt, subscription" onChange={(event) => set("tags", event.target.value)} />
          <p className="field-hint">{t("admin.product.tagsHint")}</p>
        </div>
      </div>
    </Panel>
  );
}

export function MediaSection({ draft, set }: SectionProps) {
  const t = useT();
  const [library, setLibrary] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useImageUpload((url) => set("gallery", [...draft.gallery, { url, alt: "" }]));
  return (
    <Panel id="media" title={t("admin.product.section.media")}>
      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <div className="space-y-4">
          <MediaPicker label={t("admin.product.thumbnail")} value={draft.thumbnailUrl} onChange={(url) => set("thumbnailUrl", url)} />
          <div>
            <label className="field-label" htmlFor="accent">
              {t("admin.product.accent")}
            </label>
            <div className="flex items-center gap-2">
              <input id="accent" type="color" value={draft.accent} onChange={(event) => set("accent", event.target.value)} className="size-10 cursor-pointer rounded-lg border border-line-strong bg-transparent p-1" />
              <input className="input font-mono text-[13px]" value={draft.accent} onChange={(event) => /^#[0-9a-fA-F]{0,6}$/.test(event.target.value) && set("accent", event.target.value)} aria-label={t("admin.product.accent")} />
            </div>
            <p className="field-hint">{t("admin.product.accentHint")}</p>
          </div>
        </div>
        <div>
          <span className="field-label">{t("admin.product.gallery")}</span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {draft.gallery.map((image, index) => (
              <div key={`${image.url}-${index}`} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-line bg-panel-2">
                <img src={image.url} alt={image.alt} className="size-full object-cover" />
                <div className="absolute inset-x-1.5 bottom-1.5 flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                  <button type="button" className="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur" onClick={() => set("gallery", move(draft.gallery, index, -1))} aria-label={t("admin.moveUp")}>
                    <ArrowUp className="size-3.5" />
                  </button>
                  <button type="button" className="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur" onClick={() => set("gallery", move(draft.gallery, index, 1))} aria-label={t("admin.moveDown")}>
                    <ArrowDown className="size-3.5" />
                  </button>
                  <button type="button" className="grid size-7 place-items-center rounded-md bg-black/60 text-white backdrop-blur hover:text-danger" onClick={() => set("gallery", draft.gallery.filter((_, i) => i !== index))} aria-label={t("common.remove")}>
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => input.current?.click()} className="flex aspect-[4/3] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-fg-subtle transition-colors hover:border-accent/50 hover:text-fg" disabled={uploading}>
              <ImagePlus className="size-5" />
              <span className="text-xs">{uploading ? t("admin.media.uploading") : t("admin.media.upload")}</span>
            </button>
          </div>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={(event) => upload(event.target.files?.[0]).then(() => (event.target.value = ""))} />
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => setLibrary(true)}>
            {t("admin.media.fromLibrary")}
          </Button>
          <MediaLibraryDialog open={library} onClose={() => setLibrary(false)} onSelect={(url) => set("gallery", [...draft.gallery, { url, alt: "" }])} />
        </div>
      </div>
    </Panel>
  );
}

export function PricingSection({ draft, set }: SectionProps) {
  const t = useT();
  return (
    <Panel id="pricing" title={t("admin.product.section.pricing")} description={draft.variants.length ? t("admin.product.pricingVariantsHint") : undefined}>
      <div className="grid gap-5 sm:grid-cols-3">
        <div>
          <label className="field-label" htmlFor="price">
            {t("admin.product.price")} <span className="text-danger">*</span>
          </label>
          <MoneyInput id="price" value={draft.price} currency={draft.currency} onChange={(value) => set("price", value ?? 0)} />
        </div>
        <div>
          <label className="field-label" htmlFor="oldPrice">
            {t("admin.product.oldPrice")}
          </label>
          <MoneyInput id="oldPrice" value={draft.oldPrice} currency={draft.currency} nullable placeholder="—" onChange={(value) => set("oldPrice", value)} />
        </div>
        <div>
          <label className="field-label" htmlFor="currency">
            {t("admin.product.currency")}
          </label>
          <select id="currency" className="input" value={draft.currency} onChange={(event) => set("currency", event.target.value as typeof draft.currency)}>
            {SUPPORTED_CURRENCIES.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="field-label" htmlFor="minQuantity">
            {t("admin.product.minQuantity")}
          </label>
          <input id="minQuantity" type="number" min={1} className="input tabular" value={draft.minQuantity} onChange={(event) => set("minQuantity", Math.max(1, Number(event.target.value) || 1))} />
        </div>
        <div>
          <label className="field-label" htmlFor="maxQuantity">
            {t("admin.product.maxQuantity")}
          </label>
          <input id="maxQuantity" type="number" min={1} className="input tabular" value={draft.maxQuantity} onChange={(event) => set("maxQuantity", Math.max(1, Number(event.target.value) || 1))} />
        </div>
      </div>

      <div className="mt-6 border-t border-line pt-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">{t("admin.product.bulk")}</p>
            <p className="text-xs text-fg-subtle">{t("admin.product.bulkHint")}</p>
          </div>
          <Button size="sm" onClick={() => set("quantityDiscounts", [...draft.quantityDiscounts, { minQuantity: (draft.quantityDiscounts.at(-1)?.minQuantity ?? 1) + 1, percent: 5 }])} disabled={draft.quantityDiscounts.length >= 10}>
            <Plus className="size-3.5" />
            {t("admin.add")}
          </Button>
        </div>
        {draft.quantityDiscounts.length > 0 ? (
          <div className="mt-4 space-y-2">
            {draft.quantityDiscounts.map((tier, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="text-fg-muted">{t("admin.product.bulkFrom")}</span>
                <input type="number" min={2} className="input input-sm w-20 tabular" value={tier.minQuantity} onChange={(event) => set("quantityDiscounts", draft.quantityDiscounts.map((item, i) => (i === index ? { ...item, minQuantity: Math.max(2, Number(event.target.value) || 2) } : item)))} aria-label={t("admin.product.bulkFrom")} />
                <span className="text-fg-muted">{t("admin.product.bulkPcs")}</span>
                <input type="number" min={1} max={90} className="input input-sm w-20 tabular" value={tier.percent} onChange={(event) => set("quantityDiscounts", draft.quantityDiscounts.map((item, i) => (i === index ? { ...item, percent: Math.min(90, Math.max(1, Number(event.target.value) || 1)) } : item)))} aria-label="%" />
                <span className="text-fg-muted">%</span>
                <Button size="sm" variant="ghost" icon onClick={() => set("quantityDiscounts", draft.quantityDiscounts.filter((_, i) => i !== index))} aria-label={t("common.remove")}>
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function VariantsSection({ draft, set }: SectionProps) {
  const t = useT();
  const update = (index: number, patch: Partial<(typeof draft.variants)[number]>) => set("variants", draft.variants.map((variant, i) => (i === index ? { ...variant, ...patch } : variant)));
  return (
    <Panel
      id="variants"
      title={t("admin.product.section.variants")}
      description={t("admin.product.variantsHint")}
      actions={
        <Button size="sm" onClick={() => set("variants", [...draft.variants, { name: {}, sku: null, price: draft.price, oldPrice: null, stock: 0, unlimitedStock: false, isActive: true }])}>
          <Plus className="size-3.5" />
          {t("admin.product.addVariant")}
        </Button>
      }
    >
      {draft.variants.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t("admin.product.noVariants")}</p>
      ) : (
        <div className="space-y-3">
          {draft.variants.map((variant, index) => (
            <div key={variant.id ?? `new-${index}`} className={cn("rounded-xl border border-line bg-panel-2/40 p-4", !variant.isActive && "opacity-60")}>
              <div className="grid gap-4 lg:grid-cols-[1fr_160px_160px]">
                <LocalizedField label={t("admin.product.variantName")} value={variant.name} onChange={(name) => update(index, { name })} required />
                <div>
                  <span className="field-label">{t("admin.product.price")}</span>
                  <MoneyInput value={variant.price} currency={draft.currency} onChange={(price) => update(index, { price: price ?? 0 })} ariaLabel={t("admin.product.price")} />
                </div>
                <div>
                  <span className="field-label">{t("admin.product.oldPrice")}</span>
                  <MoneyInput value={variant.oldPrice} currency={draft.currency} nullable placeholder="—" onChange={(oldPrice) => update(index, { oldPrice })} ariaLabel={t("admin.product.oldPrice")} />
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <div className="w-40">
                  <span className="field-label">SKU</span>
                  <input className="input input-sm font-mono" value={variant.sku ?? ""} onChange={(event) => update(index, { sku: event.target.value || null })} aria-label="SKU" />
                </div>
                {draft.deliveryType === "manual" ? (
                  <>
                    <div className="w-28">
                      <span className="field-label">{t("admin.product.stock")}</span>
                      <input type="number" min={0} className="input input-sm tabular" value={variant.stock} disabled={variant.unlimitedStock} onChange={(event) => update(index, { stock: Math.max(0, Number(event.target.value) || 0) })} aria-label={t("admin.product.stock")} />
                    </div>
                    <label className="flex h-[34px] items-center gap-2 text-[13px] text-fg-muted">
                      <input type="checkbox" className="checkbox" checked={variant.unlimitedStock} onChange={(event) => update(index, { unlimitedStock: event.target.checked })} />
                      {t("admin.product.unlimited")}
                    </label>
                  </>
                ) : null}
                <label className="flex h-[34px] items-center gap-2 text-[13px] text-fg-muted">
                  <input type="checkbox" className="checkbox" checked={variant.isActive} onChange={(event) => update(index, { isActive: event.target.checked })} />
                  {t("admin.active")}
                </label>
                <div className="ml-auto flex gap-1">
                  <Button size="sm" variant="ghost" icon onClick={() => set("variants", move(draft.variants, index, -1))} aria-label={t("admin.moveUp")}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" icon onClick={() => set("variants", move(draft.variants, index, 1))} aria-label={t("admin.moveDown")}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" icon onClick={() => set("variants", draft.variants.filter((_, i) => i !== index))} aria-label={t("common.remove")}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function DeliverySection({ draft, set }: SectionProps) {
  const t = useT();
  return (
    <Panel id="delivery" title={t("admin.product.section.delivery")}>
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
        {DELIVERY_TYPES.map((type) => (
          <button
            key={type}
            type="button"
            role="radio"
            aria-checked={draft.deliveryType === type}
            onClick={() => set("deliveryType", type)}
            className={cn("rounded-xl border p-4 text-left transition-colors", draft.deliveryType === type ? "border-accent/60 bg-accent-soft" : "border-line bg-panel-2/40 hover:border-line-strong")}
          >
            <p className="text-sm font-semibold">{t(`admin.delivery.${type}`)}</p>
            <p className="mt-1 text-xs leading-5 text-fg-subtle">{t(`admin.delivery.${type}.hint`)}</p>
          </button>
        ))}
      </div>

      <div className="mt-5 grid gap-5">
        {draft.deliveryType === "inventory" ? (
          <div className="flex flex-col gap-3 rounded-xl border border-line bg-panel-2/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Boxes className="size-5 text-accent-strong" />
              <p className="text-sm text-fg-muted">
                {t("admin.product.inventoryStats", { available: draft.inventory.available, reserved: draft.inventory.reserved, sold: draft.inventory.sold })}
              </p>
            </div>
            {draft.id ? (
              <Link to={`/admin/inventory?product=${draft.id}`} className="btn btn-secondary btn-sm">
                {t("admin.product.manageInventory")}
              </Link>
            ) : (
              <span className="text-xs text-fg-subtle">{t("admin.product.saveFirst")}</span>
            )}
          </div>
        ) : null}
        {draft.deliveryType === "manual" && draft.variants.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="stock">
                {t("admin.product.stock")}
              </label>
              <input id="stock" type="number" min={0} className="input tabular" value={draft.stock} disabled={draft.unlimitedStock} onChange={(event) => set("stock", Math.max(0, Number(event.target.value) || 0))} />
            </div>
            <SwitchField className="self-end" label={t("admin.product.unlimited")} checked={draft.unlimitedStock} onChange={(event) => set("unlimitedStock", event.target.checked)} />
          </div>
        ) : null}
        {draft.deliveryType === "static" ? (
          <div>
            <label className="field-label" htmlFor="staticDelivery">
              {t("admin.product.staticContent")}
            </label>
            <textarea id="staticDelivery" rows={4} className="input font-mono text-[13px]" value={draft.staticDelivery ?? ""} onChange={(event) => set("staticDelivery", event.target.value || null)} />
            <p className="field-hint">{t("admin.product.staticHint")}</p>
          </div>
        ) : null}
        <LocalizedField label={t("admin.product.deliveryTime")} value={draft.deliveryTime} onChange={(value) => set("deliveryTime", value)} placeholder={t("admin.product.deliveryTimePlaceholder")} />
      </div>
    </Panel>
  );
}

export function DetailsSection({ draft, set, instructions }: SectionProps & { instructions: Option[] }) {
  const t = useT();
  return (
    <Panel id="details" title={t("admin.product.section.details")}>
      <div className="grid gap-5">
        <div>
          <label className="field-label" htmlFor="instruction">
            {t("admin.product.instruction")}
          </label>
          <select id="instruction" className="input" value={draft.instructionId ?? ""} onChange={(event) => set("instructionId", event.target.value || null)}>
            <option value="">{t("admin.product.noInstruction")}</option>
            {instructions.map((instruction) => (
              <option key={instruction.id} value={instruction.id}>
                {instruction.name}
              </option>
            ))}
          </select>
          <p className="field-hint">
            {t("admin.product.instructionHint")}{" "}
            <Link to="/admin/instructions/new" className="text-accent-strong hover:underline">
              {t("admin.instructions.new")}
            </Link>
          </p>
        </div>
        <LocalizedField label={t("admin.product.warranty")} value={draft.warranty} onChange={(value) => set("warranty", value)} multiline rows={2} />
        <LocalizedField label={t("admin.product.requirements")} value={draft.requirements} onChange={(value) => set("requirements", value)} multiline rows={3} hint={t("admin.markdownHint")} />
        <LocalizedField label={t("admin.product.region")} value={draft.regionRestrictions} onChange={(value) => set("regionRestrictions", value)} />
      </div>
    </Panel>
  );
}

export function FaqSection({ draft, set }: SectionProps) {
  const t = useT();
  return (
    <Panel
      id="faq"
      title={t("admin.product.section.faq")}
      actions={
        <Button size="sm" onClick={() => set("faq", [...draft.faq, { question: {}, answer: {} }])}>
          <Plus className="size-3.5" />
          {t("admin.add")}
        </Button>
      }
    >
      {draft.faq.length === 0 ? (
        <p className="text-sm text-fg-subtle">{t("admin.product.noFaq")}</p>
      ) : (
        <div className="space-y-3">
          {draft.faq.map((item, index) => (
            <div key={index} className="rounded-xl border border-line bg-panel-2/40 p-4">
              <div className="grid gap-4">
                <LocalizedField label={t("admin.faq.question")} value={item.question} onChange={(question) => set("faq", draft.faq.map((entry, i) => (i === index ? { ...entry, question } : entry)))} />
                <LocalizedField label={t("admin.faq.answer")} value={item.answer} multiline rows={3} onChange={(answer) => set("faq", draft.faq.map((entry, i) => (i === index ? { ...entry, answer } : entry)))} />
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" variant="ghost" onClick={() => set("faq", draft.faq.filter((_, i) => i !== index))}>
                  <Trash2 className="size-3.5" />
                  {t("common.remove")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function VisibilitySection({ draft, set }: SectionProps) {
  const t = useT();
  return (
    <Panel id="visibility" title={t("admin.product.section.visibility")}>
      <div className="grid gap-2">
        <SwitchField label={t("admin.product.active")} description={t("admin.product.activeHint")} checked={draft.isActive} onChange={(event) => set("isActive", event.target.checked)} />
        <SwitchField label={t("admin.product.featured")} description={t("admin.product.featuredHint")} checked={draft.isFeatured} onChange={(event) => set("isFeatured", event.target.checked)} />
        <SwitchField label={t("admin.product.popular")} description={t("admin.product.popularHint")} checked={draft.isPopular} onChange={(event) => set("isPopular", event.target.checked)} />
      </div>
      <div className="mt-4">
        <label className="field-label" htmlFor="sortPriority">
          {t("admin.product.sortPriority")}
        </label>
        <input id="sortPriority" type="number" className="input tabular" value={draft.sortPriority} onChange={(event) => set("sortPriority", Number(event.target.value) || 0)} />
        <p className="field-hint">{t("admin.product.sortPriorityHint")}</p>
      </div>
    </Panel>
  );
}

export function SeoSection({ draft, set }: SectionProps) {
  const t = useT();
  const title = draft.seoTitle.en || draft.name.en || draft.name.ru || "";
  const description = draft.seoDescription.en || draft.shortDescription.en || "";
  return (
    <Panel id="seo" title={t("admin.product.section.seo")}>
      <div className="grid gap-5">
        <LocalizedField label={t("admin.product.seoTitle")} value={draft.seoTitle} onChange={(value) => set("seoTitle", value)} hint={t("admin.product.seoFallback")} />
        <LocalizedField label={t("admin.product.seoDescription")} value={draft.seoDescription} onChange={(value) => set("seoDescription", value)} multiline rows={2} />
        <div className="rounded-xl border border-line bg-canvas/60 p-4">
          <p className="text-xs text-fg-subtle">{t("admin.product.seoPreview")}</p>
          <p className="mt-2 truncate text-[15px] text-[#8ab4f8]">{title || "—"}</p>
          <p className="truncate text-xs text-success/80">/product/{draft.slug || "…"}</p>
          <p className="mt-1 line-clamp-2 text-[13px] text-fg-muted">{description || "—"}</p>
        </div>
      </div>
    </Panel>
  );
}

export function RelatedSection({ draft, set, products }: SectionProps & { products: Option[] }) {
  const t = useT();
  const available = products.filter((product) => product.id !== draft.id && !draft.related.includes(product.id));
  return (
    <Panel id="related" title={t("admin.product.section.related")} description={t("admin.product.relatedHint")}>
      <div className="flex flex-wrap gap-2">
        {draft.related.map((id) => {
          const product = products.find((item) => item.id === id);
          if (!product) return null;
          return (
            <span key={id} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-panel-2 py-1 pr-1 pl-3 text-[13px]">
              {product.name}
              <button type="button" onClick={() => set("related", draft.related.filter((item) => item !== id))} className="rounded p-0.5 text-fg-subtle hover:text-fg" aria-label={t("common.remove")}>
                <Trash2 className="size-3.5" />
              </button>
            </span>
          );
        })}
      </div>
      {available.length > 0 && draft.related.length < 12 ? (
        <select className="input mt-3" value="" onChange={(event) => event.target.value && set("related", [...draft.related, event.target.value])} aria-label={t("admin.product.addRelated")}>
          <option value="">{t("admin.product.addRelated")}</option>
          {available.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name}
            </option>
          ))}
        </select>
      ) : null}
    </Panel>
  );
}
