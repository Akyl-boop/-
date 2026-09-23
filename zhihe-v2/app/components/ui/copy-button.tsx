import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { useT } from "~/i18n/react";
import { cn } from "~/lib/format";

export function CopyButton({ value, className, label }: { value: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <button
      type="button"
      className={cn("btn btn-secondary btn-sm shrink-0", className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          const area = document.createElement("textarea");
          area.value = value;
          document.body.appendChild(area);
          area.select();
          document.execCommand("copy");
          area.remove();
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }}
      aria-label={label ?? t("common.copy")}
    >
      {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      <span>{copied ? t("common.copied") : (label ?? t("common.copy"))}</span>
    </button>
  );
}
