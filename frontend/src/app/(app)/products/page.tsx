"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, MoreHorizontal, Package, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Input } from "@/components/ui/input";
import { Badge, EmptyState } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Category, Paged, Product } from "@/lib/types";
import { money, number, toNum, tr } from "@/lib/utils";
import { PRODUCT_STATUSES, StockCell } from "@/features/products";

export default function ProductsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const [f, setF] = useUrlState({ q: "", status: "", category_id: "", page: "1", sort: "sort_order" });
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = React.useState<Set<string | number>>(new Set());
  const [importOpen, setImportOpen] = React.useState(false);

  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.get<Category[]>("/categories") });
  const list = useQuery({ queryKey: ["products", f], placeholderData: (p) => p, queryFn: () => api.get<Paged<Product>>("/products", { ...f, page_size: 25 }) });
  const invalidate = () => qc.invalidateQueries({ queryKey: ["products"] });
  const bulk = useMutation({
    mutationFn: (status: string) => api.post<{ updated: number }>("/products/bulk-status", { ids: [...selected], status }),
    onSuccess: (r) => { toast.success(`${r.updated} product(s) updated`); setSelected(new Set()); invalidate(); },
  });
  const dup = useMutation({ mutationFn: (id: number) => api.post<{ id: number }>(`/products/${id}/duplicate`), onSuccess: (r) => { toast.success("Duplicated as draft"); router.push(`/products/${r.id}`); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/products/${id}`), onSuccess: () => { toast.success("Product deleted"); invalidate(); } });

  const columns: Column<Product>[] = [
    { key: "name", header: "Product", cell: (p) => (
      <div className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-border bg-surface-2 text-[17px]">
          {p.media_id ? <img src={`/api/media/${p.media_id}/file`} alt="" className="h-full w-full object-cover" /> : p.emoji || <Package className="size-4 text-fg-3" />}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate font-medium">{p.display_name}{p.is_featured ? <Badge tone="accent">Featured</Badge> : null}</div>
          <div className="truncate text-[12px] text-fg-3">{p.variants_count} variant{p.variants_count === 1 ? "" : "s"} · /{p.slug}</div>
        </div>
      </div>
    ) },
    { key: "category", header: "Category", hide: "lg", cell: (p) => p.category ? <span className="text-fg-2">{p.category.emoji} {tr(p.category.name)}</span> : <span className="text-fg-3">—</span> },
    { key: "price", header: "Price", align: "right", cell: (p) => toNum(p.price_min) === toNum(p.price_max) ? money(p.price_min) : `${money(p.price_min)} – ${money(p.price_max)}` },
    { key: "stock", header: "Stock", align: "right", hide: "md", cell: (p) => <StockCell stock={p.stock} /> },
    { key: "sold", header: "Sold", align: "right", hide: "xl", sortKey: "sold", cell: (p) => number(p.sold_count) },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
    { key: "actions", header: "", className: "w-10", cell: (p) => (
      <div onClick={(e) => e.stopPropagation()}>
        <Dropdown>
          <DropdownTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Actions"><MoreHorizontal /></Button></DropdownTrigger>
          <DropdownContent>
            <DropdownItem icon={<Pencil />} onSelect={() => router.push(`/products/${p.id}`)}>Edit</DropdownItem>
            {can("products.edit") ? <DropdownItem icon={<Copy />} onSelect={() => dup.mutate(p.id)}>Duplicate</DropdownItem> : null}
            {can("products.delete") ? (<><DropdownSeparator />
              <DropdownItem danger icon={<Trash2 />} onSelect={async () => {
                const r = await confirm({ title: `Delete ${p.display_name}?`, description: "The product is removed from the storefront. Order history is kept.", danger: true, confirmLabel: "Delete" });
                if (r.ok) del.mutate(p.id);
              }}>Delete</DropdownItem></>) : null}
          </DropdownContent>
        </Dropdown>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Products" description="Your catalog — prices, variants, delivery and visibility."
        actions={<>
          <Button onClick={() => download("/products/export")}><Download />Export</Button>
          {can("products.edit") ? <Button onClick={() => setImportOpen(true)}><Upload />Import</Button> : null}
          {can("products.edit") ? <Link href="/products/new"><Button variant="primary"><Plus />New product</Button></Link> : null}
        </>} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Input icon={<Search />} placeholder="Search name, slug or SKU…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-72" />
        <Select className="w-40" value={f.status} onChange={(v) => setF({ status: v })} allowEmpty="All statuses" options={PRODUCT_STATUSES} />
        <Select className="w-48" value={f.category_id} onChange={(v) => setF({ category_id: v })} allowEmpty="All categories"
          options={(cats.data ?? []).map((c) => ({ value: String(c.id), label: `${c.emoji ?? ""} ${tr(c.name)}` }))} />
        {selected.size ? (
          <div className="ml-auto flex items-center gap-2 rounded-[9px] border border-accent/30 bg-accent/5 px-2 py-1 text-[12.5px]">
            <span className="text-fg-2">{selected.size} selected</span>
            <Select size="sm" className="w-40" value="" placeholder="Set status…" onChange={(v) => bulk.mutate(v)} options={PRODUCT_STATUSES} />
          </div>
        ) : null}
      </div>
      <DataTable rows={list.data?.items} loading={list.isLoading} columns={columns} getId={(p) => p.id}
        onRowClick={(p) => router.push(`/products/${p.id}`)} selected={can("products.edit") ? selected : undefined}
        onSelectedChange={can("products.edit") ? setSelected : undefined} sort={f.sort} onSort={(s) => setF({ sort: s })}
        page={Number(f.page)} pages={list.data?.pages} total={list.data?.total} onPage={(p) => setF({ page: String(p) })}
        empty={<EmptyState icon={<Package />} title="No products yet" description="Create your first product — it appears in the bot instantly."
          action={can("products.edit") ? <Link href="/products/new"><Button variant="primary"><Plus />New product</Button></Link> : undefined} />}
        mobileCard={(p) => (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><div className="truncate font-medium">{p.emoji} {p.display_name}</div><div className="mt-1"><StatusBadge status={p.status} /></div></div>
            <div className="text-right"><div className="font-medium">{money(p.price_min)}</div><div className="mt-1 text-[12px]"><StockCell stock={p.stock} /></div></div>
          </div>
        )} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={invalidate} />
    </div>
  );
}

function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const m = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append("file", file!); return api.upload<{ created: number; updated: number; errors: string[] }>("/products/import", fd); },
    onSuccess: (r) => { setResult(r); if (!r.errors.length) { toast.success(`Imported: ${r.created} created, ${r.updated} updated`); onDone(); } },
  });
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setFile(null); setResult(null); } }}>
      <DialogContent title="Import products from CSV" description="Columns: slug, name_en, price (required); name_ru, name_zh, category_slug, status, emoji, sku, variant_en, old_price, cost_price, stock_mode, delivery_mode, short_description_en. Rows with the same slug become variants."
        footer={<><Button variant="ghost" onClick={() => download("/products/export")}><Download />Download current as template</Button><Button variant="primary" disabled={!file} loading={m.isPending} onClick={() => m.mutate()}><Upload />Import</Button></>}>
        <input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setResult(null); }}
          className="block w-full text-[13px] text-fg-2 file:mr-3 file:rounded-[8px] file:border file:border-border file:bg-surface-2 file:px-3 file:py-1.5 file:text-fg" />
        {result?.errors.length ? (
          <div className="mt-4 rounded-[10px] border border-danger/30 bg-danger-bg p-3">
            <p className="mb-1.5 text-[13px] font-medium text-danger">Nothing was imported — fix these rows and try again:</p>
            <ul className="max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-[12.5px] text-fg-2">{result.errors.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
