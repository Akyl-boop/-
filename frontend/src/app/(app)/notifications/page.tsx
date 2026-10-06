"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck, Mail, Monitor, Save, Send, Webhook } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { severityIcon, type NotificationRow } from "@/components/app/notification-bell";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Card, CardBody, CardHeader, Checkbox, EmptyState, Segmented, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useSaveSettings, useSettings } from "@/features/settings";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Paged } from "@/lib/types";
import { cn, date } from "@/lib/utils";

type Rule = { enabled: boolean; dashboard: boolean; telegram: boolean; email: boolean; webhook: boolean };

export default function NotificationsPage() {
  const { can } = useSession();
  return (
    <div>
      <PageHeader title="Notifications" description="Your notification center and how the team gets alerted." />
      <Tabs defaultValue="inbox">
        <TabsList className="mb-4"><TabsTrigger value="inbox"><Bell />Inbox</TabsTrigger>{can("notifications.manage") ? <TabsTrigger value="rules"><Send />Channels & rules</TabsTrigger> : null}</TabsList>
        <TabsContent value="inbox"><Inbox /></TabsContent>
        <TabsContent value="rules"><Rules /></TabsContent>
      </Tabs>
    </div>
  );
}

function Inbox() {
  const qc = useQueryClient();
  const [filter, setFilter] = React.useState<"all" | "unread">("all");
  const [type, setType] = React.useState("");
  const [page, setPage] = React.useState(1);
  const s = useSettings();
  const types = s.data?._meta.notification_types ?? {};
  const q = useQuery({ queryKey: ["notifications", "page", filter, type, page], queryFn: () => api.get<Paged<NotificationRow> & { unread: number }>("/notifications", { unread: filter === "unread" || undefined, type, page, page_size: 30 }) });
  const mark = useMutation({ mutationFn: (ids: number[] | null) => api.post("/notifications/read", { ids }), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented value={filter} onChange={(v) => { setFilter(v); setPage(1); }} options={[{ value: "all", label: "All" }, { value: "unread", label: `Unread${q.data?.unread ? ` (${q.data.unread})` : ""}` }]} />
        <Select className="w-52" value={type} onChange={(v) => { setType(v); setPage(1); }} allowEmpty="All types" options={Object.entries(types).map(([k, v]) => ({ value: k, label: v }))} />
        <Button className="ml-auto" onClick={() => mark.mutate(null)} disabled={!q.data?.unread}><CheckCheck />Mark all as read</Button>
      </div>
      <Card className="divide-y divide-border">
        {q.isLoading ? <div className="space-y-3 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div> : !q.data?.items.length ? (
          <EmptyState icon={<Bell />} title="No notifications" description="New orders, payments, low stock and support messages appear here in real time." />
        ) : q.data.items.map((n) => (
          <div key={n.id} className={cn("flex gap-3 px-4 py-3", !n.read && "bg-accent/[0.04]")}>
            <div className="mt-0.5">{severityIcon[n.severity]}</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("text-[13.5px]", !n.read && "font-medium")}>{n.title}</span>
                <span className="text-[11.5px] text-fg-3">{types[n.type] ?? n.type}</span>
              </div>
              {n.body ? <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-fg-3">{n.body}</p> : null}
              <div className="mt-1 flex items-center gap-3 text-[12px] text-fg-3">
                <span>{date(n.created_at)}</span>
                {n.link ? <Link href={n.link} onClick={() => !n.read && mark.mutate([n.id])} className="text-accent hover:underline">Open</Link> : null}
                {!n.read ? <button type="button" className="hover:text-fg" onClick={() => mark.mutate([n.id])}>Mark as read</button> : null}
              </div>
            </div>
          </div>
        ))}
      </Card>
      {q.data && q.data.pages > 1 ? <div className="mt-3 flex justify-center gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= q.data.pages} onClick={() => setPage(page + 1)}>Next</Button></div> : null}
    </div>
  );
}

function Rules() {
  const s = useSettings();
  const cfg = s.data?.notifications as { rules: Record<string, Rule>; telegram_chat_ids: (string | number)[]; email_recipients: string[]; webhook_url: string } | undefined;
  const types = s.data?._meta.notification_types ?? {};
  const [rules, setRules] = React.useState<Record<string, Rule>>({});
  const [chats, setChats] = React.useState("");
  const [emails, setEmails] = React.useState("");
  const [webhook, setWebhook] = React.useState("");
  React.useEffect(() => {
    if (!cfg) return;
    setRules(cfg.rules); setChats(cfg.telegram_chat_ids.join("\n")); setEmails(cfg.email_recipients.join("\n")); setWebhook(cfg.webhook_url ?? "");
  }, [cfg]);
  const save = useSaveSettings("notifications");
  const channels: { key: keyof Rule; label: string; icon: React.ReactNode }[] = [
    { key: "dashboard", label: "Dashboard", icon: <Monitor className="size-3.5" /> }, { key: "telegram", label: "Telegram", icon: <Send className="size-3.5" /> },
    { key: "email", label: "E-mail", icon: <Mail className="size-3.5" /> }, { key: "webhook", label: "Webhook", icon: <Webhook className="size-3.5" /> },
  ];
  if (!cfg) return <Skeleton className="h-96" />;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <Card className="overflow-hidden">
        <CardHeader title="Notification rules" description="Turn each event on or off and choose where it's delivered." />
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-border bg-surface-2/40 text-[11.5px] uppercase tracking-wide text-fg-3">
              <th className="px-4 py-2 text-left font-medium">Event</th><th className="px-3 py-2 font-medium">On</th>
              {channels.map((c) => <th key={c.key} className="px-3 py-2 font-medium"><span className="inline-flex items-center gap-1">{c.icon}{c.label}</span></th>)}
            </tr></thead>
            <tbody>
              {Object.entries(types).map(([k, label]) => {
                const r = rules[k] ?? { enabled: true, dashboard: true, telegram: false, email: false, webhook: false };
                return (
                  <tr key={k} className="border-b border-border last:border-0">
                    <td className="px-4 py-2.5">{label}</td>
                    <td className="px-3 text-center"><Switch checked={r.enabled} onCheckedChange={(v) => setRules({ ...rules, [k]: { ...r, enabled: v } })} /></td>
                    {channels.map((c) => <td key={c.key} className="px-3 text-center"><span className="inline-flex"><Checkbox checked={!!r[c.key]} onCheckedChange={(v) => setRules({ ...rules, [k]: { ...r, [c.key]: v } })} /></span></td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title="Channels" />
          <CardBody className="space-y-4">
            <Field label="Telegram" help="Admins with a linked Telegram account (Profile → Security) receive alerts for events they have permission to see. Add group/channel chat IDs below to also post there (add the bot to the group first).">
              <Textarea rows={3} className="font-mono" value={chats} onChange={(e) => setChats(e.target.value)} placeholder="-1001234567890" />
            </Field>
            <Field label="E-mail recipients" help="Requires SMTP settings in the server environment."><Textarea rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="ops@example.com" /></Field>
            <Field label="Webhook URL" help="POST JSON, signed with X-Nexa-Signature (HMAC-SHA256 of the body with SECRET_KEY)."><Input value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://hooks.example.com/…" /></Field>
          </CardBody>
        </Card>
        <Button variant="primary" className="w-full" loading={save.isPending} onClick={() => save.mutate({
          rules, webhook_url: webhook.trim(),
          telegram_chat_ids: chats.split(/\s+/).filter(Boolean).map((x) => (/^-?\d+$/.test(x) ? Number(x) : x)),
          email_recipients: emails.split(/[\s,]+/).filter((x) => x.includes("@")),
        })}><Save />Save notification settings</Button>
      </div>
    </div>
  );
}
