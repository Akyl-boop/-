import type { ReactNode } from "react";
import { LogoMark } from "~/components/store/logo";

export function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden px-4 py-12">
      <div className="pointer-events-none absolute top-[-240px] left-1/2 h-[480px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(124,108,255,0.18),transparent)]" aria-hidden="true" />
      <div className="bg-grid pointer-events-none absolute inset-0 [mask-image:radial-gradient(60%_50%_at_50%_30%,black,transparent)]" aria-hidden="true" />
      <div className="relative w-full max-w-[400px] animate-rise">
        <div className="mb-8 flex justify-center">
          <LogoMark className="size-10" />
        </div>
        <div className="surface p-6 sm:p-8" style={{ boxShadow: "var(--shadow-pop)" }}>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="mt-1.5 text-sm text-fg-muted">{description}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}
