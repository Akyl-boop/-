"use client";

import { useQuery } from "@tanstack/react-query";
import { Download, Filter, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/input";
import { Avatar, Badge, EmptyState, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useLanguages } from "@/components/shared/i18n-field";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api, download } from "@/lib/api";
import type { Customer, Paged, Tag } from "@/lib/types";
import { date, money, number, timeAgo } from "@/lib/utils";

export default function CustomersPage() {
  const router = useRouter();
  const [f, setF] = useUrlState({ q: "", tag_id: "", banned: "", language: "", has_orders: "", min_spent: "", max_spent: "", joined_from: "", joined_to: "", page: "1", sort: "-created_at" });
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
  const langs = useLanguages().data ?? [];
  const list = useQuery({ queryKey: ["customers", f], placeholderData: (p) => p, queryFn: () => api.get<Paged<Customer>>("/customers", { ...f, page_size: 25 }) });
  const activeFilters = ["banned", "has_orders", "min_spent", "max_spent", "joined_from", "joined_to"].filter((k) => f[k as keyof typeof f]).length;

  const columns: Column<Customer>[] = [
    { key: "name", header: "Customer", cell: (c) => (
      <div className="flex items-center gap-2.5">
        <Avatar name={c.display_name} size={30} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium">{c.display_name}{c.is_premium ? <span title="Telegram Premium">⭐</span> : null}</div>
          <div className="truncate text-[12px] text-fg-3">{c.username ? `@${c.username} · ` : ""}{c.telegram_id}</div>
        </div>
      </div>
    ) },
    { key: "tags", header: "Tags", hide: "lg", cell: (c) => (
      <div className="flex flex-wrap gap-1">
        {c.is_banned ? <Badge tone="danger">Banned</Badge> : null}
        {c.tags.slice(0, 3).map((t) => <Badge key={t.id} style={{ color: t.color, background: `${t.color}1f` }}>{t.name}</Badge>)}
      </div>
    ) },
    { key: "lang", header: "Lang", hide: "md", cell: (c) => <span className="uppercase text-fg-2">{c.language}</span> },
    { key: "orders", header: "Orders", align: "right", sortKey: "orders", cell: (c) => number(c.paid_orders_count) },
    { key: "spent", header: "Spent", align: "right", sortKey: "total_spent", cell: (c) => <span className="font-medium">{money(c.total_spent)}</span> },
    { key: "active", header: "Last active", hide: "lg", sortKey: "last_activity_at", cell: (c) => <span className="text-fg-3">{timeAgo(c.last_activity_at)}</span> },
    { key: "joined", header: "Joined", hide: "md", sortKey: "created_at", cell: (c) => <span className="text-fg-3">{date(c.created_at, false)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Customers" description="Everyone who started your bot — with CRM tags, notes and purchase history."
        actions={<Button onClick={() => download("/customers/export", { q: f.q, tag_id: f.tag_id, banned: f.banned, language: f.language })}><Download />Export CSV</Button>} />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input icon={<Search />} placeholder="Name, @username, Telegram ID, referral code…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-80" />
        <Select className="w-40" value={f.tag_id} onChange={(v) => setF({ tag_id: v })} allowEmpty="All tags" options={(tags.data ?? []).map((t) => ({ value: String(t.id), label: t.name, hint: t.customers }))} />
        <Select className="w-36" value={f.language} onChange={(v) => setF({ language: v })} allowEmpty="All languages" options={langs.map((l) => ({ value: l.code, label: `${l.flag} ${l.native_name}` }))} />
        <Popover>
          <PopoverTrigger asChild><Button><Filter />Filters{activeFilters ? <Badge tone="accent">{activeFilters}</Badge> : null}</Button></PopoverTrigger>
          <PopoverContent className="w-80 space-y-3 p-3">
            <Field label="Purchases"><Select value={f.has_orders} onChange={(v) => setF({ has_orders: v })} allowEmpty="Any" options={[{ value: "true", label: "Customers (bought)" }, { value: "false", label: "Non-customers" }]} /></Field>
            <Field label="Ban status"><Select value={f.banned} onChange={(v) => setF({ banned: v })} allowEmpty="Any" options={[{ value: "true", label: "Banned" }, { value: "false", label: "Not banned" }]} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Spent from"><Input type="number" value={f.min_spent} onChange={(e) => setF({ min_spent: e.target.value })} /></Field>
              <Field label="Spent to"><Input type="number" value={f.max_spent} onChange={(e) => setF({ max_spent: e.target.value })} /></Field>
              <Field label="Joined from"><Input type="date" value={f.joined_from} onChange={(e) => setF({ joined_from: e.target.value })} /></Field>
              <Field label="Joined to"><Input type="date" value={f.joined_to} onChange={(e) => setF({ joined_to: e.target.value })} /></Field>
            </div>
            <Button size="sm" variant="ghost" className="w-full" onClick={() => setF({ banned: "", has_orders: "", min_spent: "", max_spent: "", joined_from: "", joined_to: "" })}>Reset filters</Button>
          </PopoverContent>
        </Popover>
      </div>
      <DataTable rows={list.data?.items} loading={list.isLoading} columns={columns} getId={(c) => c.id} onRowClick={(c) => router.push(`/customers/${c.id}`)}
        sort={f.sort} onSort={(s) => setF({ sort: s })} page={Number(f.page)} pages={list.data?.pages} total={list.data?.total} onPage={(p) => setF({ page: String(p) })}
        empty={<EmptyState icon={<Users />} title="No customers found" description="Customers appear when they start your bot." />}
        mobileCard={(c) => (
          <div className="flex items-center gap-3">
            <Avatar name={c.display_name} size={34} />
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{c.display_name}</div><div className="text-[12px] text-fg-3">{c.paid_orders_count} orders · joined {date(c.created_at, false)}</div></div>
            <div className="font-medium">{money(c.total_spent)}</div>
          </div>
        )} />
    </div>
  );
}
