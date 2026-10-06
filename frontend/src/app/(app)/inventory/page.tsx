"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Boxes, CheckCircle2, Download, Eye, FileUp, History, Plus, Search, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, CopyButton, EmptyState, Segmented, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api, download } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Paged } from "@/lib/types";
import { cn, date, number, timeAgo, tr, type I18n } from "@/lib/utils";

interface VariantStock { id: number; sku: string; name: I18n; is_active: boolean; available: number | null; reserved: number; delivered: number; invalid: number; disabled: number }
interface ProductStock { product_id: number; name: I18n; display_name: string; emoji?: string; status: string; stock_mode: string; low_stock_threshold: number; available: number | null; low: boolean; variants: VariantStock[] }
interface Item { id: number; product_id: number; variant_id: number; kind: string; preview: string; status: string; order_id?: number | null; reserved_at?: string; delivered_at?: string; batch?: string; note?: string; created_at: string; variant_name?: I18n; sku?: string }
interface HistoryRow { id: number; product_id: number; variant_id?: number; action: string; quantity: number; order_id?: number; admin?: string; note?: string; created_at: string }
interface Report { added: number; duplicates: number; invalid: number; errors: string[] }

export default function InventoryPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const [f, setF] = useUrlState({ product: "", variant: "", status: "available", q: "", page: "1", low: "", add: "" });
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = React.useState<Set<string | number>>(new Set());
  const [addOpen, setAddOpen] = React.useState(f.add === "1");
  const [revealed, setRevealed] = React.useState<Record<number, string>>({});

  const summary = useQuery({ queryKey: ["inventory", "summary"], queryFn: () => api.get<ProductStock[]>("/inventory/summary") });
  const items = useQuery({
    queryKey: ["inventory", "items", f], placeholderData: (p) => p, enabled: !!f.product,
    queryFn: () => api.get<Paged<Item>>("/inventory", { product_id: f.product, variant_id: f.variant, status: f.status, q: f.q, page: f.page, page_size: 50 }),
  });
  const history = useQuery({
    queryKey: ["inventory", "history", f.product], enabled: !!f.product,
    queryFn: () => api.get<Paged<HistoryRow>>("/inventory/history", { product_id: f.product, page_size: 50 }),
  });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["inventory"] }); setSelected(new Set()); };
  const setStatus = useMutation({ mutationFn: (status: string) => api.post<{ updated: number }>("/inventory/status", { ids: [...selected], status }), onSuccess: (r) => { toast.success(`${r.updated} item(s) updated`); invalidate(); } });
  const del = useMutation({ mutationFn: () => api.post<{ deleted: number }>("/inventory/delete", { ids: [...selected] }), onSuccess: (r) => { toast.success(`${r.deleted} item(s) deleted`); invalidate(); } });
  const reveal = useMutation({ mutationFn: (id: number) => api.get<{ id: number; content: string }>(`/inventory/${id}/reveal`), onSuccess: (r) => setRevealed((x) => ({ ...x, [r.id]: r.content })) });

  const products = (summary.data ?? []).filter((p) => (f.low ? p.low : true));
  const current = summary.data?.find((p) => String(p.product_id) === f.product);

  const columns: Column<Item>[] = [
    { key: "id", header: "#", cell: (i) => <span className="font-mono text-[12px] text-fg-3">{i.id}</span> },
    { key: "content", header: "Content", cell: (i) => (
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[12.5px]">{revealed[i.id] ?? i.preview}</span>
        {revealed[i.id] ? <CopyButton value={revealed[i.id]} /> : can("inventory.reveal") ? (
          <button type="button" className="rounded p-1 text-fg-3 hover:bg-hover hover:text-fg" title="Reveal (audited)" onClick={(e) => { e.stopPropagation(); reveal.mutate(i.id); }}><Eye className="size-3.5" /></button>
        ) : null}
      </div>
    ) },
    { key: "variant", header: "Variant", hide: "md", cell: (i) => <span className="text-fg-2">{tr(i.variant_name)}</span> },
    { key: "status", header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
    { key: "order", header: "Order", hide: "lg", cell: (i) => i.order_id ? <a className="text-accent hover:underline" href={`/orders/${i.order_id}`}>#{i.order_id}</a> : <span className="text-fg-3">—</span> },
    { key: "batch", header: "Batch", hide: "xl", cell: (i) => <span className="text-fg-3">{i.batch ?? "—"}</span> },
    { key: "created", header: "Added", hide: "md", cell: (i) => <span className="text-fg-3" title={date(i.created_at)}>{timeAgo(i.created_at)}</span> },
  ];

  return (
    <div>
      <PageHeader title="Inventory" description="Digital stock: codes, keys, accounts and files. Every item is encrypted at rest and delivered exactly once."
        actions={can("inventory.manage") ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus />Add stock</Button> : null} />
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Segmented value={f.low ? "low" : "all"} onChange={(v) => setF({ low: v === "low" ? "1" : "" })} options={[{ value: "all", label: "All products" }, { value: "low", label: "Low stock" }]} />
          </div>
          <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
            {summary.isLoading ? <div className="space-y-2 p-3">{[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-11" />)}</div> : !products.length ? (
              <EmptyState icon={<Boxes />} title={f.low ? "No low-stock products" : "No products"} className="py-10" />
            ) : products.map((p) => (
              <button key={p.product_id} type="button" onClick={() => setF({ product: String(p.product_id), variant: "", page: "1" })}
                className={cn("flex w-full items-center gap-3 border-b border-border px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-hover", f.product === String(p.product_id) && "bg-active")}>
                <span className="text-[17px]">{p.emoji || "📦"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{p.display_name}</div>
                  <div className="text-[11.5px] text-fg-3">{p.stock_mode === "inventory" ? `${p.variants.length} variant(s)` : p.stock_mode === "unlimited" ? "Unlimited stock" : "Manual counter"}</div>
                </div>
                {p.available === null ? <span className="text-fg-3">∞</span> : (
                  <Badge tone={p.available === 0 ? "danger" : p.low ? "warning" : "neutral"}>{p.low && p.available > 0 ? <AlertTriangle className="size-3" /> : null}{number(p.available)}</Badge>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0">
          {!current ? (
            <div className="card"><EmptyState icon={<Boxes />} title="Select a product" description="Choose a product on the left to manage its stock, or add new stock in bulk." /></div>
          ) : (
            <Tabs defaultValue="items">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[16px] font-semibold">{current.emoji} {current.display_name}</h2>
                <TabsList className="border-0"><TabsTrigger value="items"><Boxes />Items</TabsTrigger><TabsTrigger value="history"><History />History</TabsTrigger></TabsList>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {current.variants.map((v) => (
                  <button key={v.id} type="button" onClick={() => setF({ variant: f.variant === String(v.id) ? "" : String(v.id) })}
                    className={cn("card p-3 text-left transition-colors hover:border-border-strong", f.variant === String(v.id) && "border-accent/60 ring-1 ring-accent/30", !v.is_active && "opacity-60")}>
                    <div className="truncate text-[12.5px] font-medium">{tr(v.name)}</div>
                    <div className="mt-1 flex items-baseline gap-1.5"><span className="text-[18px] font-semibold tabular">{v.available === null ? "∞" : number(v.available)}</span><span className="text-[11.5px] text-fg-3">available</span></div>
                    <div className="mt-1 text-[11px] text-fg-3">{v.reserved} reserved · {v.delivered} delivered{v.invalid ? ` · ${v.invalid} invalid` : ""}</div>
                  </button>
                ))}
              </div>
              <TabsContent value="items">
                {current.stock_mode !== "inventory" ? (
                  <div className="card"><EmptyState title={current.stock_mode === "unlimited" ? "Unlimited stock" : "Manual stock counter"} description="This product doesn't use inventory items. Switch the stock mode to “Inventory items” in the product editor to load codes." /></div>
                ) : (<>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Input icon={<Search />} placeholder="Preview, batch, item # or exact code (select a variant)" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-80" />
                    <Select className="w-40" value={f.status} onChange={(v) => setF({ status: v })} allowEmpty="Any status"
                      options={["available", "reserved", "delivered", "invalid", "disabled"].map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} />
                    <div className="ml-auto flex gap-2">
                      {can("inventory.reveal") ? <Button onClick={() => download("/inventory/export", { product_id: f.product, variant_id: f.variant, status: f.status || "available" })}><Download />Export</Button> : null}
                    </div>
                  </div>
                  {selected.size && can("inventory.manage") ? (
                    <div className="mb-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-accent/30 bg-accent/5 px-3 py-2 text-[12.5px]">
                      <span className="mr-auto text-fg-2">{selected.size} selected</span>
                      <Button size="sm" onClick={() => setStatus.mutate("available")}><CheckCircle2 />Available</Button>
                      <Button size="sm" onClick={() => setStatus.mutate("invalid")}><AlertTriangle />Invalid</Button>
                      <Button size="sm" onClick={() => setStatus.mutate("disabled")}><Ban />Disable</Button>
                      <Button size="sm" variant="danger" onClick={async () => { const r = await confirm({ title: `Delete ${selected.size} item(s)?`, description: "Reserved and delivered items are never deleted.", danger: true, confirmLabel: "Delete" }); if (r.ok) del.mutate(); }}><Trash2 />Delete</Button>
                    </div>
                  ) : null}
                  <DataTable dense rows={items.data?.items} loading={items.isLoading} columns={columns} getId={(i) => i.id}
                    selected={can("inventory.manage") ? selected : undefined} onSelectedChange={can("inventory.manage") ? setSelected : undefined}
                    page={Number(f.page)} pages={items.data?.pages} total={items.data?.total} onPage={(p) => setF({ page: String(p) })}
                    empty={<EmptyState icon={<Boxes />} title="No items" description="Add stock manually or import a TXT/CSV file." action={can("inventory.manage") ? <Button variant="primary" onClick={() => setAddOpen(true)}><Plus />Add stock</Button> : undefined} />} />
                </>)}
              </TabsContent>
              <TabsContent value="history">
                <div className="card divide-y divide-border">
                  {history.isLoading ? <div className="p-4"><Skeleton className="h-20" /></div> : !history.data?.items.length ? <EmptyState title="No stock history yet" /> : history.data.items.map((h) => (
                    <div key={h.id} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <Badge tone={h.action === "added" ? "success" : h.action === "delivered" ? "info" : h.action.includes("invalid") || h.action === "deleted" ? "danger" : "neutral"}>{h.action.replace("_", " ")}</Badge>
                      <span className="tabular font-medium">{h.action === "added" || h.action === "released" ? "+" : "−"}{h.quantity}</span>
                      <span className="min-w-0 flex-1 truncate text-fg-3">{h.note ?? ""}{h.order_id ? ` · order #${h.order_id}` : ""}{h.admin ? ` · ${h.admin}` : ""}</span>
                      <span className="text-[12px] text-fg-3">{date(h.created_at)}</span>
                    </div>
                  ))}
                </div>
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      <AddStockDialog open={addOpen} onOpenChange={(o) => { setAddOpen(o); if (!o && f.add) setF({ add: "" }); }} products={summary.data ?? []}
        defaultProduct={f.product} defaultVariant={f.variant} onDone={invalidate} />
    </div>
  );
}

function AddStockDialog({ open, onOpenChange, products, defaultProduct, defaultVariant, onDone }: {
  open: boolean; onOpenChange: (o: boolean) => void; products: ProductStock[]; defaultProduct: string; defaultVariant: string; onDone: () => void;
}) {
  const [productId, setProductId] = React.useState(defaultProduct);
  const [variantId, setVariantId] = React.useState(defaultVariant);
  const [mode, setMode] = React.useState<"paste" | "file">("paste");
  const [kind, setKind] = React.useState("code");
  const [text, setText] = React.useState("");
  const [file, setFile] = React.useState<File | null>(null);
  const [report, setReport] = React.useState<Report | null>(null);
  React.useEffect(() => { if (open) { setProductId(defaultProduct); setVariantId(defaultVariant); setReport(null); } }, [open, defaultProduct, defaultVariant]);
  const product = products.find((p) => String(p.product_id) === productId);
  React.useEffect(() => { if (product && !product.variants.some((v) => String(v.id) === variantId)) setVariantId(String(product.variants[0]?.id ?? "")); }, [product, variantId]);
  const lines = text.includes("\n---\n") ? text.split("\n---\n").filter((s) => s.trim()) : text.split("\n").filter((s) => s.trim());
  const m = useMutation({
    mutationFn: () => {
      if (mode === "file") {
        const fd = new FormData();
        fd.append("file", file!); fd.append("variant_id", variantId); fd.append("kind", kind);
        return api.upload<Report>("/inventory/import", fd);
      }
      return api.post<Report>("/inventory", { variant_id: Number(variantId), items: lines.map((l) => l.trim()), kind });
    },
    onSuccess: (r) => { setReport(r); setText(""); setFile(null); onDone(); toast.success(`${r.added} item(s) added`); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" title="Add stock" description="Items are encrypted, de-duplicated per variant and become available immediately. Customers subscribed to restock alerts are notified."
        footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
          <Button variant="primary" loading={m.isPending} disabled={!variantId || (mode === "paste" ? !lines.length : !file)} onClick={() => m.mutate()}>
            {mode === "paste" ? `Add ${lines.length} item(s)` : "Import file"}</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product"><Select value={productId} onChange={setProductId} placeholder="Choose product"
              options={products.filter((p) => p.stock_mode === "inventory").map((p) => ({ value: String(p.product_id), label: `${p.emoji ?? ""} ${p.display_name}` }))} /></Field>
            <Field label="Variant"><Select value={variantId} onChange={setVariantId} placeholder="Choose variant"
              options={(product?.variants ?? []).map((v) => ({ value: String(v.id), label: tr(v.name), hint: v.available !== null ? `${v.available} in stock` : undefined }))} /></Field>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented value={mode} onChange={setMode} options={[{ value: "paste", label: "Paste" }, { value: "file", label: "Upload TXT / CSV" }]} />
            <Select size="sm" className="w-44" value={kind} onChange={setKind} options={[
              { value: "code", label: "Activation codes" }, { value: "license_key", label: "License keys" }, { value: "credentials", label: "Account credentials" },
              { value: "link", label: "Links" }, { value: "text", label: "Text" }, { value: "custom", label: "Custom data" }]} />
          </div>
          {mode === "paste" ? (
            <Field label="Items" help="One item per line. For multi-line items (e.g. login + password + notes) separate items with a line containing only ---">
              <Textarea rows={9} className="font-mono" value={text} onChange={(e) => setText(e.target.value)} placeholder={"AAAA-BBBB-CCCC-DDDD\nEEEE-FFFF-GGGG-HHHH"} />
            </Field>
          ) : (
            <Field label="File" help="TXT: one item per line (or blocks separated by ---). CSV: uses the “content” column (or the first column). Max 20 MB.">
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-[12px] border border-dashed border-border-strong bg-surface-2/40 p-6 text-[13px] text-fg-3 hover:border-accent/50">
                <FileUp className="size-5" />{file ? <span className="text-fg">{file.name}</span> : "Choose a .txt or .csv file"}
                <input type="file" hidden accept=".txt,.csv,text/plain,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            </Field>
          )}
          {report ? (
            <div className="rounded-[10px] border border-border bg-surface-2/50 p-3 text-[13px]">
              <div className="flex flex-wrap gap-2"><Badge tone="success">{report.added} added</Badge><Badge>{report.duplicates} duplicates skipped</Badge>{report.invalid ? <Badge tone="danger">{report.invalid} invalid</Badge> : null}</div>
              {report.errors?.length ? <ul className="mt-2 max-h-32 list-disc overflow-y-auto pl-5 text-[12px] text-fg-3">{report.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
