import { ArrowUpRight, CircleAlert, Info, Lightbulb, Plus } from "lucide-react";
import { CopyButton } from "~/components/ui/copy-button";
import { cn } from "~/lib/format";
import type { InstructionBlock } from "~/lib/instructions";
import { isSafeUrl } from "~/lib/markdown";
import { InlineText, RichText } from "./rich-text";

const CALLOUTS = {
  warning: { icon: CircleAlert, className: "border-warning/25 bg-warning-soft", iconClass: "text-warning" },
  note: { icon: Info, className: "border-info/25 bg-info-soft", iconClass: "text-info" },
  tip: { icon: Lightbulb, className: "border-success/25 bg-success-soft", iconClass: "text-success" },
} as const;

function safeImage(url: string): string | null {
  return isSafeUrl(url) ? url : null;
}

export function InstructionView({ blocks, className }: { blocks: InstructionBlock[]; className?: string }) {
  let stepOffset = 0;
  return (
    <div className={cn("space-y-6", className)}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case "heading":
            return (
              <h2 key={index} className="pt-2 text-lg font-semibold tracking-tight text-fg">
                {block.text}
              </h2>
            );
          case "paragraph":
            return <RichText key={index} text={block.text} />;
          case "steps": {
            const start = stepOffset;
            stepOffset += block.items.length;
            return (
              <ol key={index} className="relative space-y-0">
                {block.items.map((step, stepIndex) => {
                  const image = step.image ? safeImage(step.image) : null;
                  const last = stepIndex === block.items.length - 1;
                  return (
                    <li key={stepIndex} className="relative flex gap-4 pb-7 last:pb-0">
                      {!last ? <span className="absolute top-9 bottom-1 left-[15px] w-px bg-line-strong" aria-hidden="true" /> : null}
                      <span className="relative z-[1] grid size-8 shrink-0 place-items-center rounded-full border border-accent/40 bg-accent-soft font-mono text-[13px] font-semibold text-accent-strong">
                        {start + stepIndex + 1}
                      </span>
                      <div className="min-w-0 flex-1 pt-1">
                        {step.title ? <h3 className="text-[15px] font-semibold text-fg">{step.title}</h3> : null}
                        {step.text ? <RichText text={step.text} className={cn("text-sm leading-6", step.title && "mt-1.5")} /> : null}
                        {image ? <img src={image} alt={step.title} loading="lazy" className="mt-4 w-full rounded-xl border border-line" /> : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            );
          }
          case "image": {
            const src = safeImage(block.url);
            if (!src) return null;
            return (
              <figure key={index}>
                <img src={src} alt={block.caption ?? ""} loading="lazy" className="w-full rounded-xl border border-line" />
                {block.caption ? <figcaption className="mt-2 text-center text-xs text-fg-subtle">{block.caption}</figcaption> : null}
              </figure>
            );
          }
          case "callout": {
            const style = CALLOUTS[block.tone];
            return (
              <div key={index} className={cn("flex gap-3 rounded-xl border px-4 py-3.5", style.className)}>
                <style.icon className={cn("mt-0.5 size-[18px] shrink-0", style.iconClass)} />
                <div className="min-w-0 text-sm leading-6">
                  {block.title ? <p className="font-semibold text-fg">{block.title}</p> : null}
                  <RichText text={block.text} className="text-sm leading-6 text-fg-muted" />
                </div>
              </div>
            );
          }
          case "code":
            return (
              <div key={index} className="overflow-hidden rounded-xl border border-line bg-canvas">
                <div className="flex items-center justify-between border-b border-line px-4 py-2">
                  <span className="font-mono text-[11px] tracking-wide text-fg-subtle uppercase">{block.language || "text"}</span>
                  <CopyButton value={block.code} className="h-7 px-2 text-xs" />
                </div>
                <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-fg">
                  <code>{block.code}</code>
                </pre>
              </div>
            );
          case "link":
            if (!isSafeUrl(block.url)) return null;
            return (
              <a
                key={index}
                href={block.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-3.5 transition-colors hover:border-line-strong"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-fg">{block.label || block.url}</span>
                  <span className="block truncate text-xs text-fg-subtle">{block.url}</span>
                </span>
                <ArrowUpRight className="size-4 shrink-0 text-fg-subtle transition-colors group-hover:text-fg" />
              </a>
            );
          case "faq":
            return (
              <div key={index} className="divide-y divide-line overflow-hidden rounded-xl border border-line">
                {block.items.map((item, faqIndex) => (
                  <details key={faqIndex} className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-sm font-medium text-fg [&::-webkit-details-marker]:hidden">
                      <InlineText text={item.question} />
                      <Plus className="size-4 shrink-0 text-fg-subtle transition-transform duration-300 group-open:rotate-45" />
                    </summary>
                    <div className="px-4 pb-4">
                      <RichText text={item.answer} className="text-sm leading-6" />
                    </div>
                  </details>
                ))}
              </div>
            );
        }
      })}
    </div>
  );
}
