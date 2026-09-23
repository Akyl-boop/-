import { Fragment, type ReactNode } from "react";
import { cn } from "~/lib/format";
import { parseBlocks, parseInline, type Inline } from "~/lib/markdown";

export function renderInline(nodes: Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return <Fragment key={index}>{node.value}</Fragment>;
      case "strong":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "em":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "code":
        return <code key={index}>{node.value}</code>;
      case "link": {
        const external = /^https?:/i.test(node.href);
        return (
          <a key={index} href={node.href} {...(external ? { target: "_blank", rel: "noopener noreferrer nofollow" } : {})}>
            {renderInline(node.children)}
          </a>
        );
      }
    }
  });
}

export function InlineText({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

export function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = parseBlocks(text);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("rich-text", className)}>
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          const Tag = block.level === 2 ? "h2" : "h3";
          return <Tag key={index}>{renderInline(block.children)}</Tag>;
        }
        if (block.type === "list") {
          const Tag = block.ordered ? "ol" : "ul";
          return (
            <Tag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
        }
        return <p key={index}>{renderInline(block.children)}</p>;
      })}
    </div>
  );
}
