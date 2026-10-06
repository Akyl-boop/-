"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, LifeBuoy, Paperclip, Search, Send, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Avatar, Badge, EmptyState, KeyValue, Segmented, Skeleton, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useAdminEvent } from "@/hooks/use-events";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Customer, OrderBrief, Paged, UserBrief } from "@/lib/types";
import { cn, date, money, timeAgo, titleCase } from "@/lib/utils";

interface TicketRow { id: number; number: string; subject: string; status: string; priority: string; order_id?: number; assigned_admin_id?: number; last_message_at?: string; unread: boolean; created_at: string; customer: UserBrief; last_message?: { body: string; sender: string } }
interface TicketDetail extends TicketRow {
  customer_full: Customer; order?: OrderBrief | null; recent_orders: OrderBrief[]; assigned_admin?: string | null; admins: { id: number; name: string }[];
  messages: { id: number; sender: string; admin?: string | null; body: string; attachments: { type: string; name?: string; index: number }[]; delivered: boolean; created_at: string }[];
}

const PRIORITY_TONE: Record<string, "neutral" | "info" | "warning" | "danger"> = { low: "neutral", normal: "info", high: "warning", urgent: "danger" };

export function SupportInbox({ selectedId }: { selectedId?: number }) {
  const router = useRouter();
  const [status, setStatus] = React.useState("active");
  const [q, setQ] = React.useState("");
  const dq = useDebounce(q);
  const statusParam = status === "active" ? "open,waiting_admin,waiting_customer" : status === "mine" ? undefined : status === "all" ? undefined : status;
  const list = useQuery({
    queryKey: ["tickets", status, dq], placeholderData: (p) => p, refetchInterval: 30_000,
    queryFn: () => api.get<Paged<TicketRow> & { counts: Record<string, number>; unread: number }>("/support/tickets", { status: statusParam, assigned: status === "mine" ? "me" : undefined, q: dq, page_size: 50 }),
  });
  return (
    <div>
      <PageHeader title="Support" description="Customer requests from Telegram. Your replies are delivered to the customer's chat instantly." />
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <div className={cn("min-w-0", selectedId && "hidden lg:block")}>
          <div className="mb-2 space-y-2">
            <Input icon={<Search />} placeholder="Ticket #, subject, @username" value={q} onChange={(e) => setQ(e.target.value)} />
            <Segmented value={status} onChange={setStatus} className="w-full overflow-x-auto" options={[
              { value: "active", label: `Active${list.data?.unread ? ` · ${list.data.unread}` : ""}` }, { value: "mine", label: "Mine" },
              { value: "resolved", label: "Resolved" }, { value: "closed", label: "Closed" }, { value: "all", label: "All" }]} />
          </div>
          <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
            {list.isLoading ? <div className="space-y-2 p-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14" />)}</div> : !list.data?.items.length ? (
              <EmptyState icon={<LifeBuoy />} title="Inbox zero" description="No tickets in this view." className="py-10" />
            ) : list.data.items.map((t) => (
              <button key={t.id} type="button" onClick={() => router.push(`/support/${t.id}`)}
                className={cn("flex w-full gap-3 border-b border-border px-3 py-3 text-left transition-colors last:border-0 hover:bg-hover", selectedId === t.id && "bg-active")}>
                <Avatar name={t.customer.display_name} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={cn("truncate text-[13px]", t.unread ? "font-semibold" : "font-medium")}>{t.customer.display_name}</span>
                    <span className="shrink-0 text-[11px] text-fg-3">{timeAgo(t.last_message_at ?? t.created_at)}</span>
                  </div>
                  <div className="truncate text-[12.5px] text-fg-2">{t.number} · {t.subject}</div>
                  <div className="mt-0.5 truncate text-[12px] text-fg-3">{t.last_message?.sender === "admin" ? "You: " : ""}{t.last_message?.body}</div>
                  <div className="mt-1.5 flex gap-1"><StatusBadge status={t.status} />{t.priority !== "normal" ? <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge> : null}</div>
                </div>
                {t.unread ? <span className="mt-1 size-2 shrink-0 rounded-full bg-accent" /> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="min-w-0">
          {selectedId ? <Conversation id={selectedId} /> : (
            <div className="card hidden h-full min-h-[420px] items-center justify-center lg:flex"><EmptyState icon={<LifeBuoy />} title="Select a conversation" description="Pick a ticket to read the thread and reply." /></div>
          )}
        </div>
      </div>
    </div>
  );
}

function Conversation({ id }: { id: number }) {
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["ticket", id], queryFn: () => api.get<TicketDetail>(`/support/tickets/${id}`) });
  const [text, setText] = React.useState("");
  const [close, setClose] = React.useState(false);
  const bottom = React.useRef<HTMLDivElement>(null);
  useAdminEvent(React.useCallback((e) => { if (e.type.startsWith("ticket.") && Number(e.data.id) === id) qc.invalidateQueries({ queryKey: ["ticket", id] }); }, [id, qc]));
  React.useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [q.data?.messages.length]);
  React.useEffect(() => { if (q.data) qc.invalidateQueries({ queryKey: ["tickets"] }); }, [q.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const reply = useMutation({
    mutationFn: () => api.post(`/support/tickets/${id}/reply`, { body: text, close }),
    onSuccess: () => { setText(""); setClose(false); qc.invalidateQueries({ queryKey: ["ticket", id] }); qc.invalidateQueries({ queryKey: ["tickets"] }); toast.success("Reply sent to Telegram"); },
  });
  const update = useMutation({ mutationFn: (b: Record<string, unknown>) => api.patch(`/support/tickets/${id}`, b), onSuccess: () => { qc.invalidateQueries({ queryKey: ["ticket", id] }); qc.invalidateQueries({ queryKey: ["tickets"] }); } });
  const t = q.data;
  if (!t) return <Skeleton className="h-[560px]" />;
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
      <div className="card flex h-[calc(100dvh-210px)] min-h-[480px] flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Link href="/support" className="rounded p-1 text-fg-3 hover:bg-hover lg:hidden" aria-label="Back"><ArrowLeft className="size-4" /></Link>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14px] font-semibold">{t.subject}</div>
            <div className="text-[12px] text-fg-3">{t.number} · opened {date(t.created_at)}</div>
          </div>
          <StatusBadge status={t.status} />
          {t.status !== "closed" && can("support.reply") ? <Button size="sm" onClick={() => update.mutate({ status: "resolved" })}><CheckCircle2 />Resolve</Button> : null}
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-bg/40 px-4 py-4">
          {t.messages.map((m) => m.sender === "system" ? (
            <div key={m.id} className="text-center text-[11.5px] text-fg-3">— {m.body} · {timeAgo(m.created_at)} —</div>
          ) : (
            <div key={m.id} className={cn("flex", m.sender === "admin" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[78%] rounded-[14px] px-3.5 py-2.5 text-[13.5px]", m.sender === "admin" ? "rounded-br-[5px] bg-accent text-accent-fg" : "rounded-bl-[5px] border border-border bg-surface-2")}>
                {m.body ? <p className="whitespace-pre-wrap break-words">{m.body}</p> : null}
                {m.attachments.map((a) => (
                  <a key={a.index} href={`/api/support/tickets/${t.id}/attachments/${m.id}/${a.index}`} target="_blank" rel="noreferrer" className="mt-1 flex items-center gap-1.5 text-[12.5px] underline-offset-2 hover:underline">
                    <Paperclip className="size-3.5" />{a.name ?? a.type}
                  </a>
                ))}
                <div className={cn("mt-1 text-[10.5px]", m.sender === "admin" ? "text-accent-fg/70" : "text-fg-3")}>
                  {m.admin ? `${m.admin} · ` : ""}{date(m.created_at)}{m.sender === "admin" && !m.delivered ? " · not delivered" : ""}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        {can("support.reply") ? (
          <div className="border-t border-border p-3">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply… (Ctrl+Enter to send)"
              onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && text.trim()) reply.mutate(); }} />
            <div className="mt-2 flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[12.5px] text-fg-2"><Switch checked={close} onCheckedChange={setClose} />Mark as resolved</label>
              <Button variant="primary" disabled={!text.trim()} loading={reply.isPending} onClick={() => reply.mutate()}><Send />Send reply</Button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="space-y-3">
        <div className="card p-4">
          <Link href={`/customers/${t.customer.id}`} className="flex items-center gap-3 hover:opacity-90">
            <Avatar name={t.customer.display_name} size={36} />
            <div className="min-w-0"><div className="truncate font-medium">{t.customer.display_name}</div><div className="truncate text-[12px] text-fg-3">{t.customer.username ? `@${t.customer.username}` : t.customer.telegram_id}</div></div>
          </Link>
          <div className="mt-3 divide-y divide-border">
            <KeyValue label="Spent">{money(t.customer_full.total_spent)}</KeyValue>
            <KeyValue label="Orders">{t.customer_full.paid_orders_count}</KeyValue>
            <KeyValue label="Language">{t.customer_full.language.toUpperCase()}</KeyValue>
          </div>
        </div>
        {can("support.reply") ? (
          <div className="card space-y-3 p-4">
            <div><div className="mb-1 text-[12px] text-fg-3">Priority</div>
              <Select value={t.priority} onChange={(v) => update.mutate({ priority: v })} options={["low", "normal", "high", "urgent"].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} /></div>
            <div><div className="mb-1 text-[12px] text-fg-3">Assigned to</div>
              <Select value={t.assigned_admin_id ? String(t.assigned_admin_id) : ""} allowEmpty="Unassigned" onChange={(v) => update.mutate(v ? { assigned_admin_id: Number(v) } : { unassign: true })} options={t.admins.map((a) => ({ value: String(a.id), label: a.name }))} /></div>
            <div><div className="mb-1 text-[12px] text-fg-3">Status</div>
              <Select value={t.status} onChange={(v) => update.mutate({ status: v })} options={["open", "waiting_customer", "waiting_admin", "resolved", "closed"].map((s) => ({ value: s, label: titleCase(s) }))} /></div>
          </div>
        ) : null}
        {t.order ? (
          <Link href={`/orders/${t.order.id}`} className="card block p-4 hover:border-border-strong">
            <div className="mb-1 flex items-center gap-1.5 text-[12px] text-fg-3"><ShoppingBag className="size-3.5" />Related order</div>
            <div className="font-mono text-[13px] font-medium">{t.order.number}</div>
            <div className="mt-1 flex items-center justify-between"><StatusBadge status={t.order.status} /><span className="text-[13px]">{money(t.order.total, t.order.currency)}</span></div>
          </Link>
        ) : null}
        {t.recent_orders.length ? (
          <div className="card p-4">
            <div className="mb-2 text-[12px] text-fg-3">Recent orders</div>
            {t.recent_orders.map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between py-1.5 text-[12.5px] hover:text-accent"><span className="font-mono">{o.number}</span><StatusBadge status={o.status} /></Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
