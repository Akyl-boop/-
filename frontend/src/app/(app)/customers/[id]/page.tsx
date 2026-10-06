"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CircleDollarSign, Gift, MessageSquare, Send, ShieldCheck, Tag as TagIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  Avatar, Badge, Card, CardBody, CardHeader, Checkbox, CopyButton, EmptyState, KeyValue, Popover, PopoverContent, PopoverTrigger, Skeleton,
  Switch, Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Customer, OrderBrief, Paged, Payment, Tag, UserBrief } from "@/lib/types";
import { date, money, number, timeAgo, toNum, type Num } from "@/lib/utils";

interface Detail extends Customer {
  stats: { orders: number; successful: number; cancelled: number; refunds: number; refunded_amount: Num };
  notes: { id: number; body: string; admin?: string; created_at: string }[];
  timeline: { id: number; type: string; message: string; admin?: string; created_at: string }[];
  referrer?: UserBrief | null;
  referrals: { invited: number; converted: number; earned: Num };
}

const TL_TONE: Record<string, string> = { registered: "bg-info", payment_received: "bg-success", delivered: "bg-success", refund: "bg-danger", banned: "bg-danger", note: "bg-accent", ticket_created: "bg-warning" };

export default function CustomerPage() {
  const { id } = useParams<{ id: string }>();
  const uid = Number(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const router = useRouter();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["customer", uid], queryFn: () => api.get<Detail>(`/customers/${uid}`) });
  const orders = useQuery({ queryKey: ["customer", uid, "orders"], queryFn: () => api.get<Paged<OrderBrief>>(`/customers/${uid}/orders`, { page_size: 50 }) });
  const payments = useQuery({ queryKey: ["customer", uid, "payments"], enabled: can("payments.view"), queryFn: () => api.get<Paged<Payment>>(`/customers/${uid}/payments`, { page_size: 50 }) });
  const balance = useQuery({ queryKey: ["customer", uid, "balance"], queryFn: () => api.get<Paged<{ id: number; amount: Num; balance_after: Num; type: string; note?: string; created_at: string }>>(`/customers/${uid}/balance`, { page_size: 50 }) });
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["customer", uid] }); qc.invalidateQueries({ queryKey: ["customers"] }); };
  const [note, setNote] = React.useState("");
  const [msgOpen, setMsgOpen] = React.useState(false);
  const [balOpen, setBalOpen] = React.useState(false);

  const ban = useMutation({ mutationFn: (b: { banned: boolean; reason?: string }) => api.post(`/customers/${uid}/ban`, b), onSuccess: () => { refresh(); toast.success("Updated"); } });
  const addNote = useMutation({ mutationFn: () => api.post(`/customers/${uid}/notes`, { body: note }), onSuccess: () => { setNote(""); refresh(); } });
  const delNote = useMutation({ mutationFn: (nid: number) => api.del(`/customers/${uid}/notes/${nid}`), onSuccess: refresh });
  const setTags = useMutation({ mutationFn: (ids: number[]) => api.put(`/customers/${uid}/tags`, { tag_ids: ids }), onSuccess: refresh });

  const c = q.data;
  if (!c) return <div className="space-y-4"><Skeleton className="h-16 w-80" /><Skeleton className="h-96" /></div>;
  const tagIds = new Set(c.tags.map((t) => t.id));

  return (
    <div>
      <Link href="/customers" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5" />Customers</Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Avatar name={c.display_name} size={56} />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{c.display_name}</h1>
              {c.is_premium ? <Badge tone="accent">⭐ Premium</Badge> : null}
              {c.is_banned ? <Badge tone="danger">Banned</Badge> : null}
              {c.bot_blocked ? <Badge tone="warning">Blocked the bot</Badge> : null}
              {c.tags.map((t) => <Badge key={t.id} style={{ color: t.color, background: `${t.color}1f` }}>{t.name}</Badge>)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[13px] text-fg-3">
              {c.username ? <a href={`https://t.me/${c.username}`} target="_blank" rel="noreferrer" className="hover:text-fg">@{c.username}</a> : null}
              <span className="inline-flex items-center gap-1 font-mono">{c.telegram_id}<CopyButton value={String(c.telegram_id)} className="size-5" /></span>
              <span>Joined {date(c.created_at, false)}</span><span>Active {timeAgo(c.last_activity_at)}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("customers.edit") ? (
            <Popover>
              <PopoverTrigger asChild><Button><TagIcon />Tags</Button></PopoverTrigger>
              <PopoverContent className="w-56 p-1">
                {(tags.data ?? []).map((t) => (
                  <label key={t.id} className="flex h-8 cursor-pointer items-center gap-2 rounded-[7px] px-2 text-[13px] hover:bg-hover">
                    <Checkbox checked={tagIds.has(t.id)} onCheckedChange={(v) => setTags.mutate(v ? [...tagIds, t.id] : [...tagIds].filter((x) => x !== t.id))} />
                    <span className="size-2 rounded-full" style={{ background: t.color }} />{t.name}
                  </label>
                ))}
                <Link href="/customers/tags" className="mt-1 block border-t border-border px-2 pt-2 text-[12px] text-fg-3 hover:text-fg">Manage tags →</Link>
              </PopoverContent>
            </Popover>
          ) : null}
          {can("customers.edit") ? <Button onClick={() => setMsgOpen(true)}><MessageSquare />Message</Button> : null}
          {can("customers.balance") ? <Button onClick={() => setBalOpen(true)}><CircleDollarSign />Balance</Button> : null}
          {can("customers.ban") ? (c.is_banned ? (
            <Button onClick={() => ban.mutate({ banned: false })}><ShieldCheck />Unban</Button>
          ) : (
            <Button variant="danger-ghost" onClick={async () => {
              const r = await confirm({ title: `Ban ${c.display_name}?`, description: "The customer can no longer use the bot.", danger: true, withReason: true, confirmLabel: "Ban customer" });
              if (r.ok) ban.mutate({ banned: true, reason: r.reason });
            }}><Ban />Ban</Button>
          )) : null}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {[["Total spent", money(c.total_spent)], ["Paid orders", number(c.stats.successful)], ["Cancelled", number(c.stats.cancelled)],
          ["Refunds", `${c.stats.refunds} · ${money(c.stats.refunded_amount)}`], ["Balance", money(c.balance)]].map(([l, v]) => (
          <div key={l} className="card p-4"><div className="text-[12px] text-fg-3">{l}</div><div className="mt-1 text-[18px] font-semibold tabular">{v}</div></div>
        ))}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="mb-4"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="orders">Orders ({orders.data?.total ?? 0})</TabsTrigger>
          {can("payments.view") ? <TabsTrigger value="payments">Payments</TabsTrigger> : null}<TabsTrigger value="balance">Balance history</TabsTrigger></TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader title="Timeline" description="Everything this customer did, newest first" />
              <CardBody>
                {!c.timeline.length ? <EmptyState title="No activity yet" /> : (
                  <ol className="space-y-3">
                    {c.timeline.map((e) => (
                      <li key={e.id} className="flex gap-3">
                        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${TL_TONE[e.type] ?? "bg-fg-3"}`} />
                        <div className="min-w-0 flex-1"><p className="text-[13px]">{e.message}</p><p className="text-[12px] text-fg-3">{date(e.created_at)}{e.admin ? ` · ${e.admin}` : ""}</p></div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardBody>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader title="Internal notes" />
                <CardBody className="space-y-3">
                  {can("customers.edit") ? (
                    <div className="space-y-2">
                      <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for your team…" />
                      <div className="flex justify-end"><Button size="sm" variant="primary" disabled={!note.trim()} loading={addNote.isPending} onClick={() => addNote.mutate()}>Add note</Button></div>
                    </div>
                  ) : null}
                  {c.notes.map((n) => (
                    <div key={n.id} className="group rounded-[10px] border border-border bg-surface-2/40 p-3">
                      <p className="whitespace-pre-wrap text-[13px]">{n.body}</p>
                      <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-fg-3">
                        <span>{n.admin ?? "System"} · {timeAgo(n.created_at)}</span>
                        {can("customers.edit") ? <button type="button" aria-label="Delete note" className="opacity-0 transition-opacity hover:text-danger group-hover:opacity-100" onClick={() => delNote.mutate(n.id)}><Trash2 className="size-3.5" /></button> : null}
                      </div>
                    </div>
                  ))}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Profile" />
                <CardBody className="divide-y divide-border">
                  <KeyValue label="Language">{c.language.toUpperCase()} {c.language_code ? <span className="text-fg-3">(Telegram: {c.language_code})</span> : null}</KeyValue>
                  <KeyValue label="Referral code"><span className="font-mono">{c.referral_code}</span></KeyValue>
                  <KeyValue label="Referred by">{c.referrer ? <Link className="text-accent hover:underline" href={`/customers/${c.referrer.id}`}>{c.referrer.display_name}</Link> : "—"}</KeyValue>
                  <KeyValue label={<span className="inline-flex items-center gap-1"><Gift className="size-3.5" />Referrals</span>}>{c.referrals.invited} invited · {c.referrals.converted} bought · {money(c.referrals.earned)}</KeyValue>
                  {c.start_param ? <KeyValue label="Start source"><span className="font-mono">{c.start_param}</span></KeyValue> : null}
                  {c.ban_reason ? <KeyValue label="Ban reason">{c.ban_reason}</KeyValue> : null}
                </CardBody>
              </Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="orders">
          <DataTable rows={orders.data?.items} loading={orders.isLoading} getId={(o) => o.id} onRowClick={(o) => router.push(`/orders/${o.id}`)} columns={[
            { key: "n", header: "Order", cell: (o) => <span className="font-mono text-[12.5px]">{o.number}</span> },
            { key: "p", header: "Product", cell: (o) => o.product },
            { key: "t", header: "Amount", align: "right", cell: (o) => money(o.total, o.currency) },
            { key: "s", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
            { key: "d", header: "Created", hide: "md", cell: (o) => <span className="text-fg-3">{date(o.created_at)}</span> },
          ]} />
        </TabsContent>
        <TabsContent value="payments">
          <DataTable rows={payments.data?.items} loading={payments.isLoading} getId={(p) => p.id} onRowClick={(p) => router.push(`/orders/${p.order_id}`)} columns={[
            { key: "r", header: "Reference", cell: (p) => <span className="font-mono text-[12.5px]">{p.reference}</span> },
            { key: "m", header: "Method", cell: (p) => p.method_code },
            { key: "a", header: "Amount", align: "right", cell: (p) => money(p.amount, p.currency) },
            { key: "s", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
            { key: "d", header: "Date", hide: "md", cell: (p) => <span className="text-fg-3">{date(p.created_at)}</span> },
          ]} />
        </TabsContent>
        <TabsContent value="balance">
          <DataTable rows={balance.data?.items} loading={balance.isLoading} getId={(t) => t.id} empty={<EmptyState title="No balance transactions" />} columns={[
            { key: "t", header: "Type", cell: (t) => <Badge>{t.type}</Badge> },
            { key: "a", header: "Amount", align: "right", cell: (t) => <span className={toNum(t.amount) >= 0 ? "text-success" : "text-danger"}>{toNum(t.amount) >= 0 ? "+" : ""}{money(t.amount)}</span> },
            { key: "b", header: "Balance after", align: "right", cell: (t) => money(t.balance_after) },
            { key: "n", header: "Note", hide: "md", cell: (t) => <span className="text-fg-3">{t.note}</span> },
            { key: "d", header: "Date", cell: (t) => <span className="text-fg-3">{date(t.created_at)}</span> },
          ]} />
        </TabsContent>
      </Tabs>
      <MessageDialog open={msgOpen} onOpenChange={setMsgOpen} uid={uid} onDone={refresh} />
      <BalanceDialog open={balOpen} onOpenChange={setBalOpen} uid={uid} current={toNum(c.balance)} onDone={refresh} />
    </div>
  );
}

function MessageDialog({ open, onOpenChange, uid, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; uid: number; onDone: () => void }) {
  const [text, setText] = React.useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/customers/${uid}/message`, { text }),
    onSuccess: (r) => { if (r.status === "ok") { toast.success("Message delivered"); setText(""); onOpenChange(false); onDone(); } else toast.error("Delivery failed — the customer may have blocked the bot"); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Send a message" description="Delivered by your bot. Telegram HTML is supported."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" disabled={!text.trim()} loading={m.isPending} onClick={() => m.mutate()}><Send />Send</Button></>}>
        <Textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </DialogContent>
    </Dialog>
  );
}

function BalanceDialog({ open, onOpenChange, uid, current, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; uid: number; current: number; onDone: () => void }) {
  const [amount, setAmount] = React.useState("");
  const [note, setNote] = React.useState("");
  const [notify, setNotify] = React.useState(true);
  const confirm = useConfirm();
  const m = useMutation({
    mutationFn: () => api.post(`/customers/${uid}/balance`, { amount: Number(amount), note, notify }),
    onSuccess: () => { toast.success("Balance updated"); setAmount(""); setNote(""); onOpenChange(false); onDone(); },
  });
  const n = Number(amount);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" title="Adjust balance" description={`Current balance: ${money(current)}`}
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!n || !note.trim() || current + n < 0} loading={m.isPending}
            onClick={async () => { const r = await confirm({ title: `${n > 0 ? "Credit" : "Debit"} ${money(Math.abs(n))}?`, description: `New balance: ${money(current + n)}`, confirmLabel: "Apply" }); if (r.ok) m.mutate(); }}>Apply</Button></>}>
        <div className="space-y-3">
          <Field label="Amount" help="Positive to credit, negative to debit."><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Reason" required><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Compensation for delay" /></Field>
          <label className="flex items-center gap-2 text-[13px] text-fg-2"><Switch checked={notify} onCheckedChange={setNotify} />Notify the customer in Telegram</label>
        </div>
      </DialogContent>
    </Dialog>
  );
}
