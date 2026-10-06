"use client";

import { useQuery } from "@tanstack/react-query";
import { ScrollText, Search } from "lucide-react";
import * as React from "react";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, Badge, EmptyState, KeyValue } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api";
import type { Paged } from "@/lib/types";
import { date, timeAgo } from "@/lib/utils";

interface Log { id: number; admin_id?: number; admin_email?: string; action: string; entity_type?: string; entity_id?: string; summary: string; old_value?: unknown; new_value?: unknown; ip?: string; user_agent?: string; created_at: string }

const tone = (a: string) => a.includes("delete") || a.includes("ban") || a.includes("refund") || a.includes("failed") || a.includes("locked") ? "danger"
  : a.startsWith("auth.") ? "info" : a.includes("create") || a.includes("add") ? "success" : "neutral";

function Json({ v }: { v: unknown }) {
  if (v === null || v === undefined) return <span className="text-fg-3">—</span>;
  return <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-[8px] bg-surface-2 p-2.5 font-mono text-[11.5px] text-fg-2">{JSON.stringify(v, null, 2)}</pre>;
}

export default function AuditLogsPage() {
  const [f, setF] = useUrlState({ q: "", action: "", date_from: "", date_to: "", entity_type: "", entity_id: "", page: "1" });
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = React.useState<Log | null>(null);
  const list = useQuery({ queryKey: ["audit", f], placeholderData: (p) => p, queryFn: () => api.get<Paged<Log> & { actions: string[] }>("/audit-logs", { ...f, page_size: 40 }) });
  const prefixes = Array.from(new Set((list.data?.actions ?? []).map((a) => a.split(".")[0])));
  return (
    <div>
      <PageHeader title="Audit logs" description="Every administrative action — who did what, when, from where, with before/after values." />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input icon={<Search />} placeholder="Search summary, admin, IP…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-80" />
        <Select className="w-44" value={f.action} onChange={(v) => setF({ action: v })} allowEmpty="All actions" options={prefixes.map((p) => ({ value: p, label: p }))} />
        <Input type="date" className="w-40" value={f.date_from} onChange={(e) => setF({ date_from: e.target.value })} aria-label="From" />
        <Input type="date" className="w-40" value={f.date_to} onChange={(e) => setF({ date_to: e.target.value })} aria-label="To" />
      </div>
      <DataTable rows={list.data?.items} loading={list.isLoading} getId={(l) => l.id} onRowClick={setOpen} dense
        page={Number(f.page)} pages={list.data?.pages} total={list.data?.total} onPage={(p) => setF({ page: String(p) })}
        empty={<EmptyState icon={<ScrollText />} title="No log entries" />}
        columns={[
          { key: "w", header: "When", cell: (l) => <span className="whitespace-nowrap text-fg-3" title={date(l.created_at)}>{timeAgo(l.created_at)}</span> },
          { key: "a", header: "Admin", cell: (l) => <span className="flex items-center gap-2"><Avatar name={l.admin_email ?? "system"} size={20} /><span className="max-w-[160px] truncate">{l.admin_email ?? "System"}</span></span> },
          { key: "x", header: "Action", cell: (l) => <Badge tone={tone(l.action)}>{l.action}</Badge> },
          { key: "s", header: "Summary", cell: (l) => <span className="line-clamp-1">{l.summary}</span> },
          { key: "o", header: "Object", hide: "lg", cell: (l) => l.entity_type ? <span className="font-mono text-[12px] text-fg-3">{l.entity_type}#{l.entity_id}</span> : null },
          { key: "i", header: "IP", hide: "md", cell: (l) => <span className="font-mono text-[12px] text-fg-3">{l.ip}</span> },
        ]} />
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        {open ? (
          <DialogContent size="lg" title={open.summary} description={date(open.created_at)}>
            <div className="divide-y divide-border">
              <KeyValue label="Admin">{open.admin_email ?? "System"}</KeyValue>
              <KeyValue label="Action"><Badge tone={tone(open.action)}>{open.action}</Badge></KeyValue>
              <KeyValue label="Object">{open.entity_type ? `${open.entity_type} #${open.entity_id}` : "—"}</KeyValue>
              <KeyValue label="IP address"><span className="font-mono">{open.ip ?? "—"}</span></KeyValue>
              <KeyValue label="User agent"><span className="text-[12px]">{open.user_agent ?? "—"}</span></KeyValue>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div><div className="mb-1 text-[12px] font-medium text-fg-3">Old value</div><Json v={open.old_value} /></div>
              <div><div className="mb-1 text-[12px] font-medium text-fg-3">New value</div><Json v={open.new_value} /></div>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
