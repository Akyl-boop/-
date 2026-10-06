"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Cpu, Database, DatabaseBackup, Download, HardDrive, RefreshCw, Server, Webhook, Wrench } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardBody, CardHeader, EmptyState, KeyValue, Skeleton } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import { bytes, cn, date } from "@/lib/utils";

interface Health {
  version: string; environment: string; uptime_seconds: number; maintenance: boolean;
  database: { ok: boolean; latency_ms: number; error?: string }; redis: { ok: boolean; latency_ms: number; error?: string };
  worker: { ok: boolean; last_heartbeat_seconds?: number; queue_length: number };
  bot: { configured: boolean; mode: string; telegram_ok?: boolean; latency_ms?: number; username?: string; error?: string; webhook?: { url_set: boolean; pending_updates: number; last_error?: string; last_error_date?: string } };
  payments: { code: string; provider: string; ok?: boolean | null; checked_at?: string; error?: string }[];
}

function uptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

function StatusTile({ icon, title, ok, detail, sub }: { icon: React.ReactNode; title: string; ok: boolean | null | undefined; detail: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13px] font-medium text-fg-2 [&_svg]:size-4 [&_svg]:text-fg-3">{icon}{title}</div>
        <span className={cn("flex items-center gap-1.5 text-[12px] font-medium", ok ? "text-success" : ok === false ? "text-danger" : "text-fg-3")}>
          <span className={cn("size-2 rounded-full", ok ? "bg-success shadow-[0_0_8px_var(--success)]" : ok === false ? "bg-danger" : "bg-fg-3")} />{ok ? "Operational" : ok === false ? "Problem" : "Unknown"}
        </span>
      </div>
      <div className="mt-2 text-[18px] font-semibold tracking-[-0.02em]">{detail}</div>
      {sub ? <div className="mt-1 text-[12px] text-fg-3">{sub}</div> : null}
    </Card>
  );
}

export default function SystemPage() {
  const qc = useQueryClient();
  const { can } = useSession();
  const h = useQuery({ queryKey: ["system", "health"], queryFn: () => api.get<Health>("/system/health"), refetchInterval: 15_000 });
  const backups = useQuery({ queryKey: ["system", "backups"], queryFn: () => api.get<{ name: string; size: number; created_at: number }[]>("/system/backups") });
  const backup = useMutation({ mutationFn: () => api.post("/system/backups"), onSuccess: () => { toast.success("Backup started — it appears below in a few seconds"); setTimeout(() => qc.invalidateQueries({ queryKey: ["system", "backups"] }), 4000); } });
  const d = h.data;
  return (
    <div>
      <PageHeader title="System" description="Live health of every component of your platform." actions={<Button onClick={() => h.refetch()} loading={h.isFetching}><RefreshCw />Refresh</Button>} />
      {!d ? <div className="grid gap-3 md:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((i) => <Skeleton key={i} className="h-28" />)}</div> : (<>
        {d.maintenance ? <div className="mb-3 flex items-center gap-2 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3 text-[13px] text-warning"><Wrench className="size-4" />Maintenance mode is enabled. <Link href="/settings?tab=maintenance" className="underline">Manage</Link></div> : null}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <StatusTile icon={<Bot />} title="Telegram bot" ok={d.bot.configured ? d.bot.telegram_ok : false} detail={d.bot.username ? `@${d.bot.username}` : d.bot.configured ? "Unreachable" : "Not configured"} sub={d.bot.configured ? `${d.bot.mode} mode${d.bot.latency_ms ? ` · Telegram API ${d.bot.latency_ms} ms` : ""}${d.bot.error ? ` · ${d.bot.error}` : ""}` : "Set BOT_TOKEN in the environment"} />
          <StatusTile icon={<Webhook />} title="Telegram webhook" ok={d.bot.mode !== "webhook" ? null : d.bot.webhook?.url_set && !d.bot.webhook?.last_error} detail={d.bot.mode === "webhook" ? (d.bot.webhook?.url_set ? "Registered" : "Not set") : "Polling mode"} sub={d.bot.webhook ? `${d.bot.webhook.pending_updates} pending update(s)${d.bot.webhook.last_error ? ` · ${d.bot.webhook.last_error}` : ""}` : undefined} />
          <StatusTile icon={<Database />} title="PostgreSQL" ok={d.database.ok} detail={`${d.database.latency_ms} ms`} sub={d.database.error ?? "Query latency"} />
          <StatusTile icon={<HardDrive />} title="Redis" ok={d.redis.ok} detail={`${d.redis.latency_ms} ms`} sub={d.redis.error ?? "Cache, queues, sessions, locks"} />
          <StatusTile icon={<Cpu />} title="Background worker" ok={d.worker.ok} detail={d.worker.last_heartbeat_seconds !== undefined && d.worker.last_heartbeat_seconds !== null ? `${d.worker.last_heartbeat_seconds}s ago` : "No heartbeat"} sub={`${d.worker.queue_length} job(s) queued · payments polling, expiry, broadcasts`} />
          <StatusTile icon={<Server />} title="Application" ok detail={`v${d.version}`} sub={`${d.environment} · uptime ${uptime(d.uptime_seconds)}`} />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Payment providers" description="Enabled methods, checked every 10 minutes" action={<Link href="/payments?tab=methods"><Button size="sm" variant="ghost">Manage</Button></Link>} />
            <CardBody className="divide-y divide-border">
              {!d.payments.length ? <p className="py-4 text-[13px] text-fg-3">No payment methods enabled.</p> : d.payments.map((p) => (
                <KeyValue key={p.code} label={<span className="font-mono">{p.code}</span>}>
                  {p.ok ? <Badge tone="success">Healthy</Badge> : p.ok === false ? <Badge tone="danger">{p.error ?? "Error"}</Badge> : <Badge>Not checked yet</Badge>}
                  {p.checked_at ? <span className="ml-2 text-[12px] text-fg-3">{date(p.checked_at)}</span> : null}
                </KeyValue>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Database backups" description="pg_dump custom format — restore with `python -m app.cli restore`"
              action={can("settings.edit") ? <Button size="sm" variant="primary" loading={backup.isPending} onClick={() => backup.mutate()}><DatabaseBackup />Back up now</Button> : null} />
            <CardBody>
              {!backups.data?.length ? <EmptyState icon={<DatabaseBackup />} title="No backups yet" description="Enable scheduled backups in Settings → Backups." className="py-8" /> : (
                <div className="divide-y divide-border">
                  {backups.data.map((b) => (
                    <div key={b.name} className="flex items-center gap-3 py-2 text-[13px]">
                      <span className="flex-1 truncate font-mono text-[12px]">{b.name}</span><span className="text-fg-3">{bytes(b.size)}</span><span className="hidden text-fg-3 sm:block">{date(b.created_at)}</span>
                      {can("settings.edit") ? <Button size="icon-sm" variant="ghost" aria-label="Download" onClick={() => download(`/system/backups/${b.name}`)}><Download /></Button> : null}
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
        </div>
      </>)}
    </div>
  );
}
