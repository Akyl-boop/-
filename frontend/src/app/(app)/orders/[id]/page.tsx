"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, BadgeCheck, Ban, Box, CheckCircle2, Circle, CreditCard, ExternalLink, Eye, EyeOff, MessageSquare, MoreHorizontal,
  PackageCheck, RefreshCw, RotateCcw, Send, Truck, Undo2, Wallet,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Avatar, Badge, Card, CardBody, CardHeader, CopyButton, KeyValue, Segmented, Skeleton } from "@/components/ui/misc";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Order, OrderItem, Payment } from "@/lib/types";
import { cn, date, money, timeAgo, toNum } from "@/lib/utils";

const EVENT_ICON: Record<string, React.ReactNode> = {
  created: <Box />, payment_created: <CreditCard />, payment_detected: <Eye />, payment_confirmed: <BadgeCheck />,
  payment_reported: <Send />, delivered: <Truck />, completed: <PackageCheck />, cancelled: <Ban />, expired: <Ban />,
  refunded: <Undo2 />, note: <MessageSquare />, message: <MessageSquare />, delivery_failed: <Ban />, resent: <RotateCcw />,
  duplicate_payment: <CreditCard />, payment_failed: <Ban />,
};

function explorer(p: Payment) {
  if (!p.tx_hash) return null;
  const n = (p.network ?? "").toUpperCase();
  if (n === "TRC20") return `https://tronscan.org/#/transaction/${p.tx_hash}`;
  if (n === "BEP20") return `https://bscscan.com/tx/${p.tx_hash}`;
  if (n === "LTC") return `https://blockchair.com/litecoin/transaction/${p.tx_hash}`;
  if (n === "TON") return `https://tonviewer.com/transaction/${p.tx_hash}`;
  return null;
}

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();
  const oid = Number(id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["order", oid], queryFn: () => api.get<Order>(`/orders/${oid}`) });
  const o = q.data;
  const [refundOpen, setRefundOpen] = React.useState(false);
  const [deliverItem, setDeliverItem] = React.useState<OrderItem | null>(null);
  const [messageOpen, setMessageOpen] = React.useState(false);
  const [notes, setNotes] = React.useState<string | null>(null);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["order", oid] }); qc.invalidateQueries({ queryKey: ["orders"] }); };

  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post(`/orders/${oid}/${path}`, body),
    onSuccess: (_d, v) => { refresh(); toast.success({ "mark-paid": "Order marked as paid", cancel: "Order cancelled", resend: "Delivery re-sent", fulfill: "Fulfillment re-run", "check-payment": "Payment status refreshed" }[v.path] ?? "Done"); },
  });
  const saveNotes = useMutation({
    mutationFn: (note: string) => api.patch(`/orders/${oid}/notes`, { note }),
    onSuccess: () => { refresh(); setNotes(null); toast.success("Note saved"); },
  });

  if (q.isLoading || !o) {
    return <div className="space-y-4"><Skeleton className="h-8 w-60" /><div className="grid gap-4 lg:grid-cols-3"><Skeleton className="h-96 lg:col-span-2" /><Skeleton className="h-96" /></div></div>;
  }

  const open = ["pending", "awaiting_payment", "awaiting_confirmation"].includes(o.status);
  const paid = ["paid", "processing", "completed", "partially_refunded"].includes(o.status);
  const refundable = toNum(o.refundable);

  const markPaid = async () => {
    const r = await confirm({ title: `Mark ${o.number} as paid?`, description: "Only do this after verifying that the money was received. The product will be delivered automatically.", confirmLabel: "Mark as paid", withReason: true, reasonLabel: "Verification note (e.g. bank reference)", typeToConfirm: o.number });
    if (r.ok) action.mutate({ path: "mark-paid", body: { reason: r.reason } });
  };
  const cancel = async () => {
    const r = await confirm({ title: `Cancel ${o.number}?`, description: "Reserved stock is released and any balance used is returned to the customer. The customer is notified.", danger: true, confirmLabel: "Cancel order", withReason: true });
    if (r.ok) action.mutate({ path: "cancel", body: { reason: r.reason } });
  };

  return (
    <div>
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5" />Orders</Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-mono text-[22px] font-semibold tracking-[-0.02em]">{o.number}</h1>
            <CopyButton value={o.number} />
            <StatusBadge status={o.status} />
            <StatusBadge status={o.delivery_status} label={`Delivery: ${o.delivery_status}`} />
          </div>
          <p className="mt-1 text-[13px] text-fg-3">Created {date(o.created_at)} · {o.source === "bot" ? "Telegram bot" : o.source} · language {o.language.toUpperCase()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {open && can("orders.mark_paid") ? <Button variant="primary" onClick={markPaid}><CheckCircle2 />Mark as paid</Button> : null}
          {open ? <Button onClick={() => action.mutate({ path: "check-payment" })} loading={action.isPending && action.variables?.path === "check-payment"}><RefreshCw />Check payment</Button> : null}
          {paid && can("orders.refund") && refundable > 0 ? <Button onClick={() => setRefundOpen(true)}><Undo2 />Refund</Button> : null}
          <Dropdown>
            <DropdownTrigger asChild><Button size="icon" aria-label="More actions"><MoreHorizontal /></Button></DropdownTrigger>
            <DropdownContent>
              {paid ? <DropdownItem icon={<RotateCcw />} onSelect={() => action.mutate({ path: "resend" })}>Resend product</DropdownItem> : null}
              {o.status === "paid" || o.status === "processing" ? <DropdownItem icon={<Truck />} onSelect={() => action.mutate({ path: "fulfill" })}>Retry automatic delivery</DropdownItem> : null}
              <DropdownItem icon={<MessageSquare />} onSelect={() => setMessageOpen(true)}>Message customer</DropdownItem>
              <DropdownItem icon={<Wallet />} onSelect={() => window.location.assign(`/customers/${o.customer.id}`)}>Open customer</DropdownItem>
              {open && can("orders.manage") ? (<><DropdownSeparator /><DropdownItem danger icon={<Ban />} onSelect={cancel}>Cancel order</DropdownItem></>) : null}
            </DropdownContent>
          </Dropdown>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Items" description={`${o.items.length} line${o.items.length === 1 ? "" : "s"} · ${o.quantity} unit(s)`} />
            <div className="divide-y divide-border border-t border-border">
              {o.items.map((it) => <ItemRow key={it.id} item={it} order={o} onDeliver={() => setDeliverItem(it)} />)}
            </div>
          </Card>

          <Card>
            <CardHeader title="Payments" description="Every payment attempt for this order" />
            <div className="divide-y divide-border border-t border-border">
              {!o.payments.length ? <p className="px-5 py-6 text-[13px] text-fg-3">No payment started yet.</p> : o.payments.map((p) => (
                <div key={p.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 items-center justify-center rounded-[9px] bg-surface-2"><CreditCard className="size-4 text-fg-3" /></div>
                      <div>
                        <div className="text-[13px] font-medium">{p.method_code} <span className="font-normal text-fg-3">· {p.provider}</span></div>
                        <div className="flex items-center gap-1 font-mono text-[11.5px] text-fg-3">{p.reference}<CopyButton value={p.reference} className="size-5" /></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2"><StatusBadge status={p.status} /><span className="font-semibold tabular">{money(p.amount, p.currency)}</span></div>
                  </div>
                  <div className="mt-3 grid gap-x-6 text-[12.5px] sm:grid-cols-2">
                    {p.pay_amount ? <KeyValue label="Requested">{p.pay_amount} {p.pay_currency}{p.network ? ` · ${p.network}` : ""}</KeyValue> : null}
                    {p.received_amount ? <KeyValue label="Received">{p.received_amount} {p.pay_currency}</KeyValue> : null}
                    {p.address ? <KeyValue label="Address"><span className="inline-flex items-center gap-1 font-mono text-[11.5px]">{p.address.slice(0, 10)}…{p.address.slice(-8)}<CopyButton value={p.address} className="size-5" /></span></KeyValue> : null}
                    {p.memo ? <KeyValue label="Memo"><span className="font-mono">{p.memo}</span></KeyValue> : null}
                    {p.tx_hash ? (
                      <KeyValue label="Transaction">
                        <span className="inline-flex items-center gap-1 font-mono text-[11.5px]">{p.tx_hash.slice(0, 12)}…{p.tx_hash.slice(-6)}<CopyButton value={p.tx_hash} className="size-5" />
                          {explorer(p) ? <a href={explorer(p)!} target="_blank" rel="noreferrer" className="text-fg-3 hover:text-fg"><ExternalLink className="size-3.5" /></a> : null}
                        </span>
                      </KeyValue>
                    ) : null}
                    {p.status === "awaiting_confirmation" && p.confirmations_required ? <KeyValue label="Confirmations">{p.confirmations}/{p.confirmations_required}</KeyValue> : null}
                    {p.external_id ? <KeyValue label="Provider ID"><span className="font-mono text-[11.5px]">{p.external_id}</span></KeyValue> : null}
                    {p.paid_at ? <KeyValue label="Paid at">{date(p.paid_at)}</KeyValue> : p.expires_at ? <KeyValue label="Expires">{date(p.expires_at)}</KeyValue> : null}
                    {p.error ? <KeyValue label="Error"><span className="text-danger">{p.error}</span></KeyValue> : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHeader title="Activity" description="Exact timeline of everything that happened" />
            <CardBody>
              <ol className="relative ml-1">
                {o.timeline.map((e, i) => (
                  <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {i < o.timeline.length - 1 ? <span className="absolute left-[13px] top-7 h-[calc(100%-20px)] w-px bg-border" /> : null}
                    <span className={cn("relative z-10 flex size-[27px] shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-fg-3 [&_svg]:size-3.5",
                      ["payment_confirmed", "completed", "delivered"].includes(e.type) && "border-success/30 bg-success-bg text-success",
                      ["cancelled", "expired", "delivery_failed", "payment_failed", "refunded"].includes(e.type) && "border-danger/30 bg-danger-bg text-danger")}>
                      {EVENT_ICON[e.type] ?? <Circle />}
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-[13px] text-fg">{e.message}</p>
                      <p className="mt-0.5 text-[12px] text-fg-3">{date(e.created_at)} · {e.admin ? e.admin : e.actor}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <Link href={`/customers/${o.customer.id}`} className="-mx-2 flex items-center gap-3 rounded-[10px] p-2 hover:bg-hover">
                <Avatar name={o.customer.display_name} size={36} />
                <div className="min-w-0">
                  <div className="truncate text-[13.5px] font-medium">{o.customer.display_name}</div>
                  <div className="truncate text-[12px] text-fg-3">{o.customer.username ? `@${o.customer.username} · ` : ""}{o.customer.telegram_id}</div>
                </div>
              </Link>
              <div className="mt-2 divide-y divide-border">
                <KeyValue label="Paid orders">{o.customer_full.paid_orders_count}</KeyValue>
                <KeyValue label="Total spent">{money(o.customer_full.total_spent)}</KeyValue>
                <KeyValue label="Balance">{money(o.customer_full.balance)}</KeyValue>
                {o.customer_full.is_banned ? <KeyValue label="Status"><Badge tone="danger">Banned</Badge></KeyValue> : null}
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Summary" />
            <CardBody className="divide-y divide-border">
              <KeyValue label="Subtotal">{money(o.subtotal, o.currency)}</KeyValue>
              {toNum(o.discount_total) ? <KeyValue label={`Discount${o.promo_code ? ` (${o.promo_code})` : ""}`}><span className="text-success">−{money(o.discount_total, o.currency)}</span></KeyValue> : null}
              {toNum(o.balance_used) ? <KeyValue label="Paid from balance">−{money(o.balance_used, o.currency)}</KeyValue> : null}
              <KeyValue label={<span className="font-medium text-fg">Total</span>}><span className="text-[15px] font-semibold">{money(o.total, o.currency)}</span></KeyValue>
              {toNum(o.refunded_amount) ? <KeyValue label="Refunded"><span className="text-danger">−{money(o.refunded_amount, o.currency)}</span></KeyValue> : null}
              {can("revenue.view") && o.cost_total !== null && o.cost_total !== undefined ? <KeyValue label="Cost / profit">{money(o.cost_total)} / <span className="text-success">{money(toNum(o.total) + toNum(o.balance_used) - toNum(o.cost_total))}</span></KeyValue> : null}
              <KeyValue label="Payment">{o.payment_method ?? "—"}</KeyValue>
              {o.paid_at ? <KeyValue label="Paid">{date(o.paid_at)}</KeyValue> : null}
              {o.expires_at && open ? <KeyValue label="Payment window">{timeAgo(o.expires_at).replace(" ago", "") } {new Date(o.expires_at) > new Date() ? "left" : "ago"}</KeyValue> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Internal notes" description="Visible to administrators only"
              action={notes === null ? <Button size="sm" variant="ghost" onClick={() => setNotes(o.admin_notes ?? "")}>Edit</Button> : null} />
            <CardBody>
              {notes !== null ? (
                <div className="space-y-2">
                  <Textarea autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context for your team…" />
                  <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={() => setNotes(null)}>Cancel</Button><Button size="sm" variant="primary" loading={saveNotes.isPending} onClick={() => saveNotes.mutate(notes)}>Save</Button></div>
                </div>
              ) : o.admin_notes ? <p className="whitespace-pre-wrap text-[13px] text-fg-2">{o.admin_notes}</p> : <p className="text-[13px] text-fg-3">No notes yet.</p>}
            </CardBody>
          </Card>
          {o.refunds.length ? (
            <Card>
              <CardHeader title="Refunds" />
              <CardBody className="space-y-2">
                {o.refunds.map((r) => (
                  <div key={r.id} className="rounded-[10px] border border-border p-3 text-[12.5px]">
                    <div className="flex justify-between"><span className="font-medium">{money(r.amount, o.currency)}</span><Badge>{r.method}</Badge></div>
                    <div className="mt-1 text-fg-3">{date(r.created_at)}{r.admin ? ` · ${r.admin}` : ""}</div>
                    {r.reason ? <div className="mt-1 text-fg-2">{r.reason}</div> : null}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <RefundDialog open={refundOpen} onOpenChange={setRefundOpen} order={o} onDone={refresh} />
      <DeliverDialog item={deliverItem} onClose={() => setDeliverItem(null)} orderId={oid} onDone={refresh} />
      <MessageDialog open={messageOpen} onOpenChange={setMessageOpen} orderId={oid} />
    </div>
  );
}

function ItemRow({ item, order, onDeliver }: { item: OrderItem; order: Order; onDeliver: () => void }) {
  const [reveal, setReveal] = React.useState(false);
  const delivered = item.delivered_quantity >= item.quantity;
  const paid = ["paid", "processing", "completed", "partially_refunded"].includes(order.status);
  return (
    <div className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium">
            {item.product_id ? <Link href={`/products/${item.product_id}`} className="hover:underline">{item.product_name}</Link> : item.product_name}
          </div>
          <div className="mt-0.5 text-[12.5px] text-fg-3">{item.variant_name ? `${item.variant_name} · ` : ""}{item.sku ? `SKU ${item.sku} · ` : ""}{item.delivery_mode} delivery</div>
        </div>
        <div className="text-right">
          <div className="text-[13.5px] font-medium tabular">{money(item.total, order.currency)}</div>
          <div className="text-[12px] text-fg-3 tabular">{item.quantity} × {money(item.unit_price, order.currency)}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge tone={delivered ? "success" : item.delivered_quantity ? "warning" : "neutral"} dot>{item.delivered_quantity}/{item.quantity} delivered</Badge>
        {item.delivered_at ? <span className="text-[12px] text-fg-3">{date(item.delivered_at)}</span> : null}
        <div className="ml-auto flex gap-1.5">
          {item.delivery?.length ? <Button size="sm" variant="ghost" onClick={() => setReveal(!reveal)}>{reveal ? <EyeOff /> : <Eye />}{reveal ? "Hide" : "Show"} delivered data</Button> : null}
          {paid && !delivered ? <Button size="sm" variant="primary" onClick={onDeliver}><Truck />Deliver manually</Button> : null}
        </div>
      </div>
      {reveal && item.delivery?.length ? (
        <div className="mt-3 space-y-1.5 rounded-[10px] border border-border bg-surface-2/50 p-3">
          {item.delivery.map((u, i) => (
            <div key={i} className="flex items-center justify-between gap-2 font-mono text-[12.5px]">
              <span className="break-all">{u.type === "file" ? `📎 file ${u.name ?? u.media_id}` : u.value}</span>
              {u.value && u.value !== "••••••" ? <CopyButton value={u.value} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function RefundDialog({ open, onOpenChange, order, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; order: Order; onDone: () => void }) {
  const max = toNum(order.refundable);
  const [amount, setAmount] = React.useState(String(max));
  const [method, setMethod] = React.useState<"balance" | "provider" | "manual">("balance");
  const [reason, setReason] = React.useState("");
  const confirm = useConfirm();
  React.useEffect(() => { if (open) setAmount(String(max)); }, [open, max]);
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${order.id}/refund`, { amount: Number(amount), method, reason: reason || null }),
    onSuccess: () => { toast.success("Refund processed"); onOpenChange(false); onDone(); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Refund ${order.number}`} description={`Up to ${money(max, order.currency)} can be refunded.`}
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" loading={m.isPending} disabled={!Number(amount) || Number(amount) > max}
            onClick={async () => { const r = await confirm({ title: `Refund ${money(Number(amount), order.currency)}?`, description: "This cannot be undone. The customer will be notified in Telegram.", danger: true, confirmLabel: "Refund" }); if (r.ok) m.mutate(); }}>
            Refund {money(Number(amount) || 0, order.currency)}
          </Button></>}>
        <div className="space-y-4">
          <Field label="Refund to">
            <Segmented value={method} onChange={setMethod} options={[{ value: "balance", label: "Store balance" }, { value: "provider", label: "Original payment" }, { value: "manual", label: "Recorded manually" }]} />
          </Field>
          <p className="-mt-2 text-[12px] text-fg-3">
            {method === "balance" ? "Credits the customer's internal balance instantly." : method === "provider" ? "Sends the refund through the payment provider (Telegram Stars, CryptoBot transfers). Not all providers support it." : "Use when you refunded outside the platform (e.g. bank transfer). Only records the refund."}
          </p>
          <Field label="Amount"><Input type="number" step="0.01" min="0.01" max={max} value={amount} onChange={(e) => setAmount(e.target.value)} suffix={order.currency} /></Field>
          <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional — stored in the order timeline" /></Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DeliverDialog({ item, onClose, orderId, onDone }: { item: OrderItem | null; onClose: () => void; orderId: number; onDone: () => void }) {
  const [text, setText] = React.useState("");
  React.useEffect(() => { setText(""); }, [item]);
  const m = useMutation({
    mutationFn: () => api.post(`/orders/${orderId}/deliver`, { order_item_id: item!.id, contents: text.split(/\n---\n|\n(?=\S)/).map((s) => s.trim()).filter(Boolean) }),
    onSuccess: () => { toast.success("Delivered — the customer received it in Telegram"); onClose(); onDone(); },
  });
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Deliver manually" description={item ? `${item.product_name}${item.variant_name ? ` · ${item.variant_name}` : ""} × ${item.quantity}` : ""}
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!text.trim()} onClick={() => m.mutate()}><Send />Deliver</Button></>}>
        <Field label="Delivery content" help="One code/key per line. The exact content is stored encrypted and sent to the customer.">
          <Textarea rows={7} className="font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={"XXXX-YYYY-ZZZZ\nlogin: user@example.com / pass: ••••"} />
        </Field>
      </DialogContent>
    </Dialog>
  );
}

function MessageDialog({ open, onOpenChange, orderId }: { open: boolean; onOpenChange: (o: boolean) => void; orderId: number }) {
  const [text, setText] = React.useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ status: string }>(`/orders/${orderId}/message`, { text }),
    onSuccess: (r) => { if (r.status === "ok") { toast.success("Message sent"); setText(""); onOpenChange(false); } else toast.error("Telegram rejected the message (customer may have blocked the bot)"); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Message customer" description="Sent by the bot. Telegram HTML formatting is supported."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" loading={m.isPending} disabled={!text.trim()} onClick={() => m.mutate()}><Send />Send</Button></>}>
        <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Hi! About your order…" />
      </DialogContent>
    </Dialog>
  );
}
