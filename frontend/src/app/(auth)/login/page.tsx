"use client";

import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Mail, Send, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/misc";
import { api, errorMessage } from "@/lib/api";

type LoginResp = { status: "ok" } | { status: "2fa_required"; challenge: string; methods: string[] };

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [challenge, setChallenge] = React.useState<{ id: string; methods: string[] } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const done = React.useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["auth"] });
    const next = params.get("next");
    router.replace(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
  }, [qc, params, router]);

  // Poll for Telegram approval
  React.useEffect(() => {
    if (!challenge?.methods.includes("telegram")) return;
    const t = setInterval(async () => {
      try {
        const r = await api.post<{ status: string }>("/auth/login/telegram", { challenge: challenge.id });
        if (r.status === "ok") { clearInterval(t); await done(); }
      } catch (e) {
        clearInterval(t);
        setError(errorMessage(e));
        setChallenge(null);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [challenge, done]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (!challenge) {
        const r = await api.post<LoginResp>("/auth/login", { email, password });
        if (r.status === "2fa_required") setChallenge({ id: r.challenge, methods: r.methods });
        else await done();
      } else {
        await api.post("/auth/login/2fa", { challenge: challenge.id, code });
        await done();
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (challenge) {
    return (
      <form onSubmit={submit} className="space-y-5">
        <div>
          <div className="mb-3 flex size-10 items-center justify-center rounded-[11px] bg-accent/12 text-accent"><ShieldCheck className="size-5" /></div>
          <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Two-factor verification</h1>
          <p className="mt-1 text-[13px] text-fg-3">
            {challenge.methods.includes("totp") ? "Enter the 6-digit code from your authenticator app or a recovery code." : null}
            {challenge.methods.includes("telegram") ? " We also sent an approval request to your Telegram." : null}
          </p>
        </div>
        {challenge.methods.includes("telegram") ? (
          <div className="flex items-center gap-3 rounded-[10px] border border-border bg-surface-2/60 px-3 py-2.5 text-[13px] text-fg-2">
            <Send className="size-4 text-info" /> Waiting for approval in Telegram <Spinner className="ml-auto" />
          </div>
        ) : null}
        {challenge.methods.includes("totp") ? (
          <Field label="Verification code" error={error}>
            <Input autoFocus inputMode="numeric" autoComplete="one-time-code" placeholder="123 456" value={code}
              onChange={(e) => setCode(e.target.value)} className="h-10 text-center font-mono text-[16px] tracking-[0.3em]" />
          </Field>
        ) : error ? <p className="text-xs text-danger">{error}</p> : null}
        {challenge.methods.includes("totp") ? <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Verify</Button> : null}
        <button type="button" className="w-full text-center text-[12.5px] text-fg-3 hover:text-fg" onClick={() => { setChallenge(null); setCode(""); }}>
          ← Use a different account
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="mb-2">
        <h1 className="text-[18px] font-semibold tracking-[-0.02em]">Sign in to your dashboard</h1>
        <p className="mt-1 text-[13px] text-fg-3">Welcome back. Enter your credentials to continue.</p>
      </div>
      <Field label="Email">
        <Input icon={<Mail />} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" className="[&_input]:h-10" />
      </Field>
      <Field label="Password" action={<Link href="/forgot-password" className="text-[12px] text-fg-3 hover:text-accent">Forgot password?</Link>}>
        <Input icon={<KeyRound />} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••••" className="[&_input]:h-10" />
      </Field>
      {error ? <div className="rounded-[9px] border border-danger/25 bg-danger-bg px-3 py-2 text-[12.5px] text-danger">{error}</div> : null}
      <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy}>Sign in</Button>
    </form>
  );
}

export default function LoginPage() {
  return <React.Suspense><LoginForm /></React.Suspense>;
}
