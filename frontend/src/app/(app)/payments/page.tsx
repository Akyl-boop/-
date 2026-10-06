"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, CircleAlert, CircleCheck, CreditCard, KeyRound, Plus, RefreshCw, Search, Settings2, Trash2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { EmojiPicker } from "@/components/shared/emoji-picker";
import { I18nInput } from "@/components/shared/i18n-field";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Dialog, DialogContent, SheetContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Badge, Card, CopyButton, EmptyState, Skeleton, Switch, Tabs, TabsContent, TabsList, TabsTrigger, Tooltip } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useUrlState } from "@/hooks/use-url-state";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Paged, Payment } from "@/lib/types";
import { date, money, number, timeAgo, tr, type I18n, type Num } from "@/lib/utils";

interface ProviderField { key: string; label: string; type: string; secret: boolean; required: boolean; default?: unknown; help?: string; options?: { value: string; label: string }[] }
interface Provider { code: string; title: string; description: string; supports_webhook: boolean; supports_polling: boolean; supports_refund: boolean; fields: ProviderField[] }
interface Method {
  id: number; code: string; provider: string; name: I18n; description: I18n; emoji?: string | null; custom_emoji_id?: string | null; enabled: boolean;
  sort_order: number; public_config: Record<string, unknown>; min_amount?: Num; max_amount?: Num; fee_percent: Num;
  secrets: Record<string, { set: boolean; masked: string }>; last_health_ok?: boolean | null; last_health_at?: string | null;
  last_health_error?: string | null; paid_count: number; missing: string[]; webhook_url?: string | null;
}

export default function PaymentsPage() {
  const [f, setF] = useUrlState({ tab: "transactions", status: "", method: "", q: "", page: "1" });
  return (
    <div>
      <PageHeader title="Payments" description="Transactions, payment methods and provider configuration. Secrets are encrypted and never shown in full." />
      <Tabs value={f.tab} onValueChange={(v) => setF({ tab: v })}>
        <TabsList className="mb-4">
          <TabsTrigger value="transactions"><CreditCard />Transactions</TabsTrigger>
          <TabsTrigger value="methods"><Settings2 />Payment methods</TabsTrigger>
          <TabsTrigger value="pool"><Wallet />Address pool</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions"><Transactions f={f} setF={setF} /></TabsContent>
        <TabsContent value="methods"><Methods /></TabsContent>
        <TabsContent value="pool"><AddressPool /></TabsContent>
      </Tabs>
    </div>
  );
}

function Transactions({ f, setF }: { f: Record<string, string>; setF: (p: Record<string, string>) => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const [q, setQ] = React.useState(f.q);
  const dq = useDebounce(q);
  React.useEffect(() => { if (dq !== f.q) setF({ q: dq }); }, [dq]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useQuery({ queryKey: ["payments", f], placeholderData: (p) => p, queryFn: () => api.get<Paged<Payment>>("/payments", { status: f.status, method: f.method, q: f.q, page: f.page, page_size: 25 }) });
  const recheck = useMutation({ mutationFn: (id: string) => api.post<Payment>(`/payments/${id}/check`), onSuccess: (p) => { toast.success(`Status: ${p.status}`); qc.invalidateQueries({ queryKey: ["payments"] }); } });
  const columns: Column<Payment>[] = [
    { key: "ref", header: "Reference", cell: (p) => <span className="font-mono text-[12.5px]">{p.reference}</span> },
    { key: "order", header: "Order", cell: (p) => <span className="font-mono text-[12.5px] text-fg-2">{p.order_number}</span> },
    { key: "cust", header: "Customer", hide: "lg", cell: (p) => <span className="text-fg-2">{p.customer?.display_name}</span> },
    { key: "method", header: "Method", hide: "md", cell: (p) => p.method_code },
    { key: "amount", header: "Amount", align: "right", cell: (p) => (
      <div><div className="font-medium">{money(p.amount, p.currency)}</div>{p.pay_amount ? <div className="text-[11.5px] text-fg-3">{String(p.pay_amount)} {p.pay_currency}</div> : null}</div>
    ) },
    { key: "tx", header: "Transaction", hide: "xl", cell: (p) => p.tx_hash ? <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-fg-2">{p.tx_hash.slice(0, 10)}…<CopyButton value={p.tx_hash} className="size-5" /></span> : <span className="text-fg-3">—</span> },
    { key: "status", header: "Status", cell: (p) => <StatusBadge status={p.status} /> },
    { key: "date", header: "Created", hide: "md", cell: (p) => <span className="text-fg-3" title={date(p.created_at)}>{timeAgo(p.created_at)}</span> },
    { key: "a", header: "", cell: (p) => ["pending", "awaiting_confirmation"].includes(p.status) && ["crypto_direct", "cryptobot"].includes(p.provider) ? (
      <Tooltip content="Check with provider now"><Button size="icon-sm" variant="ghost" aria-label="Recheck" onClick={(e) => { e.stopPropagation(); recheck.mutate(p.id); }}><RefreshCw /></Button></Tooltip>
    ) : null },
  ];
  return (<>
    <div className="mb-3 flex flex-wrap gap-2">
      <Input icon={<Search />} placeholder="Reference, tx hash, address, order #…" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-80" />
      <Select className="w-48" value={f.status} onChange={(v) => setF({ status: v })} allowEmpty="All statuses"
        options={["pending", "awaiting_confirmation", "paid", "expired", "cancelled", "failed", "refunded", "partially_refunded"].map((s) => ({ value: s, label: s.replace(/_/g, " ") }))} />
    </div>
    <DataTable rows={list.data?.items} loading={list.isLoading} columns={columns} getId={(p) => p.id} onRowClick={(p) => router.push(`/orders/${p.order_id}`)}
      page={Number(f.page)} pages={list.data?.pages} total={list.data?.total} onPage={(p) => setF({ page: String(p) })}
      empty={<EmptyState icon={<CreditCard />} title="No payments" description="Payments appear when customers choose a payment method at checkout." />} />
  </>);
}

function HealthDot({ m }: { m: Method }) {
  if (m.missing.length) return <Badge tone="warning"><CircleAlert className="size-3" />Not configured</Badge>;
  if (m.last_health_ok === false) return <Tooltip content={m.last_health_error ?? ""}><Badge tone="danger"><CircleAlert className="size-3" />Unhealthy</Badge></Tooltip>;
  if (m.last_health_ok) return <Badge tone="success"><CircleCheck className="size-3" />Healthy</Badge>;
  return <Badge>Not tested</Badge>;
}

function Methods() {
  const qc = useQueryClient();
  const { can } = useSession();
  const confirm = useConfirm();
  const methods = useQuery({ queryKey: ["payment-methods"], queryFn: () => api.get<Method[]>("/payment-methods") });
  const providers = useQuery({ queryKey: ["payment-providers"], queryFn: () => api.get<Provider[]>("/payment-providers") });
  const [editing, setEditing] = React.useState<Method | null>(null);
  const [creating, setCreating] = React.useState(false);
  const inv = () => qc.invalidateQueries({ queryKey: ["payment-methods"] });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => api.post(`/payment-methods/${id}/toggle`, { enabled }), onSuccess: inv });
  const test = useMutation({ mutationFn: (id: number) => api.post<{ ok: boolean; message: string }>(`/payment-methods/${id}/test`), onSuccess: (r) => { (r.ok ? toast.success : toast.error)(r.message); inv(); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/payment-methods/${id}`), onSuccess: () => { toast.success("Deleted"); inv(); } });
  const pmap = Object.fromEntries((providers.data ?? []).map((p) => [p.code, p]));
  const editable = can("payments.edit");

  return (<>
    <div className="mb-3 flex justify-end">{editable ? <Button variant="primary" onClick={() => setCreating(true)}><Plus />Add method</Button> : null}</div>
    {methods.isLoading ? <div className="grid gap-3 md:grid-cols-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-36" />)}</div> : (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {(methods.data ?? []).map((m) => (
          <Card key={m.id} className="flex flex-col p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-[11px] border border-border bg-surface-2 text-[19px]">{m.emoji ?? "💳"}</div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{tr(m.name)}</div>
                <div className="truncate text-[12px] text-fg-3">{pmap[m.provider]?.title ?? m.provider} · <span className="font-mono">{m.code}</span></div>
              </div>
              <Switch checked={m.enabled} disabled={!editable} onCheckedChange={(v) => toggle.mutate({ id: m.id, enabled: v })} />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <HealthDot m={m} />
              {Number(m.fee_percent) ? <Badge>+{String(m.fee_percent)}% fee</Badge> : null}
              {m.public_config.network ? <Badge tone="info">{String(m.public_config.network)}</Badge> : null}
              <Badge>{number(m.paid_count)} paid</Badge>
            </div>
            {m.missing.length ? <p className="mt-2 text-[12px] text-warning">Missing: {m.missing.join(", ")}</p> : null}
            {m.webhook_url ? (
              <div className="mt-2 flex items-center gap-1 rounded-[8px] bg-surface-2 px-2 py-1 font-mono text-[11px] text-fg-3"><span className="truncate">{m.webhook_url}</span><CopyButton value={m.webhook_url} className="size-5" /></div>
            ) : null}
            <div className="mt-auto flex gap-1.5 pt-3">
              {editable ? <Button size="sm" onClick={() => setEditing(m)}><Settings2 />Configure</Button> : null}
              {editable ? <Button size="sm" variant="ghost" loading={test.isPending && test.variables === m.id} onClick={() => test.mutate(m.id)}><Activity />Test</Button> : null}
              {editable && !m.paid_count ? <Button size="icon-sm" variant="danger-ghost" className="ml-auto" aria-label="Delete" onClick={async () => { if ((await confirm({ title: `Delete ${tr(m.name)}?`, danger: true, confirmLabel: "Delete" })).ok) del.mutate(m.id); }}><Trash2 /></Button> : null}
            </div>
          </Card>
        ))}
      </div>
    )}
    {editing ? <MethodSheet method={editing} provider={pmap[editing.provider]} onClose={() => setEditing(null)} onSaved={inv} /> : null}
    {creating ? <CreateMethod providers={providers.data ?? []} onClose={() => setCreating(false)} onCreated={(m) => { inv(); setCreating(false); setEditing(m); }} /> : null}
  </>);
}

function ConfigInput({ field, value, onChange, secret }: { field: ProviderField; value: unknown; onChange: (v: unknown) => void; secret?: { set: boolean; masked: string } }) {
  if (field.type === "boolean") return <Switch checked={!!value} onCheckedChange={onChange} />;
  if (field.type === "select") return <Select value={String(value ?? field.default ?? "")} onChange={onChange} options={field.options ?? []} />;
  if (field.type === "i18n") return <I18nInput multiline rows={4} value={(value as I18n) ?? {}} onChange={onChange} />;
  if (field.type === "textarea") return <Textarea value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  if (field.secret) return <Input type="password" icon={<KeyRound />} autoComplete="off" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} placeholder={secret?.set ? `${secret.masked} — leave empty to keep` : "Not set"} />;
  return <Input type={field.type === "number" ? "number" : "text"} step="any" value={value === undefined || value === null ? "" : String(value)} placeholder={field.default !== undefined ? String(field.default) : ""}
    onChange={(e) => onChange(field.type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)} />;
}

function MethodSheet({ method, provider, onClose, onSaved }: { method: Method; provider?: Provider; onClose: () => void; onSaved: () => void }) {
  const [m, setM] = React.useState(method);
  const [pub, setPub] = React.useState<Record<string, unknown>>({ ...method.public_config });
  const [secrets, setSecrets] = React.useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => api.put(`/payment-methods/${m.id}`, {
      code: m.code, provider: m.provider, name: m.name, description: m.description, emoji: m.emoji, custom_emoji_id: m.custom_emoji_id,
      enabled: m.enabled, sort_order: m.sort_order, public_config: pub, min_amount: m.min_amount || null, max_amount: m.max_amount || null,
      fee_percent: Number(m.fee_percent || 0), secrets: Object.fromEntries(Object.entries(secrets).filter(([, v]) => v !== "")),
    }),
    onSuccess: () => { toast.success("Payment method saved"); onSaved(); onClose(); },
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={`Configure ${tr(m.name)}`} description={provider?.description} width={560}
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        <div className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-[auto_1fr]">
            <Field label="Icon"><EmojiPicker value={m.emoji} onChange={(v) => setM({ ...m, emoji: v })} customEmojiId={m.custom_emoji_id} onCustomEmojiChange={(v) => setM({ ...m, custom_emoji_id: v })} /></Field>
            <Field label="Name shown to customers"><I18nInput value={m.name} onChange={(v) => setM({ ...m, name: v })} /></Field>
          </div>
          <div className="space-y-4 rounded-[12px] border border-border p-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-fg-3">{provider?.title} settings</div>
            {(provider?.fields ?? []).map((field) => (
              <Field key={field.key} label={field.label} required={field.required} help={field.help}>
                <ConfigInput field={field} secret={m.secrets[field.key]}
                  value={field.secret ? secrets[field.key] : pub[field.key] ?? field.default}
                  onChange={(v) => field.secret ? setSecrets({ ...secrets, [field.key]: String(v ?? "") }) : setPub({ ...pub, [field.key]: v })} />
              </Field>
            ))}
            {!provider?.fields.length ? <p className="text-[13px] text-fg-3">No configuration required.</p> : null}
            {provider?.fields.some((f) => f.secret) ? <p className="flex items-center gap-1.5 text-[12px] text-fg-3"><KeyRound className="size-3.5" />Secrets are encrypted (Fernet) and never returned to the browser.</p> : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Min amount"><Input type="number" value={m.min_amount === null || m.min_amount === undefined ? "" : String(m.min_amount)} onChange={(e) => setM({ ...m, min_amount: e.target.value })} /></Field>
            <Field label="Max amount"><Input type="number" value={m.max_amount === null || m.max_amount === undefined ? "" : String(m.max_amount)} onChange={(e) => setM({ ...m, max_amount: e.target.value })} /></Field>
            <Field label="Fee %"><Input type="number" step="0.1" value={String(m.fee_percent ?? 0)} onChange={(e) => setM({ ...m, fee_percent: e.target.value })} /></Field>
          </div>
          <Field label="Sort order"><Input type="number" className="w-28" value={String(m.sort_order)} onChange={(e) => setM({ ...m, sort_order: Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={m.enabled} onCheckedChange={(v) => setM({ ...m, enabled: v })} />Enabled at checkout</label>
        </div>
      </SheetContent>
    </Dialog>
  );
}

function CreateMethod({ providers, onClose, onCreated }: { providers: Provider[]; onClose: () => void; onCreated: (m: Method) => void }) {
  const [provider, setProvider] = React.useState("");
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const m = useMutation({ mutationFn: () => api.post<Method>("/payment-methods", { provider, name: { en: name }, code: code || undefined, enabled: false, public_config: {} }), onSuccess: onCreated });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title="Add payment method" description="Choose a provider. You can add several methods per provider (e.g. USDT TRC20 and LTC)."
        footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!provider || !name} loading={m.isPending} onClick={() => m.mutate()}>Create & configure</Button></>}>
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {providers.map((p) => (
              <button key={p.code} type="button" onClick={() => { setProvider(p.code); if (!name) setName(p.title); }}
                className={`rounded-[11px] border p-3 text-left transition-colors hover:border-border-strong ${provider === p.code ? "border-accent bg-accent/[0.06]" : "border-border"}`}>
                <div className="text-[13px] font-medium">{p.title}</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] text-fg-3">{p.description}</div>
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Display name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Code" help="Unique, used in reports"><Input className="font-mono" value={code} onChange={(e) => setCode(e.target.value)} placeholder="auto" /></Field>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddressPool() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const list = useQuery({ queryKey: ["crypto-addresses"], queryFn: () => api.get<{ id: number; network: string; address: string; label?: string; enabled: boolean; in_use: boolean; assigned_until?: string }[]>("/crypto-addresses") });
  const [network, setNetwork] = React.useState("TRC20");
  const [text, setText] = React.useState("");
  const add = useMutation({ mutationFn: () => api.post<{ added: number }>("/crypto-addresses", { network, addresses: text.split(/\s+/).filter(Boolean) }), onSuccess: (r) => { toast.success(`${r.added} address(es) added`); setText(""); qc.invalidateQueries({ queryKey: ["crypto-addresses"] }); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/crypto-addresses/${id}`), onSuccess: () => qc.invalidateQueries({ queryKey: ["crypto-addresses"] }) });
  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card className="h-fit space-y-3 p-4">
        <div className="text-[13.5px] font-semibold">Add receiving addresses</div>
        <p className="text-[12.5px] text-fg-3">For methods using “Address pool” mode, each pending payment gets its own address from this pool, making matching unambiguous. Use addresses from your own wallet — private keys never leave your wallet.</p>
        <Field label="Network"><Select value={network} onChange={setNetwork} options={["TRC20", "BEP20", "LTC", "TON"].map((n) => ({ value: n, label: n }))} /></Field>
        <Field label="Addresses" help="One per line"><Textarea rows={6} className="font-mono" value={text} onChange={(e) => setText(e.target.value)} /></Field>
        <Button variant="primary" disabled={!text.trim() || !can("payments.edit")} loading={add.isPending} onClick={() => add.mutate()}><Plus />Add to pool</Button>
      </Card>
      <DataTable rows={list.data} loading={list.isLoading} getId={(a) => a.id} empty={<EmptyState icon={<Wallet />} title="Pool is empty" description="Shared-wallet mode with unique amounts works without a pool." />} columns={[
        { key: "n", header: "Network", cell: (a) => <Badge tone="info">{a.network}</Badge> },
        { key: "a", header: "Address", cell: (a) => <span className="inline-flex items-center gap-1 font-mono text-[12px]">{a.address}<CopyButton value={a.address} className="size-5" /></span> },
        { key: "u", header: "State", cell: (a) => a.in_use ? <Badge tone="warning">In use until {date(a.assigned_until)}</Badge> : <Badge tone="success">Free</Badge> },
        { key: "x", header: "", cell: (a) => !a.in_use && can("payments.edit") ? <Button size="icon-sm" variant="danger-ghost" aria-label="Remove" onClick={async () => { if ((await confirm({ title: "Remove address from pool?", danger: true, confirmLabel: "Remove" })).ok) del.mutate(a.id); }}><Trash2 /></Button> : null },
      ]} />
    </div>
  );
}
