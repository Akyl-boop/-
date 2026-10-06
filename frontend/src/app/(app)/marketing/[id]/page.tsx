"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, FlaskConical, Plus, Rocket, Save, Square, Trash2, Users } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import * as React from "react";
import { toast } from "sonner";
import { LangTabs, useLanguages } from "@/components/shared/i18n-field";
import { MediaPicker, mediaUrl } from "@/components/shared/media-picker";
import { StatusBadge } from "@/components/shared/status";
import { TelegramPreview } from "@/components/shared/telegram-preview";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card, CardBody, CardHeader, Checkbox, Skeleton, Switch } from "@/components/ui/misc";
import { Select } from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce";
import { useAdminEvent } from "@/hooks/use-events";
import { api } from "@/lib/api";
import type { Paged, Product, Tag } from "@/lib/types";
import { date, number, tr, type I18n } from "@/lib/utils";

interface Btn { label: I18n; action: string; value: string; emoji?: string }
interface Audience { type: string; languages?: string[]; tag_ids?: number[]; product_ids?: number[]; registered_from?: string; registered_to?: string; min_spent?: string; max_spent?: string }
interface Broadcast {
  id?: number; name: string; status?: string; text: I18n; media_id?: string | null; buttons: Btn[]; audience: Audience; disable_notification: boolean;
  protect_content: boolean; total_count?: number; sent_count?: number; failed_count?: number; blocked_count?: number; scheduled_at?: string | null;
  started_at?: string | null; finished_at?: string | null; recipient_stats?: Record<string, number>; audience_size?: number;
}

const AUDIENCES = [
  { value: "all", label: "Everyone" }, { value: "customers", label: "Customers (bought at least once)" }, { value: "non_customers", label: "Non-customers" },
  { value: "product_buyers", label: "Buyers of specific products" }, { value: "vip", label: "VIP tag" }, { value: "tag", label: "Customers with tags" },
];

export default function BroadcastEditor() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === "new";
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ["broadcast", id], enabled: !isNew, queryFn: () => api.get<Broadcast>(`/broadcasts/${id}`) });
  const [b, setB] = React.useState<Broadcast>({ name: "", text: { en: "" }, buttons: [], audience: { type: "all" }, disable_notification: false, protect_content: false });
  const [lang, setLang] = React.useState("en");
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [when, setWhen] = React.useState("");
  React.useEffect(() => { if (q.data) setB(q.data); }, [q.data]);
  const langs = useLanguages().data ?? [];
  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.get<Tag[]>("/tags") });
  const products = useQuery({ queryKey: ["products", "all-min"], queryFn: () => api.get<Paged<Product>>("/products", { page_size: 200 }) });
  const audienceKey = useDebounce(JSON.stringify(b.audience), 400);
  const count = useQuery({ queryKey: ["audience", audienceKey], queryFn: () => api.post<{ count: number }>("/broadcasts/audience-count", JSON.parse(audienceKey)) });
  const recipients = useQuery({ queryKey: ["broadcast", id, "recipients"], enabled: !isNew && !!b.status && b.status !== "draft", queryFn: () => api.get<Paged<{ id: number; status: string; error?: string; sent_at?: string; customer: { id: number; display_name: string } }>>(`/broadcasts/${id}/recipients`, { page_size: 50, status: "failed" }) });
  useAdminEvent(React.useCallback((e) => { if (e.type === "broadcast.progress" && String(e.data.id) === id) qc.invalidateQueries({ queryKey: ["broadcast", id] }); }, [id, qc]));

  const editable = isNew || b.status === "draft" || b.status === "scheduled";
  const payload = () => ({ name: b.name || "Untitled campaign", text: b.text, media_id: b.media_id || null, buttons: b.buttons, audience: b.audience, disable_notification: b.disable_notification, protect_content: b.protect_content });
  const save = useMutation({
    mutationFn: () => isNew ? api.post<Broadcast>("/broadcasts", payload()) : api.put<Broadcast>(`/broadcasts/${id}`, payload()),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["broadcasts"] }); toast.success("Draft saved"); if (isNew) router.replace(`/marketing/${r.id}`); else qc.invalidateQueries({ queryKey: ["broadcast", id] }); },
  });
  const ensureSaved = async (): Promise<number> => {
    const r = isNew ? await api.post<Broadcast>("/broadcasts", payload()) : await api.put<Broadcast>(`/broadcasts/${id}`, payload());
    return r.id!;
  };
  const test = useMutation({ mutationFn: async () => { const bid = await ensureSaved(); await api.post(`/broadcasts/${bid}/test`); return bid; }, onSuccess: (bid) => { toast.success("Test message sent to your Telegram"); if (isNew) router.replace(`/marketing/${bid}`); } });
  const send = useMutation({
    mutationFn: async (scheduled_at: string | null) => { const bid = await ensureSaved(); await api.post(`/broadcasts/${bid}/send`, { scheduled_at }); return bid; },
    onSuccess: (bid) => { qc.invalidateQueries({ queryKey: ["broadcasts"] }); qc.invalidateQueries({ queryKey: ["broadcast", String(bid)] }); toast.success("Broadcast queued"); if (isNew) router.replace(`/marketing/${bid}`); setScheduleOpen(false); },
  });
  const cancel = useMutation({ mutationFn: () => api.post(`/broadcasts/${id}/cancel`), onSuccess: () => qc.invalidateQueries({ queryKey: ["broadcast", id] }) });
  const del = useMutation({ mutationFn: () => api.del(`/broadcasts/${id}`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["broadcasts"] }); router.replace("/marketing"); } });

  const aud = b.audience;
  const setAud = (patch: Partial<Audience>) => setB({ ...b, audience: { ...aud, ...patch } });
  if (!isNew && !q.data) return <Skeleton className="h-[600px]" />;

  return (
    <div>
      <Link href="/marketing" className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-fg-3 hover:text-fg"><ArrowLeft className="size-3.5" />Marketing</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5"><h1 className="text-[22px] font-semibold tracking-[-0.02em]">{b.name || "New broadcast"}</h1>{b.status ? <StatusBadge status={b.status} /> : null}</div>
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-fg-3"><Users className="size-3.5" />{count.isFetching ? "Counting…" : `${number(count.data?.count ?? 0)} recipients match this audience`}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (<>
            <Button onClick={() => save.mutate()} loading={save.isPending}><Save />Save draft</Button>
            <Button onClick={() => test.mutate()} loading={test.isPending}><FlaskConical />Send test</Button>
            <Button onClick={() => setScheduleOpen(true)}><CalendarClock />Schedule</Button>
            <Button variant="primary" loading={send.isPending} onClick={async () => {
              const r = await confirm({ title: `Send to ${number(count.data?.count ?? 0)} customers now?`, description: "Messages go out immediately, respecting Telegram rate limits. This can't be undone, but you can stop it midway.", confirmLabel: "Send now" });
              if (r.ok) send.mutate(null);
            }}><Rocket />Send now</Button>
          </>) : b.status === "sending" ? <Button variant="danger" onClick={() => cancel.mutate()}><Square />Stop sending</Button> : null}
          {!isNew && b.status !== "sending" ? <Button size="icon" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: "Delete this broadcast?", danger: true, confirmLabel: "Delete" })).ok) del.mutate(); }}><Trash2 /></Button> : null}
        </div>
      </div>

      {b.total_count ? (
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Recipients", b.total_count], ["Sent", b.sent_count], ["Failed", (b.failed_count ?? 0) - (b.blocked_count ?? 0)], ["Blocked the bot", b.blocked_count]].map(([l, v]) => (
            <div key={String(l)} className="card p-4"><div className="text-[12px] text-fg-3">{l}</div><div className="mt-1 text-[20px] font-semibold tabular">{number(Number(v ?? 0))}</div></div>
          ))}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <fieldset disabled={!editable} className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="Message" action={<LangTabs value={lang} onChange={setLang} filled={(c) => !!b.text[c]?.trim()} />} />
            <CardBody className="space-y-4">
              <Field label="Campaign name (internal)"><Input value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} placeholder="e.g. Black Friday −20%" /></Field>
              <Field label={`Text · ${lang.toUpperCase()}`} help="Customers receive their language; missing translations fall back to the default language.">
                <TgEditor rows={8} value={b.text[lang] ?? ""} onChange={(v) => setB({ ...b, text: { ...b.text, [lang]: v } })} variables={[]} />
              </Field>
              <Field label="Media (optional)" help="Image, GIF or video. Captions longer than 1024 characters are sent as a separate message."><MediaPicker value={b.media_id} onChange={(v) => setB({ ...b, media_id: v })} className="max-w-sm" /></Field>
              <div>
                <div className="mb-2 flex items-center justify-between"><span className="text-[12.5px] font-medium text-fg-2">Buttons</span>
                  {b.buttons.length < 6 ? <Button size="sm" variant="ghost" onClick={() => setB({ ...b, buttons: [...b.buttons, { label: { en: "" }, action: "catalog", value: "" }] })}><Plus />Add button</Button> : null}</div>
                <div className="space-y-2">
                  {b.buttons.map((btn, i) => (
                    <div key={i} className="grid gap-2 sm:grid-cols-[1fr_150px_1fr_auto]">
                      <Input placeholder={`Label (${lang})`} value={btn.label[lang] ?? ""} onChange={(e) => setB({ ...b, buttons: b.buttons.map((x, j) => j === i ? { ...x, label: { ...x.label, [lang]: e.target.value } } : x) })} />
                      <Select value={btn.action} onChange={(v) => setB({ ...b, buttons: b.buttons.map((x, j) => j === i ? { ...x, action: v } : x) })}
                        options={[{ value: "catalog", label: "Open catalog" }, { value: "product", label: "Open product" }, { value: "category", label: "Open category" }, { value: "cart", label: "Open cart" }, { value: "url", label: "External URL" }]} />
                      {btn.action === "product" ? (
                        <Select value={btn.value} onChange={(v) => setB({ ...b, buttons: b.buttons.map((x, j) => j === i ? { ...x, value: v } : x) })} options={(products.data?.items ?? []).map((p) => ({ value: String(p.id), label: `${p.emoji ?? ""} ${p.display_name}` }))} />
                      ) : btn.action === "url" || btn.action === "category" ? (
                        <Input placeholder={btn.action === "url" ? "https://…" : "Category ID"} value={btn.value} onChange={(e) => setB({ ...b, buttons: b.buttons.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                      ) : <div />}
                      <Button size="icon" variant="danger-ghost" aria-label="Remove button" onClick={() => setB({ ...b, buttons: b.buttons.filter((_, j) => j !== i) })}><Trash2 /></Button>
                    </div>
                  ))}
                </div>
              </div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Audience" description="Banned customers and those who blocked the bot are always excluded." />
            <CardBody className="space-y-4">
              <Field label="Send to"><Select value={aud.type} onChange={(v) => setAud({ type: v })} options={AUDIENCES} /></Field>
              {aud.type === "tag" ? (
                <Field label="Tags"><div className="flex flex-wrap gap-3">{(tags.data ?? []).map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-[13px]"><Checkbox checked={(aud.tag_ids ?? []).includes(t.id)} onCheckedChange={(v) => setAud({ tag_ids: v ? [...(aud.tag_ids ?? []), t.id] : (aud.tag_ids ?? []).filter((x) => x !== t.id) })} />{t.name}</label>
                ))}</div></Field>
              ) : null}
              {aud.type === "product_buyers" ? (
                <Field label="Products"><div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-[10px] border border-border p-2 sm:grid-cols-2">{(products.data?.items ?? []).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px]"><Checkbox checked={(aud.product_ids ?? []).includes(p.id)} onCheckedChange={(v) => setAud({ product_ids: v ? [...(aud.product_ids ?? []), p.id] : (aud.product_ids ?? []).filter((x) => x !== p.id) })} />{p.emoji} {p.display_name}</label>
                ))}</div></Field>
              ) : null}
              <Field label="Languages" help="Leave empty for all languages"><div className="flex flex-wrap gap-3">{langs.map((l) => (
                <label key={l.code} className="flex items-center gap-2 text-[13px]"><Checkbox checked={(aud.languages ?? []).includes(l.code)} onCheckedChange={(v) => setAud({ languages: v ? [...(aud.languages ?? []), l.code] : (aud.languages ?? []).filter((x) => x !== l.code) })} />{l.flag} {l.native_name}</label>
              ))}</div></Field>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="Registered from"><Input type="date" value={aud.registered_from ?? ""} onChange={(e) => setAud({ registered_from: e.target.value || undefined })} /></Field>
                <Field label="Registered to"><Input type="date" value={aud.registered_to ?? ""} onChange={(e) => setAud({ registered_to: e.target.value || undefined })} /></Field>
                <Field label="Spent at least"><Input type="number" value={aud.min_spent ?? ""} onChange={(e) => setAud({ min_spent: e.target.value || undefined })} /></Field>
                <Field label="Spent at most"><Input type="number" value={aud.max_spent ?? ""} onChange={(e) => setAud({ max_spent: e.target.value || undefined })} /></Field>
              </div>
              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={b.disable_notification} onCheckedChange={(v) => setB({ ...b, disable_notification: v })} />Send silently</label>
                <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={b.protect_content} onCheckedChange={(v) => setB({ ...b, protect_content: v })} />Protect from forwarding</label>
              </div>
            </CardBody>
          </Card>
          {recipients.data?.items.length ? (
            <Card>
              <CardHeader title="Failed deliveries" />
              <DataTable dense className="rounded-none border-0 border-t" rows={recipients.data.items} getId={(r) => r.id} columns={[
                { key: "c", header: "Customer", cell: (r) => <Link className="hover:underline" href={`/customers/${r.customer.id}`}>{r.customer.display_name}</Link> },
                { key: "s", header: "Status", cell: (r) => <StatusBadge status={r.status} /> },
                { key: "e", header: "Error", cell: (r) => <span className="text-fg-3">{r.error}</span> },
              ]} />
            </Card>
          ) : null}
        </fieldset>
        <div className="xl:sticky xl:top-20 xl:self-start">
          <div className="mb-2 flex items-center justify-between text-[12.5px] font-medium text-fg-2">Preview · {lang.toUpperCase()}{b.scheduled_at && b.status === "scheduled" ? <Badge tone="info">Scheduled {date(b.scheduled_at)}</Badge> : null}</div>
          <TelegramPreview html={b.text[lang] || b.text.en || ""} media={b.media_id ? { url: mediaUrl(b.media_id), kind: "image" } : null}
            keyboard={b.buttons.map((x) => [{ text: `${x.emoji ? `${x.emoji} ` : ""}${tr(x.label, lang) || "Button"}`, url: x.action === "url" }])} />
        </div>
      </div>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent size="sm" title="Schedule broadcast" description="The worker starts sending at this time (your local time)."
          footer={<><Button variant="ghost" onClick={() => setScheduleOpen(false)}>Cancel</Button><Button variant="primary" disabled={!when} loading={send.isPending} onClick={() => send.mutate(new Date(when).toISOString())}>Schedule</Button></>}>
          <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} min={new Date().toISOString().slice(0, 16)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
