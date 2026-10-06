"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Pencil, Plus, Search, Tag, Trash2 } from "lucide-react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent, SheetContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, Checkbox, EmptyState, Segmented, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api";
import type { Category, Paged, Product, UserBrief } from "@/lib/types";
import { date, money, number, toNum, tr, type Num } from "@/lib/utils";

interface Promo {
  id: number; code: string; description?: string | null; type: "percent" | "fixed"; value: Num; max_discount?: Num; min_purchase?: Num;
  max_uses?: number | null; max_uses_per_user?: number | null; starts_at?: string | null; expires_at?: string | null; product_ids: number[];
  category_ids: number[]; user_ids: number[]; new_customers_only: boolean; enabled: boolean; uses_count: number; created_at: string;
  stats?: { uses: number; discount_total: Num; revenue: Num };
}

const num = z.union([z.coerce.number().min(0), z.literal("")]).optional();
const schema = z.object({
  code: z.string().min(2, "At least 2 characters").max(48).regex(/^[A-Za-z0-9_-]+$/, "Letters, digits, - and _ only"),
  description: z.string().max(255).optional(),
  type: z.enum(["percent", "fixed"]),
  value: z.coerce.number().positive("Must be greater than 0"),
  max_discount: num, min_purchase: num, max_uses: num, max_uses_per_user: num,
  starts_at: z.string().optional(), expires_at: z.string().optional(),
  product_ids: z.array(z.number()), category_ids: z.array(z.number()), user_ids_text: z.string().optional(),
  new_customers_only: z.boolean(), enabled: z.boolean(),
}).refine((d) => d.type !== "percent" || d.value <= 100, { message: "Percentage cannot exceed 100", path: ["value"] })
  .refine((d) => !d.starts_at || !d.expires_at || d.starts_at < d.expires_at, { message: "Must be after the start date", path: ["expires_at"] });
type FormValues = z.input<typeof schema>;

const toLocal = (s?: string | null) => (s ? new Date(s).toISOString().slice(0, 16) : "");
const nil = (v: unknown) => (v === "" || v === undefined || v === null ? null : Number(v));

export default function PromoCodesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [f, setF] = useUrlState({ q: "", page: "1", new: "" });
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [editing, setEditing] = React.useState<Promo | "new" | null>(f.new ? "new" : null);
  const [statsFor, setStatsFor] = React.useState<number | null>(null);
  const list = useQuery({ queryKey: ["promos", f.q, f.page], placeholderData: (p) => p, queryFn: () => api.get<Paged<Promo>>("/promo-codes", { q: f.q, page: f.page, page_size: 25 }) });
  const del = useMutation({ mutationFn: (id: number) => api.del<{ status: string }>(`/promo-codes/${id}`), onSuccess: (r) => { toast.success(r.status === "disabled" ? "Code was used — it has been disabled instead" : "Deleted"); qc.invalidateQueries({ queryKey: ["promos"] }); } });

  const status = (p: Promo) => {
    const now = new Date();
    if (!p.enabled) return <Badge>Disabled</Badge>;
    if (p.expires_at && new Date(p.expires_at) < now) return <Badge tone="danger">Expired</Badge>;
    if (p.starts_at && new Date(p.starts_at) > now) return <Badge tone="info">Scheduled</Badge>;
    if (p.max_uses && p.uses_count >= p.max_uses) return <Badge tone="warning">Exhausted</Badge>;
    return <Badge tone="success" dot>Active</Badge>;
  };
  const columns: Column<Promo>[] = [
    { key: "code", header: "Code", cell: (p) => <div><div className="font-mono font-semibold">{p.code}</div>{p.description ? <div className="text-[12px] text-fg-3">{p.description}</div> : null}</div> },
    { key: "discount", header: "Discount", cell: (p) => <span className="font-medium">{p.type === "percent" ? `${toNum(p.value)}%` : money(p.value)}{p.max_discount ? <span className="text-fg-3"> · max {money(p.max_discount)}</span> : null}</span> },
    { key: "rules", header: "Rules", hide: "lg", cell: (p) => (
      <div className="flex flex-wrap gap-1">
        {p.min_purchase ? <Badge>min {money(p.min_purchase)}</Badge> : null}
        {p.new_customers_only ? <Badge tone="info">New customers</Badge> : null}
        {p.product_ids.length ? <Badge>{p.product_ids.length} products</Badge> : null}
        {p.category_ids.length ? <Badge>{p.category_ids.length} categories</Badge> : null}
        {p.user_ids.length ? <Badge>{p.user_ids.length} users</Badge> : null}
      </div>
    ) },
    { key: "uses", header: "Uses", align: "right", cell: (p) => <span>{number(p.uses_count)}{p.max_uses ? <span className="text-fg-3"> / {p.max_uses}</span> : null}</span> },
    { key: "revenue", header: "Revenue", align: "right", hide: "md", cell: (p) => money(p.stats?.revenue) },
    { key: "expires", header: "Expires", hide: "md", cell: (p) => <span className="text-fg-3">{p.expires_at ? date(p.expires_at) : "Never"}</span> },
    { key: "status", header: "Status", cell: status },
    { key: "a", header: "", cell: (p) => (
      <div className="flex justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
        <Button size="icon-sm" variant="ghost" aria-label="Statistics" onClick={() => setStatsFor(p.id)}><BarChart3 /></Button>
        <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(p)}><Pencil /></Button>
        <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: `Delete ${p.code}?`, danger: true, confirmLabel: "Delete" })).ok) del.mutate(p.id); }}><Trash2 /></Button>
      </div>
    ) },
  ];
  return (
    <div>
      <PageHeader title="Promo codes" description="Discounts customers enter in the cart. Limits, schedules and targeting included."
        actions={<Button variant="primary" onClick={() => setEditing("new")}><Plus />New promo code</Button>} />
      <Input icon={<Search />} placeholder="Search codes…" value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 w-full sm:w-72" />
      <DataTable rows={list.data?.items} loading={list.isLoading} columns={columns} getId={(p) => p.id} onRowClick={(p) => setEditing(p)}
        page={Number(f.page)} pages={list.data?.pages} total={list.data?.total} onPage={(p) => setF({ page: String(p) })}
        empty={<EmptyState icon={<Tag />} title="No promo codes" description="Create a code like WELCOME10 to reward new customers." action={<Button variant="primary" onClick={() => setEditing("new")}><Plus />New promo code</Button>} />} />
      {editing ? <PromoForm promo={editing === "new" ? null : editing} onClose={() => { setEditing(null); if (f.new) setF({ new: "" }); }} /> : null}
      {statsFor ? <PromoStats id={statsFor} onClose={() => setStatsFor(null)} /> : null}
    </div>
  );
}

function PromoForm({ promo, onClose }: { promo: Promo | null; onClose: () => void }) {
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ["products", "all-min"], queryFn: () => api.get<Paged<Product>>("/products", { page_size: 200 }) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories") });
  const { register, handleSubmit, control, watch, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      code: promo?.code ?? "", description: promo?.description ?? "", type: promo?.type ?? "percent", value: promo ? toNum(promo.value) : 10,
      max_discount: promo?.max_discount ? toNum(promo.max_discount) : "", min_purchase: promo?.min_purchase ? toNum(promo.min_purchase) : "",
      max_uses: promo?.max_uses ?? "", max_uses_per_user: promo?.max_uses_per_user ?? "", starts_at: toLocal(promo?.starts_at), expires_at: toLocal(promo?.expires_at),
      product_ids: promo?.product_ids ?? [], category_ids: promo?.category_ids ?? [], user_ids_text: (promo?.user_ids ?? []).join(", "),
      new_customers_only: promo?.new_customers_only ?? false, enabled: promo?.enabled ?? true,
    },
  });
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = {
        code: v.code.toUpperCase(), description: v.description || null, type: v.type, value: Number(v.value), max_discount: nil(v.max_discount),
        min_purchase: nil(v.min_purchase), max_uses: nil(v.max_uses), max_uses_per_user: nil(v.max_uses_per_user),
        starts_at: v.starts_at ? new Date(v.starts_at).toISOString() : null, expires_at: v.expires_at ? new Date(v.expires_at).toISOString() : null,
        product_ids: v.product_ids, category_ids: v.category_ids, new_customers_only: v.new_customers_only, enabled: v.enabled,
        user_ids: (v.user_ids_text ?? "").split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n)),
      };
      return promo ? api.put(`/promo-codes/${promo.id}`, body) : api.post("/promo-codes", body);
    },
    onSuccess: () => { toast.success("Promo code saved"); qc.invalidateQueries({ queryKey: ["promos"] }); onClose(); },
  });
  const type = watch("type");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={promo ? `Edit ${promo.code}` : "New promo code"} width={560}
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={handleSubmit((v) => save.mutate(v))}>Save</Button></>}>
        <form className="space-y-4" onSubmit={handleSubmit((v) => save.mutate(v))}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" required error={errors.code?.message}><Input className="font-mono uppercase" {...register("code")} placeholder="WELCOME10" /></Field>
            <Field label="Internal description"><Input {...register("description")} /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr]">
            <Field label="Type"><Controller control={control} name="type" render={({ field }) => <Segmented value={field.value} onChange={field.onChange} options={[{ value: "percent", label: "%" }, { value: "fixed", label: "Fixed" }]} />} /></Field>
            <Field label={type === "percent" ? "Percentage" : "Amount"} required error={errors.value?.message}><Input type="number" step="0.01" {...register("value")} /></Field>
            <Field label="Max discount" error={errors.max_discount?.message}><Input type="number" step="0.01" {...register("max_discount")} placeholder="No cap" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Min. purchase"><Input type="number" step="0.01" {...register("min_purchase")} placeholder="—" /></Field>
            <Field label="Max. total uses"><Input type="number" {...register("max_uses")} placeholder="∞" /></Field>
            <Field label="Uses per customer"><Input type="number" {...register("max_uses_per_user")} placeholder="∞" /></Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts"><Input type="datetime-local" {...register("starts_at")} /></Field>
            <Field label="Expires" error={errors.expires_at?.message}><Input type="datetime-local" {...register("expires_at")} /></Field>
          </div>
          <Controller control={control} name="category_ids" render={({ field }) => (
            <Field label="Only for categories" help="Leave empty for all categories">
              <div className="flex flex-wrap gap-x-4 gap-y-2">{(cats.data ?? []).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px] text-fg-2"><Checkbox checked={field.value.includes(c.id)} onCheckedChange={(v) => field.onChange(v ? [...field.value, c.id] : field.value.filter((x) => x !== c.id))} />{c.emoji} {tr(c.name)}</label>
              ))}</div>
            </Field>
          )} />
          <Controller control={control} name="product_ids" render={({ field }) => (
            <Field label="Only for products" help="Leave empty for all products">
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-[10px] border border-border p-2 sm:grid-cols-2">{(products.data?.items ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[13px] text-fg-2"><Checkbox checked={field.value.includes(p.id)} onCheckedChange={(v) => field.onChange(v ? [...field.value, p.id] : field.value.filter((x) => x !== p.id))} /><span className="truncate">{p.emoji} {p.display_name}</span></label>
              ))}</div>
            </Field>
          )} />
          <Field label="Only for specific customers" help="Customer IDs or Telegram IDs, separated by commas"><Input {...register("user_ids_text")} /></Field>
          <Controller control={control} name="new_customers_only" render={({ field }) => <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={field.value} onCheckedChange={field.onChange} />New customers only (no previous purchase)</label>} />
          <Controller control={control} name="enabled" render={({ field }) => <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={field.value} onCheckedChange={field.onChange} />Enabled</label>} />
        </form>
      </SheetContent>
    </Dialog>
  );
}

function PromoStats({ id, onClose }: { id: number; onClose: () => void }) {
  const q = useQuery({ queryKey: ["promo", id], queryFn: () => api.get<Promo & { stats: { uses: number; discount_total: Num; revenue: Num; customers: number }; usages: { id: number; customer?: UserBrief; order_id: number; order_number?: string; discount: Num; order_total: Num; created_at: string }[] }>(`/promo-codes/${id}`) });
  const d = q.data;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={d ? `Usage · ${d.code}` : "Usage"}>
        {d ? (<>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[["Uses", number(d.stats.uses)], ["Customers", number(d.stats.customers)], ["Discount given", money(d.stats.discount_total)], ["Revenue", money(d.stats.revenue)]].map(([l, v]) => (
              <div key={l} className="card p-3"><div className="text-[12px] text-fg-3">{l}</div><div className="text-[16px] font-semibold">{v}</div></div>
            ))}
          </div>
          {!d.usages.length ? <EmptyState title="Not used yet" /> : (
            <div className="divide-y divide-border rounded-[12px] border border-border">
              {d.usages.map((u) => (
                <a key={u.id} href={`/orders/${u.order_id}`} className="flex items-center gap-3 px-3 py-2 text-[13px] hover:bg-hover">
                  <span className="font-mono text-[12px]">{u.order_number}</span><span className="flex-1 truncate text-fg-2">{u.customer?.display_name}</span>
                  <span className="text-success">−{money(u.discount)}</span><span className="w-20 text-right">{money(u.order_total)}</span>
                  <span className="hidden w-32 text-right text-fg-3 sm:block">{date(u.created_at)}</span>
                </a>
              ))}
            </div>
          )}
        </>) : null}
      </DialogContent>
    </Dialog>
  );
}
