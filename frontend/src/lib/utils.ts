import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type Num = number | string | null | undefined;

export function toNum(v: Num): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

let currencyCfg = { code: "USD", symbol: "$" as string | null | undefined };
export function setCurrency(code: string, symbol?: string | null) {
  currencyCfg = { code, symbol };
}

export function money(v: Num, currency?: string, opts: { compact?: boolean } = {}): string {
  const n = toNum(v);
  const code = currency || currencyCfg.code || "USD";
  try {
    const s = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code === "XTR" ? "USD" : code,
      notation: opts.compact && Math.abs(n) >= 10000 ? "compact" : "standard",
      maximumFractionDigits: opts.compact ? 1 : 2,
      minimumFractionDigits: opts.compact ? 0 : n % 1 === 0 ? 0 : 2,
    }).format(n);
    if (code === "XTR") return s.replace("$", "⭐");
    if (code === currencyCfg.code && currencyCfg.symbol && !s.includes(currencyCfg.symbol)) {
      return s.replace(/^[^\d-]+/, currencyCfg.symbol);
    }
    return s;
  } catch {
    return `${n.toFixed(2)} ${code}`;
  }
}

export function number(v: Num, digits = 0): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(toNum(v));
}

export function compact(v: Num): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(toNum(v));
}

export function pct(v: Num, digits = 1): string {
  return `${toNum(v).toFixed(digits)}%`;
}

export function date(v?: string | number | Date | null, withTime = true): string {
  if (!v) return "—";
  const d = typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)) : new Date(v);
  return d.toLocaleString("en-GB", withTime
    ? { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "short", year: "numeric" });
}

export function timeAgo(v?: string | number | Date | null): string {
  if (!v) return "—";
  const s = Math.round((Date.now() - new Date(v).getTime()) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

export function bytes(n: Num): string {
  const v = toNum(n);
  if (v < 1024) return `${v} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(1)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(1)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}

export type I18n = Record<string, string>;
export function tr(v: I18n | string | null | undefined, lang = "en"): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return v[lang] || v.en || Object.values(v).find(Boolean) || "";
}

export function initials(name?: string | null): string {
  if (!name) return "?";
  const parts = name.replace(/^@/, "").trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
