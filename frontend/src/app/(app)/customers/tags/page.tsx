"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Input } from "@/components/ui/input";
import { Badge, Card, EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { api } from "@/lib/api";
import type { Tag } from "@/lib/types";

const COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"];

export default function TagsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
  const [name, setName] = React.useState("");
  const [color, setColor] = React.useState(COLORS[0]);
  const inv = () => qc.invalidateQueries({ queryKey: ["tags"] });
  const create = useMutation({ mutationFn: () => api.post("/tags", { name, color }), onSuccess: () => { setName(""); inv(); toast.success("Tag created"); } });
  const update = useMutation({ mutationFn: (t: Tag) => api.put(`/tags/${t.id}`, { name: t.name, color: t.color, description: t.description }), onSuccess: inv });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/tags/${id}`), onSuccess: inv });
  return (
    <div className="max-w-3xl">
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5" />Customers</Link>
      <PageHeader title="Customer tags" description="Segment customers (VIP, wholesale, problem customer…). Tags power filters and broadcast audiences." />
      <Card className="mb-4 flex flex-wrap items-center gap-2 p-3">
        <Input className="w-56" placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-1">{COLORS.map((c) => (
          <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className="size-6 rounded-full ring-offset-2 ring-offset-[var(--surface)]" style={{ background: c, boxShadow: color === c ? `0 0 0 2px ${c}` : undefined }} />
        ))}</div>
        <Button variant="primary" className="ml-auto" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}><Plus />Add tag</Button>
      </Card>
      <Card className="divide-y divide-border">
        {!q.data?.length ? <EmptyState icon={<TagIcon />} title="No tags yet" /> : q.data.map((t) => (
          <div key={t.id} className="flex items-center gap-3 px-4 py-3">
            <input type="color" value={t.color} onChange={(e) => update.mutate({ ...t, color: e.target.value })} className="size-6 cursor-pointer rounded border-0 bg-transparent" aria-label="Tag color" />
            <Input className="w-56" defaultValue={t.name} onBlur={(e) => e.target.value !== t.name && update.mutate({ ...t, name: e.target.value })} />
            <Badge style={{ color: t.color, background: `${t.color}1f` }}>{t.name}</Badge>
            <Link href={`/customers?tag_id=${t.id}`} className="ml-auto text-[12.5px] text-fg-3 hover:text-fg">{t.customers ?? 0} customers</Link>
            <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: `Delete tag “${t.name}”?`, danger: true, confirmLabel: "Delete" })).ok) del.mutate(t.id); }}><Trash2 /></Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
