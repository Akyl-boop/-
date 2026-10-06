"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Search, ShoppingBag } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Input } from "@/components/ui/input";
import { Avatar, EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api, download } from "@/lib/api";
import type { OrderBrief, Paged } from "@/lib/types";
import { cn, date, money, timeAgo } from "@/lib/utils";

const TABS = [
  { value: "", label: "All" },
  { value: "pending,awaiting_payment,awaiting_confirmation", label: "Awaiting payment" },
  { value: "paid,processing", label: "To fulfil" },
  { value: "completed", label: "Completed" },
  { value: "cancelled,expired,failed", label: "Cancelled" },
  { value: "refunded,partially_refunded", label: "Refunded" },
];

export default function OrdersPage() {
  const router = useRouter();
  const [f, setF] = useUrlState({ status: "", q: "", payment_method: "", delivery_status: "", page: "1", sort: "-created_at" });
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: () => api.get<{ code: string; name: Record<string, string> }[]>("/payment-methods") });
  const list = useQuery({
    queryKey: ["orders", f], placeholderData: (p) => p,
    queryFn: () => api.get<Paged<OrderBrief>>("/orders", { ...f, page_size: 25 }),
  });

  const columns: Column<OrderBrief>[] = [
    { key: "number", header: "Order", cell: (o) => <span className="font-mono text-[12.5px] font-medium">{o.number}</span> },
    { key: "customer", header: "Customer", cell: (o) => (
      <div className="flex items-center gap-2"><Avatar name={o.customer.display_name} size={22} /><span className="max-w-[160px] truncate">{o.customer.display_name}</span></div>
    ) },
    { key: "product", header: "Product", hide: "lg", cell: (o) => (
      <div className="max-w-[220px]"><div className="truncate">{o.product}{o.items_count > 1 ? <span className="text-fg-3"> +{o.items_count - 1}</span> : null}</div>
        {o.variant ? <div className="truncate text-[12px] text-fg-3">{o.variant}</div> : null}</div>
    ) },
    { key: "qty", header: "Qty", hide: "xl", align: "right", cell: (o) => o.quantity },
    { key: "total", header: "Amount", align: "right", sortKey: "total", cell: (o) => <span className="font-medium">{money(o.total, o.currency)}</span> },
    { key: "payment", header: "Payment", hide: "md", cell: (o) => <span className="text-fg-2">{o.payment_method ?? "—"}</span> },
    { key: "status", header: "Status", cell: (o) => <StatusBadge status={o.status} /> },
    { key: "delivery", header: "Delivery", hide: "xl", cell: (o) => <StatusBadge status={o.delivery_status} /> },
    { key: "created", header: "Created", hide: "md", sortKey: "created_at", cell: (o) => <span className="text-fg-3" title={date(o.created_at)}>{timeAgo(o.created_at)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Orders" description="Every purchase made through your bot, updated in real time."
        actions={<Button onClick={() => download("/orders/export", { status: f.status })}><Download />Export CSV</Button>} />
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button key={t.label} type="button" onClick={() => setF({ status: t.value })}
            className={cn("-mb-px h-9 shrink-0 border-b-2 border-transparent px-3 text-[13px] font-medium text-fg-3 hover:text-fg", f.status === t.value && "border-accent text-fg")}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Input icon={<Search />} placeholder="Order #, customer, @username, product…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-80" />
        <Select className="w-44" value={f.payment_method} onChange={(v) => setF({ payment_method: v })} allowEmpty="All methods"
          options={(methods.data ?? []).map((m) => ({ value: m.code, label: m.name.en ?? m.code }))} />
        <Select className="w-44" value={f.delivery_status} onChange={(v) => setF({ delivery_status: v })} allowEmpty="Any delivery"
          options={["pending", "delivered", "partial", "manual", "failed"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
      </div>
      <DataTable rows={list.data?.items} loading={list.isLoading} columns={columns} getId={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)} sort={f.sort} onSort={(s) => setF({ sort: s })}
        page={Number(f.page)} pages={list.data?.pages} total={list.data?.total} onPage={(p) => setF({ page: String(p) })}
        empty={<EmptyState icon={<ShoppingBag />} title="No orders found" description="Orders appear here as soon as customers check out in the bot." />}
        mobileCard={(o) => (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-mono text-[13px] font-medium">{o.number}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-fg-3">{o.customer.display_name} · {o.product}</div>
              <div className="mt-2"><StatusBadge status={o.status} /></div>
            </div>
            <div className="text-right"><div className="font-semibold">{money(o.total, o.currency)}</div><div className="text-[12px] text-fg-3">{timeAgo(o.created_at)}</div></div>
          </div>
        )} />
    </div>
  );
}
