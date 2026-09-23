import { ArrowDown, ArrowUp, Code2, Heading, HelpCircle, Image, Link2, ListOrdered, Megaphone, Plus, Trash2, Type } from "lucide-react";
import type { ReactNode } from "react";
import { MediaPicker } from "~/components/admin/media-picker";
import { Button } from "~/components/ui/button";
import { useT } from "~/i18n/react";
import { BLOCK_TYPES, emptyBlock, type InstructionBlock, type InstructionBlockType } from "~/lib/instructions";
import { cn } from "~/lib/format";

const BLOCK_ICONS: Record<InstructionBlockType, typeof Type> = {
  heading: Heading,
  paragraph: Type,
  steps: ListOrdered,
  image: Image,
  callout: Megaphone,
  code: Code2,
  link: Link2,
  faq: HelpCircle,
};

function BlockFrame({ type, index, count, onMove, onRemove, children }: { type: InstructionBlockType; index: number; count: number; onMove: (delta: number) => void; onRemove: () => void; children: ReactNode }) {
  const t = useT();
  const Icon = BLOCK_ICONS[type];
  return (
    <div className="rounded-xl border border-line bg-panel-2/40">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-fg-muted">
          <Icon className="size-3.5 text-accent-strong" />
          {t(`admin.block.${type}`)}
        </span>
        <div className="flex gap-0.5">
          <Button size="sm" variant="ghost" icon onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("admin.moveUp")}>
            <ArrowUp className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" icon onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("admin.moveDown")}>
            <ArrowDown className="size-3.5" />
          </Button>
          <Button size="sm" variant="ghost" icon onClick={onRemove} aria-label={t("common.remove")}>
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}

export function BlockEditor({ blocks, onChange }: { blocks: InstructionBlock[]; onChange: (blocks: InstructionBlock[]) => void }) {
  const t = useT();
  const update = (index: number, block: InstructionBlock) => onChange(blocks.map((item, i) => (i === index ? block : item)));
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target] as InstructionBlock, next[index] as InstructionBlock];
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => (
        <BlockFrame key={index} type={block.type} index={index} count={blocks.length} onMove={(delta) => move(index, delta)} onRemove={() => onChange(blocks.filter((_, i) => i !== index))}>
          {block.type === "heading" ? <input className="input font-semibold" value={block.text} placeholder={t("admin.block.headingPlaceholder")} onChange={(event) => update(index, { ...block, text: event.target.value })} aria-label={t("admin.block.heading")} /> : null}
          {block.type === "paragraph" ? (
            <>
              <textarea className="input" rows={4} value={block.text} placeholder={t("admin.block.paragraphPlaceholder")} onChange={(event) => update(index, { ...block, text: event.target.value })} aria-label={t("admin.block.paragraph")} />
              <p className="field-hint">{t("admin.markdownHint")}</p>
            </>
          ) : null}
          {block.type === "steps" ? (
            <div className="space-y-3">
              {block.items.map((step, stepIndex) => (
                <div key={stepIndex} className="flex gap-3">
                  <span className="mt-2 grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft font-mono text-xs text-accent-strong">{stepIndex + 1}</span>
                  <div className="min-w-0 flex-1 space-y-2">
                    <input className="input input-sm" value={step.title} placeholder={t("admin.block.stepTitle")} onChange={(event) => update(index, { ...block, items: block.items.map((item, i) => (i === stepIndex ? { ...item, title: event.target.value } : item)) })} aria-label={t("admin.block.stepTitle")} />
                    <textarea className="input text-[13px]" rows={2} value={step.text} placeholder={t("admin.block.stepText")} onChange={(event) => update(index, { ...block, items: block.items.map((item, i) => (i === stepIndex ? { ...item, text: event.target.value } : item)) })} aria-label={t("admin.block.stepText")} />
                    <input className="input input-sm" value={step.image ?? ""} placeholder={t("admin.block.stepImage")} onChange={(event) => update(index, { ...block, items: block.items.map((item, i) => (i === stepIndex ? { ...item, image: event.target.value } : item)) })} aria-label={t("admin.block.stepImage")} />
                  </div>
                  <Button size="sm" variant="ghost" icon className="mt-1" onClick={() => update(index, { ...block, items: block.items.filter((_, i) => i !== stepIndex) })} aria-label={t("common.remove")}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button size="sm" onClick={() => update(index, { ...block, items: [...block.items, { title: "", text: "" }] })}>
                <Plus className="size-3.5" />
                {t("admin.block.addStep")}
              </Button>
            </div>
          ) : null}
          {block.type === "image" ? (
            <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
              <MediaPicker value={block.url || null} onChange={(url) => update(index, { ...block, url: url ?? "" })} />
              <input className="input" value={block.caption ?? ""} placeholder={t("admin.block.caption")} onChange={(event) => update(index, { ...block, caption: event.target.value })} aria-label={t("admin.block.caption")} />
            </div>
          ) : null}
          {block.type === "callout" ? (
            <>
              <div className="flex gap-1.5">
                {(["note", "tip", "warning"] as const).map((tone) => (
                  <button key={tone} type="button" onClick={() => update(index, { ...block, tone })} className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors", block.tone === tone ? "border-accent/50 bg-accent-soft text-fg" : "border-line text-fg-muted hover:text-fg")}>
                    {t(`admin.block.tone.${tone}`)}
                  </button>
                ))}
              </div>
              <input className="input input-sm" value={block.title ?? ""} placeholder={t("admin.block.calloutTitle")} onChange={(event) => update(index, { ...block, title: event.target.value })} aria-label={t("admin.block.calloutTitle")} />
              <textarea className="input text-[13px]" rows={2} value={block.text} onChange={(event) => update(index, { ...block, text: event.target.value })} aria-label={t("admin.block.callout")} />
            </>
          ) : null}
          {block.type === "code" ? (
            <>
              <input className="input input-sm w-40 font-mono" value={block.language} placeholder="bash" onChange={(event) => update(index, { ...block, language: event.target.value })} aria-label={t("admin.block.language")} />
              <textarea className="input font-mono text-[13px]" rows={5} value={block.code} spellCheck={false} onChange={(event) => update(index, { ...block, code: event.target.value })} aria-label={t("admin.block.code")} />
            </>
          ) : null}
          {block.type === "link" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="input" value={block.label} placeholder={t("admin.block.linkLabel")} onChange={(event) => update(index, { ...block, label: event.target.value })} aria-label={t("admin.block.linkLabel")} />
              <input className="input" value={block.url} placeholder="https://" onChange={(event) => update(index, { ...block, url: event.target.value })} aria-label="URL" />
            </div>
          ) : null}
          {block.type === "faq" ? (
            <div className="space-y-3">
              {block.items.map((item, faqIndex) => (
                <div key={faqIndex} className="flex gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <input className="input input-sm" value={item.question} placeholder={t("admin.faq.question")} onChange={(event) => update(index, { ...block, items: block.items.map((entry, i) => (i === faqIndex ? { ...entry, question: event.target.value } : entry)) })} aria-label={t("admin.faq.question")} />
                    <textarea className="input text-[13px]" rows={2} value={item.answer} placeholder={t("admin.faq.answer")} onChange={(event) => update(index, { ...block, items: block.items.map((entry, i) => (i === faqIndex ? { ...entry, answer: event.target.value } : entry)) })} aria-label={t("admin.faq.answer")} />
                  </div>
                  <Button size="sm" variant="ghost" icon onClick={() => update(index, { ...block, items: block.items.filter((_, i) => i !== faqIndex) })} aria-label={t("common.remove")}>
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button size="sm" onClick={() => update(index, { ...block, items: [...block.items, { question: "", answer: "" }] })}>
                <Plus className="size-3.5" />
                {t("admin.add")}
              </Button>
            </div>
          ) : null}
        </BlockFrame>
      ))}

      <div className="rounded-xl border border-dashed border-line-strong p-3">
        <p className="mb-2 text-xs text-fg-subtle">{t("admin.block.add")}</p>
        <div className="flex flex-wrap gap-1.5">
          {BLOCK_TYPES.map((type) => {
            const Icon = BLOCK_ICONS[type];
            return (
              <Button key={type} size="sm" onClick={() => onChange([...blocks, emptyBlock(type)])}>
                <Icon className="size-3.5" />
                {t(`admin.block.${type}`)}
              </Button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
