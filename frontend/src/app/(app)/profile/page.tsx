"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Laptop, LogOut, Send, ShieldCheck, ShieldOff, Smartphone } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Avatar, Badge, Card, CardBody, CardHeader, CopyButton, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { date, timeAgo } from "@/lib/utils";

interface Sess { id: string; ip?: string; device?: string; user_agent?: string; created_at: string; last_seen_at: string; expires_at: string; current: boolean }

export default function ProfilePage() {
  const { admin, refresh } = useSession();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [name, setName] = React.useState(admin?.name ?? "");
  const [pw, setPw] = React.useState({ current_password: "", new_password: "", repeat: "" });
  const [totp, setTotp] = React.useState<{ secret: string; qr: string; otpauth_uri: string } | null>(null);
  const [code, setCode] = React.useState("");
  const [recovery, setRecovery] = React.useState<string[] | null>(null);
  const [disableOpen, setDisableOpen] = React.useState(false);
  const [disable, setDisable] = React.useState({ password: "", code: "" });
  const [link, setLink] = React.useState<{ code: string; command: string; bot_username?: string; deep_link?: string } | null>(null);
  const sessions = useQuery({ queryKey: ["auth", "sessions"], queryFn: () => api.get<Sess[]>("/auth/sessions") });

  const patch = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch("/auth/me", b), onSuccess: () => { toast.success("Saved"); refresh(); } });
  const changePw = useMutation({ mutationFn: () => api.post("/auth/password", { current_password: pw.current_password, new_password: pw.new_password }), onSuccess: () => { toast.success("Password changed — other sessions were signed out"); setPw({ current_password: "", new_password: "", repeat: "" }); qc.invalidateQueries({ queryKey: ["auth", "sessions"] }); } });
  const setup = useMutation({ mutationFn: () => api.post<{ secret: string; qr: string; otpauth_uri: string }>("/auth/2fa/setup"), onSuccess: setTotp });
  const enable = useMutation({ mutationFn: () => api.post<{ recovery_codes: string[] }>("/auth/2fa/enable", { code }), onSuccess: (r) => { setTotp(null); setCode(""); setRecovery(r.recovery_codes); refresh(); } });
  const disable2fa = useMutation({ mutationFn: () => api.post("/auth/2fa/disable", disable), onSuccess: () => { toast.success("2FA disabled"); setDisableOpen(false); refresh(); } });
  const linkTg = useMutation({ mutationFn: () => api.post<{ code: string; command: string; bot_username?: string; deep_link?: string }>("/auth/telegram/link"), onSuccess: setLink });
  const unlinkTg = useMutation({ mutationFn: () => api.del("/auth/telegram/link"), onSuccess: () => { toast.success("Telegram unlinked"); refresh(); } });
  const revoke = useMutation({ mutationFn: (id: string) => api.del(`/auth/sessions/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["auth", "sessions"] }) });
  const revokeOthers = useMutation({ mutationFn: () => api.post<{ revoked: number }>("/auth/sessions/revoke-others"), onSuccess: (r) => { toast.success(`${r.revoked} session(s) signed out`); qc.invalidateQueries({ queryKey: ["auth", "sessions"] }); } });

  React.useEffect(() => {
    if (!link) return;
    const t = setInterval(() => refresh(), 3000);
    return () => clearInterval(t);
  }, [link, refresh]);
  React.useEffect(() => { if (link && admin?.telegram_linked) { setLink(null); toast.success("Telegram linked!"); } }, [admin?.telegram_linked, link]);

  if (!admin) return null;
  return (
    <div className="max-w-4xl">
      <PageHeader title="Account & security" description="Your profile, sign-in methods and active sessions." />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Profile" />
          <CardBody className="flex flex-wrap items-end gap-4">
            <Avatar name={admin.name} size={48} />
            <Field label="Name" className="w-64"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="E-mail" className="w-64"><Input value={admin.email} disabled /></Field>
            <Badge style={{ color: admin.role.color, background: `${admin.role.color}1f` }}>{admin.role.name}</Badge>
            <Button variant="primary" disabled={name === admin.name || !name.trim()} loading={patch.isPending} onClick={() => patch.mutate({ name })}>Save</Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Password" description="At least 10 characters with letters and digits. Changing it signs out your other sessions." />
          <CardBody className="grid gap-3 sm:grid-cols-3">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} /></Field>
            <Field label="New password"><Input type="password" autoComplete="new-password" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} /></Field>
            <Field label="Repeat" error={pw.repeat && pw.repeat !== pw.new_password ? "Doesn't match" : null}><Input type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} /></Field>
            <div className="sm:col-span-3"><Button variant="primary" disabled={!pw.current_password || pw.new_password.length < 10 || pw.new_password !== pw.repeat} loading={changePw.isPending} onClick={() => changePw.mutate()}><KeyRound />Change password</Button></div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Two-factor authentication" description="Protect your account with an authenticator app (Google Authenticator, 1Password, Authy…)."
            action={admin.totp_enabled ? <Badge tone="success"><ShieldCheck className="size-3" />Enabled</Badge> : <Badge tone="warning">Not enabled</Badge>} />
          <CardBody>
            {admin.totp_enabled ? (
              <Button variant="danger-ghost" onClick={() => setDisableOpen(true)}><ShieldOff />Disable 2FA</Button>
            ) : totp ? (
              <div className="flex flex-wrap gap-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={totp.qr} alt="2FA QR code" className="size-44 rounded-[12px] bg-white p-2" />
                <div className="min-w-[240px] flex-1 space-y-3">
                  <p className="text-[13px] text-fg-2">Scan the QR code, or enter this key manually:</p>
                  <div className="flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-3 py-2 font-mono text-[13px] tracking-wider">{totp.secret}<CopyButton value={totp.secret} /></div>
                  <Field label="Enter the 6-digit code to confirm"><Input inputMode="numeric" className="w-40 text-center font-mono tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
                  <div className="flex gap-2"><Button variant="primary" disabled={code.length < 6} loading={enable.isPending} onClick={() => enable.mutate()}>Enable 2FA</Button><Button variant="ghost" onClick={() => setTotp(null)}>Cancel</Button></div>
                </div>
              </div>
            ) : <Button variant="primary" loading={setup.isPending} onClick={() => setup.mutate()}><ShieldCheck />Set up authenticator</Button>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Telegram" description="Link your Telegram account to receive admin notifications and approve sign-ins with one tap."
            action={admin.telegram_linked ? <Badge tone="info"><Send className="size-3" />Linked</Badge> : null} />
          <CardBody className="space-y-4">
            {admin.telegram_linked ? (<>
              <label className="flex items-center justify-between gap-4"><div><div className="text-[13px] font-medium">Receive admin notifications</div><div className="text-[12px] text-fg-3">New orders, payments, low stock… (respecting your permissions and notification rules)</div></div>
                <Switch checked={admin.receive_telegram_notifications} onCheckedChange={(v) => patch.mutate({ receive_telegram_notifications: v })} /></label>
              <label className="flex items-center justify-between gap-4"><div><div className="text-[13px] font-medium">Approve sign-ins in Telegram</div><div className="text-[12px] text-fg-3">Additional security: every dashboard login must be approved from your Telegram.</div></div>
                <Switch checked={admin.telegram_2fa_enabled} onCheckedChange={(v) => patch.mutate({ telegram_2fa_enabled: v })} /></label>
              <Button variant="danger-ghost" onClick={async () => { if ((await confirm({ title: "Unlink Telegram?", confirmLabel: "Unlink", danger: true })).ok) unlinkTg.mutate(); }}>Unlink Telegram</Button>
            </>) : link ? (
              <div className="space-y-2 text-[13px]">
                <p>Send this command to {link.bot_username ? <a className="text-accent hover:underline" href={link.deep_link ?? "#"} target="_blank" rel="noreferrer">@{link.bot_username}</a> : "your bot"} within 10 minutes:</p>
                <div className="flex w-fit items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-3 py-2 font-mono">{link.command}<CopyButton value={link.command} /></div>
                <p className="text-fg-3">This page updates automatically once linked.</p>
              </div>
            ) : <Button onClick={() => linkTg.mutate()} loading={linkTg.isPending}><Send />Link Telegram account</Button>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Active sessions" description="Devices currently signed in to your account."
            action={(sessions.data?.length ?? 0) > 1 ? <Button size="sm" onClick={() => revokeOthers.mutate()}><LogOut />Sign out other sessions</Button> : null} />
          <div className="divide-y divide-border border-t border-border">
            {(sessions.data ?? []).map((s) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex size-9 items-center justify-center rounded-[10px] bg-surface-2 text-fg-3">{/iOS|Android/.test(s.device ?? "") ? <Smartphone className="size-4" /> : <Laptop className="size-4" />}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">{s.device}{s.current ? <Badge tone="success">This device</Badge> : null}</div>
                  <div className="text-[12px] text-fg-3">{s.ip} · signed in {date(s.created_at)} · active {timeAgo(s.last_seen_at)}</div>
                </div>
                {!s.current ? <Button size="sm" variant="ghost" onClick={() => revoke.mutate(s.id)}>Revoke</Button> : null}
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Dialog open={!!recovery} onOpenChange={(o) => !o && setRecovery(null)}>
        <DialogContent title="Save your recovery codes" description="Each code can be used once if you lose your authenticator. They won't be shown again."
          footer={<Button variant="primary" onClick={() => setRecovery(null)}>I&apos;ve saved them</Button>}>
          <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-border bg-surface-2 p-4 font-mono text-[13px]">{recovery?.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="mt-3"><CopyButton value={recovery?.join("\n") ?? ""} label="Copy all" /> <span className="text-[12px] text-fg-3">Copy all</span></div>
        </DialogContent>
      </Dialog>
      <Dialog open={disableOpen} onOpenChange={setDisableOpen}>
        <DialogContent size="sm" title="Disable two-factor authentication" footer={<><Button variant="ghost" onClick={() => setDisableOpen(false)}>Cancel</Button><Button variant="danger" loading={disable2fa.isPending} onClick={() => disable2fa.mutate()}>Disable</Button></>}>
          <div className="space-y-3">
            <Field label="Password"><Input type="password" value={disable.password} onChange={(e) => setDisable({ ...disable, password: e.target.value })} /></Field>
            <Field label="Authenticator or recovery code"><Input value={disable.code} onChange={(e) => setDisable({ ...disable, code: e.target.value })} /></Field>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
