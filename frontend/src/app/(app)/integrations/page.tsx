"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Code2, KeyRound, Plus, RefreshCw, Save, Send, Trash2, Webhook } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { StatusBadge } from "@/components/shared/status";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card, CardBody, CardHeader, Checkbox, CopyButton, EmptyState, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { useSettings } from "@/features/settings";
import { api } from "@/lib/api";
import type { Paged } from "@/lib/types";
import { timeAgo } from "@/lib/utils";

interface Endpoint { id: number; name: string; url: string; events: string[]; enabled: boolean; last_status?: number; last_delivery_at?: string; secret?: string }
interface Delivery { id: string; event: string; status: string; attempts: number; response_code?: number; error?: string; created_at: string }

const SECRET_LABELS: Record<string, [string, string]> = {
  trongrid_api_key: ["TronGrid API key", "USDT TRC20 monitoring (recommended to avoid rate limits)"],
  etherscan_api_key: ["Etherscan V2 API key", "Required for USDT BEP20 (BNB Smart Chain)"],
  blockcypher_token: ["BlockCypher token", "Litecoin monitoring (optional)"],
  toncenter_api_key: ["Toncenter API key", "TON monitoring (optional)"],
  coingecko_api_key: ["CoinGecko API key", "Exchange rates (optional demo key)"],
};

export default function IntegrationsPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const s = useSettings();
  const masked = s.data?.integration_secrets ?? {};
  const [secrets, setSecrets] = React.useState<Record<string, string>>({});
  const saveSecrets = useMutation({ mutationFn: () => api.put("/settings-secrets/integration_secrets", secrets), onSuccess: () => { toast.success("API keys saved (encrypted)"); setSecrets({}); qc.invalidateQueries({ queryKey: ["settings"] }); } });
  const eps = useQuery({ queryKey: ["webhooks"], queryFn: () => api.get<{ events: string[]; endpoints: Endpoint[] }>("/integrations/webhooks") });
  const [edit, setEdit] = React.useState<Endpoint | null>(null);
  const [revealed, setRevealed] = React.useState<{ url: string; secret: string } | null>(null);
  const [logsFor, setLogsFor] = React.useState<Endpoint | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ["webhooks"] });
  const save = useMutation({
    mutationFn: (e: Endpoint) => e.id ? api.put<Endpoint>(`/integrations/webhooks/${e.id}`, e) : api.post<Endpoint>("/integrations/webhooks", e),
    onSuccess: (r) => { inv(); setEdit(null); if (r.secret) setRevealed({ url: r.url, secret: r.secret }); toast.success("Endpoint saved"); },
  });
  const rotate = useMutation({ mutationFn: (id: number) => api.post<Endpoint>(`/integrations/webhooks/${id}/rotate-secret`), onSuccess: (r) => setRevealed({ url: r.url, secret: r.secret! }) });
  const test = useMutation({ mutationFn: (id: number) => api.post<{ status: string; response_code?: number; error?: string }>(`/integrations/webhooks/${id}/test`), onSuccess: (r) => { (r.status === "success" ? toast.success : toast.error)(r.status === "success" ? `Delivered (HTTP ${r.response_code})` : `Failed: ${r.error ?? r.response_code}`); inv(); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/integrations/webhooks/${id}`), onSuccess: inv });
  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div>
      <PageHeader title="Integrations" description="Connect external systems: outgoing webhooks, blockchain APIs and custom fulfillment." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Outgoing webhooks" description="We POST signed JSON events to your endpoints, retrying with exponential backoff."
              action={<Button size="sm" variant="primary" onClick={() => setEdit({ id: 0, name: "", url: "https://", events: [], enabled: true })}><Plus />Add endpoint</Button>} />
            <div className="divide-y divide-border border-t border-border">
              {!eps.data?.endpoints.length ? <EmptyState icon={<Webhook />} title="No endpoints" description="Get notified about orders, payments and tickets in your own systems." /> : eps.data.endpoints.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium">{e.name}{!e.enabled ? <Badge>Disabled</Badge> : null}{e.last_status ? <Badge tone={e.last_status < 300 ? "success" : "danger"}>HTTP {e.last_status}</Badge> : null}</div>
                    <div className="truncate font-mono text-[12px] text-fg-3">{e.url}</div>
                    <div className="mt-1 text-[12px] text-fg-3">{e.events.length ? e.events.join(", ") : "All events"}{e.last_delivery_at ? ` · last ${timeAgo(e.last_delivery_at)}` : ""}</div>
                  </div>
                  <Button size="sm" loading={test.isPending && test.variables === e.id} onClick={() => test.mutate(e.id)}><Send />Test</Button>
                  <Button size="sm" variant="ghost" onClick={() => setLogsFor(e)}>Deliveries</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEdit(e)}>Edit</Button>
                  <Button size="icon-sm" variant="ghost" aria-label="Rotate secret" onClick={async () => { if ((await confirm({ title: "Rotate signing secret?", description: "The old secret stops working immediately.", confirmLabel: "Rotate" })).ok) rotate.mutate(e.id); }}><RefreshCw /></Button>
                  <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: "Delete endpoint?", danger: true, confirmLabel: "Delete" })).ok) del.mutate(e.id); }}><Trash2 /></Button>
                </div>
              ))}
            </div>
          </Card>
          <Card>
            <CardHeader title="Custom fulfillment API" description="Use “API” or “Webhook” delivery on a product to get goods from your own system." />
            <CardBody className="space-y-3 text-[13px] text-fg-2">
              <p><b className="text-fg">API delivery:</b> on payment we POST <code className="font-mono text-[12px]">{"{order, order_id, order_item_id, sku, product, variant, quantity, customer_telegram_id, callback_url}"}</code> to your URL with header <code className="font-mono text-[12px]">X-Nexa-Signature: HMAC-SHA256(body, secret)</code>. Respond <code className="font-mono text-[12px]">{"{\"items\": [\"code1\", …]}"}</code>.</p>
              <p><b className="text-fg">Webhook delivery:</b> we send the same payload and wait. Deliver later by POSTing <code className="font-mono text-[12px]">{"{\"items\": [...]}"}</code> to the <code className="font-mono text-[12px]">callback_url</code>, signed the same way.</p>
              <div className="flex items-center gap-2 rounded-[9px] bg-surface-2 px-3 py-2 font-mono text-[12px]"><Code2 className="size-4 text-fg-3" />{origin}/api/integrations/fulfillment/&lt;order_item_id&gt;<CopyButton value={`${origin}/api/integrations/fulfillment/`} /></div>
              <p className="text-fg-3">Outgoing webhook signature: <code className="font-mono text-[12px]">X-Nexa-Signature: sha256=HMAC(secret, timestamp + "." + body)</code> with <code className="font-mono text-[12px]">X-Nexa-Timestamp</code>.</p>
            </CardBody>
          </Card>
        </div>
        <Card className="h-fit">
          <CardHeader title="Blockchain & rate APIs" description="Keys are encrypted at rest and shown masked." />
          <CardBody className="space-y-3">
            {Object.entries(SECRET_LABELS).map(([k, [label, help]]) => (
              <Field key={k} label={label} help={help}>
                <Input type="password" icon={<KeyRound />} autoComplete="off" value={secrets[k] ?? ""} placeholder={masked[k] ? `${masked[k]} (set)` : "Not set"} onChange={(e) => setSecrets({ ...secrets, [k]: e.target.value })} />
              </Field>
            ))}
            <Button variant="primary" disabled={!Object.values(secrets).some(Boolean)} loading={saveSecrets.isPending} onClick={() => saveSecrets.mutate()}><Save />Save keys</Button>
          </CardBody>
        </Card>
      </div>

      {edit ? (
        <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent title={edit.id ? "Edit endpoint" : "Add endpoint"} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(edit)}>Save</Button></>}>
            <div className="space-y-4">
              <Field label="Name"><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="ERP sync" /></Field>
              <Field label="URL"><Input value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value })} /></Field>
              <Field label="Events" help="None selected = all events">
                <div className="grid gap-2 sm:grid-cols-2">{(eps.data?.events ?? []).map((ev) => (
                  <label key={ev} className="flex items-center gap-2 font-mono text-[12.5px]"><Checkbox checked={edit.events.includes(ev)} onCheckedChange={(v) => setEdit({ ...edit, events: v ? [...edit.events, ev] : edit.events.filter((x) => x !== ev) })} />{ev}</label>
                ))}</div>
              </Field>
              <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={edit.enabled} onCheckedChange={(v) => setEdit({ ...edit, enabled: v })} />Enabled</label>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      <Dialog open={!!revealed} onOpenChange={(o) => !o && setRevealed(null)}>
        <DialogContent title="Signing secret" description="Copy it now — it won't be shown again.">
          <div className="flex items-center gap-2 rounded-[9px] border border-border bg-surface-2 px-3 py-2 font-mono text-[12.5px]"><span className="break-all">{revealed?.secret}</span><CopyButton value={revealed?.secret ?? ""} /></div>
        </DialogContent>
      </Dialog>
      {logsFor ? <Deliveries endpoint={logsFor} onClose={() => setLogsFor(null)} /> : null}
    </div>
  );
}

function Deliveries({ endpoint, onClose }: { endpoint: Endpoint; onClose: () => void }) {
  const q = useQuery({ queryKey: ["webhook-deliveries", endpoint.id], queryFn: () => api.get<Paged<Delivery>>(`/integrations/webhooks/${endpoint.id}/deliveries`, { page_size: 50 }) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="lg" title={`Deliveries · ${endpoint.name}`}>
        {!q.data?.items.length ? <EmptyState title="No deliveries yet" /> : (
          <div className="divide-y divide-border rounded-[12px] border border-border">
            {q.data.items.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
                <span className="font-mono">{d.event}</span><StatusBadge status={d.status} /><span className="text-fg-3">{d.attempts} attempt(s)</span>
                <span className="flex-1 truncate text-fg-3">{d.response_code ? `HTTP ${d.response_code}` : ""} {d.error ?? ""}</span><span className="text-fg-3">{timeAgo(d.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
