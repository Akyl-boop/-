/**
 * Minimal, safe markdown subset for admin-authored text:
 * paragraphs, "## " / "### " headings, "- " and "1. " lists,
 * **bold**, *italic*, `code` and [links](https://…).
 * Produces a tree (no HTML strings), so nothing is ever injected as markup.
 */
export type Inline =
  | { type: "text"; value: string }
  | { type: "strong"; children: Inline[] }
  | { type: "em"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] };

export type Block =
  | { type: "paragraph"; children: Inline[] }
  | { type: "heading"; level: 2 | 3; children: Inline[] }
  | { type: "list"; ordered: boolean; items: Inline[][] };

const SAFE_URL = /^(https?:\/\/|mailto:|tg:\/\/|\/(?!\/))/i;

export function isSafeUrl(url: string): boolean {
  return SAFE_URL.test(url.trim());
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const pattern = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)\s]+)\))|(\*([^*]+)\*)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: "text", value: text.slice(last, index) });
    if (match[2] !== undefined) out.push({ type: "strong", children: parseInline(match[2]) });
    else if (match[4] !== undefined) out.push({ type: "code", value: match[4] });
    else if (match[6] !== undefined && match[7] !== undefined) {
      if (isSafeUrl(match[7])) out.push({ type: "link", href: match[7], children: parseInline(match[6]) });
      else out.push({ type: "text", value: match[6] });
    } else if (match[9] !== undefined) out.push({ type: "em", children: parseInline(match[9]) });
    last = index + match[0].length;
  }
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

interface ListState {
  ordered: boolean;
  items: Inline[][];
}

export function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const state: { paragraph: string[]; list: ListState | null } = { paragraph: [], list: null };

  const flushParagraph = () => {
    if (state.paragraph.length) blocks.push({ type: "paragraph", children: parseInline(state.paragraph.join(" ")) });
    state.paragraph = [];
  };
  const flushList = () => {
    if (state.list) blocks.push({ type: "list", ordered: state.list.ordered, items: state.list.items });
    state.list = null;
  };

  for (const raw of source.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    const item = /^(?:([-*•])|\d+[.)])\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", level: heading[1] === "##" ? 2 : 3, children: parseInline(heading[2] ?? "") });
    } else if (item) {
      flushParagraph();
      const ordered = item[1] === undefined;
      if (!state.list || state.list.ordered !== ordered) {
        flushList();
        state.list = { ordered, items: [] };
      }
      state.list.items.push(parseInline(item[2] ?? ""));
    } else {
      flushList();
      state.paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}
