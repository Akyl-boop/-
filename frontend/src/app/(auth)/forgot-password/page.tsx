"use client";

import { MailCheck } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { api, errorMessage } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (sent) {
    return (
      <div className="text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-success-bg text-success"><MailCheck className="size-5" /></div>
        <h1 className="text-[17px] font-semibold">Check your inbox</h1>
        <p className="mt-1.5 text-[13px] text-fg-3">If an account exists for <b className="text-fg-2">{email}</b>, we sent a link to reset your password. It expires in 1 hour.</p>
        <Link href="/login" className="mt-5 inline-block text-[13px] text-accent hover:underline">Back to sign in</Link>
      </div>
    );
  }
  return (
    <form className="space-y-4" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setError(null);
      try { await api.post("/auth/forgot-password", { email }); setSent(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
    }}>
      <div>
        <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Reset your password</h1>
        <p className="mt-1 text-[13px] text-fg-3">Enter the e-mail of your admin account. We&apos;ll send a secure reset link (by e-mail, or Telegram if linked).</p>
      </div>
      <Field label="Email" error={error}><Input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" /></Field>
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Send reset link</Button>
      <Link href="/login" className="block text-center text-[12.5px] text-fg-3 hover:text-fg">Back to sign in</Link>
    </form>
  );
}
