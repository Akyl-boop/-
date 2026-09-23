import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/i18n/config";

export type InstructionBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "steps"; items: { title: string; text: string; image?: string }[] }
  | { type: "image"; url: string; caption?: string }
  | { type: "callout"; tone: "warning" | "note" | "tip"; title?: string; text: string }
  | { type: "code"; language: string; code: string }
  | { type: "link"; label: string; url: string }
  | { type: "faq"; items: { question: string; answer: string }[] };
export type InstructionBlockType = InstructionBlock["type"];
export type InstructionContent = Partial<Record<Locale, InstructionBlock[]>>;

export const BLOCK_TYPES: InstructionBlockType[] = ["heading", "paragraph", "steps", "callout", "code", "image", "link", "faq"];

export function pickBlocks(content: InstructionContent, locale: Locale): InstructionBlock[] {
  if (content[locale]?.length) return content[locale];
  if (content[DEFAULT_LOCALE]?.length) return content[DEFAULT_LOCALE];
  for (const candidate of LOCALES) if (content[candidate]?.length) return content[candidate];
  return [];
}

export function emptyBlock(type: InstructionBlockType): InstructionBlock {
  switch (type) {
    case "heading":
    case "paragraph":
      return { type, text: "" };
    case "steps":
      return { type, items: [{ title: "", text: "" }] };
    case "image":
      return { type, url: "", caption: "" };
    case "callout":
      return { type, tone: "note", title: "", text: "" };
    case "code":
      return { type, language: "", code: "" };
    case "link":
      return { type, label: "", url: "" };
    case "faq":
      return { type, items: [{ question: "", answer: "" }] };
  }
}
