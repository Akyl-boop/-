"use client";

import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

function strength(p: string) {
  let s = 0;
  if (p.length >= 10) s++;
  if (p.length >= 14) s++;
  if (/[A-Z]/.test(p) && /[a-z]/.test(p)) s++;
  if (/\d/.test(p)) s++;
  if (/[^A-Za-z0-9]/.test(p)) s++;
  return Math.min(4, s);
}

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [done, setDone] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const s = strength(pw);
  if (done) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-success-bg text-success"><CircleCheck className="size-5" /></div>
        <h1 className="text-[17px] font-semibold">Password updated</h1>
        <p className="mt-1.5 text-[13px] text-fg-3">All other sessions were signed out for your security.</p>
        <Link href="/login" className="mt-5 inline-block text-[13px] text-accent hover:underline">Sign in</Link>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault();
      if (pw !== pw2) { setError("Passwords do not match"); return; }
      setBusy(true); setError(null);
      try { await api.post("/auth/reset-password", { token, password: pw }); setDone(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
    }}>
      <div>
        <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Choose a new password</h1>
        <p className="mt-1 text-[13px] text-fg-3">At least 10 characters with letters and digits.</p>
      </div>
      {!token ? <p className="rounded-[9px] bg-danger-bg px-3 py-2 text-[12.5px] text-danger">Missing reset token — open the link from your e-mail again.</p> : null}
      <Field label="New password">
        <Input type="password" required minLength={10} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} className="h-10" />
        <div className="mt-1 flex gap-1">{[0, 1, 2, 3].map((i) => (
          <span key={i} className={cn("h-1 flex-1 rounded-full bg-surface-3 transition-colors", i < s && (s <= 1 ? "bg-danger" : s === 2 ? "bg-warning" : "bg-success"))} />
        ))}</div>
      </Field>
      <Field label="Repeat password" error={error}><Input type="password" required value={pw2} onChange={(e) => setPw2(e.target.value)} className="h-10" /></Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} disabled={!token}>Update password</Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return <React.Suspense><ResetForm /></React.Suspense>;
}
