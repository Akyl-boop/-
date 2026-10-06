"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, EyeOff, Megaphone, MessageSquareQuote, Plus, Star, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Avatar, Card, EmptyState, Segmented, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Paged, UserBrief } from "@/lib/types";
import { date, number, timeAgo, tr, type I18n } from "@/lib/utils";

interface BroadcastRow { id: number; name: string; status: string; total_count: number; sent_count: number; failed_count: number; scheduled_at?: string; started_at?: string; finished_at?: string; created_at: string; audience: { type?: string } }
interface ReviewRow { id: number; rating: number; text?: string | null; status: string; admin_reply?: string | null; order_id?: number; created_at: string; customer?: UserBrief; product?: { id: number; name: I18n; emoji?: string } }

export default function MarketingPage() {
  const [f, setF] = useUrlState({ tab: "broadcasts", new: "" });
  const router = useRouter();
  const { can } = useSession();
  React.useEffect(() => { if (f.new) router.replace("/marketing/new"); }, [f.new, router]);
  return (
    <div>
      <PageHeader title="Marketing" description="Broadcast campaigns to your customers and moderate product reviews."
        actions={f.tab === "broadcasts" && can("broadcasts.send") ? <Link href="/marketing/new"><Button variant="primary"><Plus />New broadcast</Button></Link> : null} />
      <Tabs value={f.tab} onValueChange={(v) => setF({ tab: v })}>
        <TabsList className="mb-4">
          {can("broadcasts.send") ? <TabsTrigger value="broadcasts"><Megaphone />Broadcasts</TabsTrigger> : null}
          {can("reviews.manage") ? <TabsTrigger value="reviews"><MessageSquareQuote />Reviews</TabsTrigger> : null}
        </TabsList>
        <TabsContent value="broadcasts"><Broadcasts /></TabsContent>
        <TabsContent value="reviews"><Reviews /></TabsContent>
      </Tabs>
    </div>
  );
}

function Broadcasts() {
  const router = useRouter();
  const [page, setPage] = React.useState(1);
  const list = useQuery({ queryKey: ["broadcasts", page], queryFn: () => api.get<Paged<BroadcastRow>>("/broadcasts", { page, page_size: 20 }), refetchInterval: 10_000 });
  return (
    <DataTable rows={list.data?.items} loading={list.isLoading} getId={(b) => b.id} onRowClick={(b) => router.push(`/marketing/${b.id}`)}
      page={page} pages={list.data?.pages} total={list.data?.total} onPage={setPage}
      empty={<EmptyState icon={<Megaphone />} title="No campaigns yet" description="Send announcements, promotions and restock news to selected customers." action={<Link href="/marketing/new"><Button variant="primary"><Plus />New broadcast</Button></Link>} />}
      columns={[
        { key: "n", header: "Campaign", cell: (b) => <div><div className="font-medium">{b.name}</div><div className="text-[12px] capitalize text-fg-3">Audience: {(b.audience?.type ?? "all").replace("_", " ")}</div></div> },
        { key: "s", header: "Status", cell: (b) => <StatusBadge status={b.status} /> },
        { key: "p", header: "Delivery", cell: (b) => b.total_count ? (
          <div className="w-40">
            <div className="mb-1 flex justify-between text-[11.5px] text-fg-3"><span>{number(b.sent_count)} sent</span><span>{b.failed_count ? `${b.failed_count} failed` : ""}</span></div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-success" style={{ width: `${(b.sent_count / b.total_count) * 100}%` }} />
              <div className="h-full bg-danger" style={{ width: `${(b.failed_count / b.total_count) * 100}%` }} />
            </div>
          </div>
        ) : <span className="text-fg-3">—</span> },
        { key: "t", header: "Recipients", align: "right", hide: "md", cell: (b) => number(b.total_count) },
        { key: "d", header: "When", hide: "md", cell: (b) => <span className="text-fg-3">{b.status === "scheduled" && b.scheduled_at ? `Scheduled ${date(b.scheduled_at)}` : b.started_at ? date(b.started_at) : `Created ${timeAgo(b.created_at)}`}</span> },
      ]} />
  );
}

function Reviews() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [status, setStatus] = React.useState("pending");
  const [page, setPage] = React.useState(1);
  const list = useQuery({ queryKey: ["reviews", status, page], queryFn: () => api.get<Paged<ReviewRow>>("/reviews", { status: status === "all" ? undefined : status, page, page_size: 20 }) });
  const inv = () => qc.invalidateQueries({ queryKey: ["reviews"] });
  const mod = useMutation({ mutationFn: ({ id, ...b }: { id: number; status?: string; admin_reply?: string }) => api.patch(`/reviews/${id}`, b), onSuccess: () => { toast.success("Review updated"); inv(); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/reviews/${id}`), onSuccess: inv });
  return (
    <div>
      <Segmented className="mb-3" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "pending", label: "Pending" }, { value: "approved", label: "Approved" }, { value: "hidden", label: "Hidden" }, { value: "all", label: "All" }]} />
      {list.data && !list.data.items.length ? <Card><EmptyState icon={<Star />} title="No reviews here" description="Customers can rate products after a completed order." /></Card> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {(list.data?.items ?? []).map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <Avatar name={r.customer?.display_name} size={30} />
                <div><div className="text-[13px] font-medium">{r.customer?.display_name}</div><div className="text-[12px] text-fg-3">{r.product?.emoji} {tr(r.product?.name)} · {timeAgo(r.created_at)}</div></div>
              </div>
              <StatusBadge status={r.status} />
            </div>
            <div className="mt-3 flex gap-0.5">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`size-4 ${i <= r.rating ? "fill-warning text-warning" : "text-fg-3/40"}`} />)}</div>
            {r.text ? <p className="mt-2 text-[13px] text-fg-2">{r.text}</p> : <p className="mt-2 text-[13px] italic text-fg-3">No comment</p>}
            <ReplyBox review={r} onSave={(reply) => mod.mutate({ id: r.id, admin_reply: reply })} />
            <div className="mt-3 flex gap-1.5">
              {r.status !== "approved" ? <Button size="sm" variant="primary" onClick={() => mod.mutate({ id: r.id, status: "approved" })}><Check />Approve</Button> : null}
              {r.status !== "hidden" ? <Button size="sm" onClick={() => mod.mutate({ id: r.id, status: "hidden" })}><EyeOff />Hide</Button> : null}
              <Button size="icon-sm" variant="danger-ghost" className="ml-auto" aria-label="Delete" onClick={async () => { if ((await confirm({ title: "Delete review?", danger: true, confirmLabel: "Delete" })).ok) del.mutate(r.id); }}><Trash2 /></Button>
            </div>
          </Card>
        ))}
      </div>
      {list.data && list.data.pages > 1 ? <div className="mt-3 flex justify-center gap-2"><Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" disabled={page >= list.data.pages} onClick={() => setPage(page + 1)}>Next</Button></div> : null}
    </div>
  );
}

function ReplyBox({ review, onSave }: { review: ReviewRow; onSave: (s: string) => void }) {
  const [v, setV] = React.useState(review.admin_reply ?? "");
  return (
    <div className="mt-3 flex gap-1.5">
      <Input placeholder="Public reply (optional)" value={v} onChange={(e) => setV(e.target.value)} />
      {v !== (review.admin_reply ?? "") ? <Button size="md" onClick={() => onSave(v)}>Save</Button> : null}
    </div>
  );
}
