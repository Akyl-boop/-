import { z } from "zod";
import { LOCALES } from "~/i18n/config";
import type { InstructionBlock, InstructionContent } from "./instructions";

const text = z.string().max(20_000).catch("");
const url = z.string().max(2_000).catch("");

export const instructionBlockSchema: z.ZodType<InstructionBlock> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("heading"), text }),
  z.object({ type: z.literal("paragraph"), text }),
  z.object({ type: z.literal("steps"), items: z.array(z.object({ title: text, text, image: url.optional() })).max(50).catch([]) }),
  z.object({ type: z.literal("image"), url, caption: text.optional() }),
  z.object({ type: z.literal("callout"), tone: z.enum(["warning", "note", "tip"]).catch("note"), title: text.optional(), text }),
  z.object({ type: z.literal("code"), language: z.string().max(30).catch(""), code: text }),
  z.object({ type: z.literal("link"), label: text, url }),
  z.object({ type: z.literal("faq"), items: z.array(z.object({ question: text, answer: text })).max(50).catch([]) }),
]);

export function parseInstructionContent(raw: string | null | undefined): InstructionContent {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object") return {};
  const out: InstructionContent = {};
  for (const locale of LOCALES) {
    const list = (data as Record<string, unknown>)[locale];
    if (!Array.isArray(list)) continue;
    out[locale] = list.map((block) => instructionBlockSchema.safeParse(block)).filter((result) => result.success).map((result) => result.data);
  }
  return out;
}

