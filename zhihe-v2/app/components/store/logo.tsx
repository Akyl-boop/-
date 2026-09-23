import { cn } from "~/lib/format";

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden="true">
      <defs>
        <linearGradient id="zh-mark" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8f82ff" />
          <stop offset="1" stopColor="#4b3be0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#zh-mark)" />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke="white" strokeOpacity="0.18" />
      <path d="M10.5 10.5h11l-11 11h11" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ name, logoUrl, className }: { name: string; logoUrl?: string | null; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      {logoUrl ? <img src={logoUrl} alt="" className="size-7 rounded-lg object-cover" width={28} height={28} /> : <LogoMark />}
      <span className="text-[15px] font-semibold tracking-[-0.01em] text-fg">{name}</span>
    </span>
  );
}
