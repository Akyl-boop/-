import { Plus } from "lucide-react";
import type { ResolvedFaq } from "~/lib/domain";
import { RichText } from "~/components/store/rich-text";

export function FaqList({ items }: { items: ResolvedFaq[] }) {
  return (
    <div className="surface divide-y divide-line overflow-hidden">
      {items.map((item) => (
        <details key={item.question} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left text-[15px] font-medium text-fg transition-colors hover:bg-white/[0.02] sm:px-6 [&::-webkit-details-marker]:hidden">
            {item.question}
            <Plus className="size-4 shrink-0 text-fg-subtle transition-transform duration-300 group-open:rotate-45" />
          </summary>
          <div className="px-5 pb-5 sm:px-6">
            <RichText text={item.answer} className="text-sm leading-6" />
          </div>
        </details>
      ))}
    </div>
  );
}
