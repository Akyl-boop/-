import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="text-[64px] font-semibold tracking-[-0.04em] text-fg-3">404</div>
      <h1 className="text-[18px] font-semibold">This page doesn&apos;t exist</h1>
      <Link href="/" className="text-[13px] text-accent hover:underline">Back to dashboard</Link>
    </div>
  );
}
