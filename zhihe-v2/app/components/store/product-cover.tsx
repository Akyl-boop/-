import { cn } from "~/lib/format";

function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  if (words.length === 0) return "•";
  if (words.length === 1) return (words[0] ?? "").slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

/** Product artwork: the uploaded image, or a generated cover derived from the product accent. */
export function ProductCover({
  name,
  imageUrl,
  accent,
  className,
  size = "card",
  priority = false,
}: {
  name: string;
  imageUrl: string | null;
  accent: string;
  className?: string;
  size?: "card" | "hero" | "thumb";
  priority?: boolean;
}) {
  if (imageUrl) {
    return (
      <div className={cn("relative overflow-hidden bg-panel-2", className)}>
        <img
          src={imageUrl}
          alt={name}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          fetchPriority={priority ? "high" : undefined}
          className="size-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
        />
      </div>
    );
  }
  const label = initials(name);
  return (
    <div
      className={cn("relative isolate overflow-hidden bg-panel-2", className)}
      style={{ ["--accent" as string]: accent }}
      role="img"
      aria-label={name}
    >
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,color-mix(in_oklab,var(--accent)_38%,transparent),transparent_60%)] transition-opacity duration-500 group-hover:opacity-100 opacity-80" />
      <div className="absolute inset-0 bg-[radial-gradient(80%_70%_at_0%_100%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_70%)]" />
      <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(90%_80%_at_70%_20%,black,transparent)] opacity-60" />
      <div className={cn("absolute", size === "thumb" ? "inset-0 grid place-items-center" : "bottom-5 left-5")}>
        <div
          className={cn(
            "grid place-items-center rounded-2xl border border-white/15 bg-white/[0.06] font-semibold tracking-tight text-white backdrop-blur-md transition-transform duration-500 group-hover:-translate-y-0.5",
            size === "hero" ? "size-20 text-2xl" : size === "thumb" ? "size-9 rounded-lg text-xs" : "size-14 text-lg",
          )}
          style={{ boxShadow: "0 1px 0 0 rgb(255 255 255 / 0.18) inset, 0 12px 32px -12px color-mix(in oklab, var(--accent) 70%, transparent)" }}
        >
          {label}
        </div>
      </div>
      {size !== "thumb" ? (
        <div className="absolute top-0 right-0 size-40 translate-x-10 -translate-y-10 rounded-full border border-white/[0.07]" aria-hidden="true">
          <div className="absolute inset-6 rounded-full border border-white/[0.06]" />
          <div className="absolute inset-12 rounded-full border border-white/[0.05]" />
        </div>
      ) : null}
    </div>
  );
}
