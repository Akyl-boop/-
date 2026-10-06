"use client";

import { AlertTriangle, Save } from "lucide-react";
import * as React from "react";
import { MediaPicker } from "@/components/shared/media-picker";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Card, CardBody, CardHeader, Skeleton, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useSaveSettings, useSettings } from "@/features/settings";
import { useUrlState } from "@/hooks/use-url-state";
import { applyAccent, useSession } from "@/lib/session";
import { cn } from "@/lib/utils";

type FieldType = "text" | "number" | "bool" | "select" | "list" | "color" | "media" | "channels" | "textarea";
interface Spec { key: string; label: string; type: FieldType; help?: string; options?: { value: string; label: string }[]; placeholder?: string }
interface Section { id: string; group: string; title: string; description: string; fields: Spec[] }

const CURRENCIES = ["USD", "EUR", "GBP", "RUB", "UAH", "KZT", "CNY", "TRY", "INR"].map((c) => ({ value: c, label: c }));
const TIMEZONES = ["UTC", "Europe/London", "Europe/Berlin", "Europe/Moscow", "Europe/Kyiv", "Asia/Almaty", "Asia/Dubai", "Asia/Shanghai", "Asia/Singapore", "America/New_York", "America/Los_Angeles"].map((z) => ({ value: z, label: z }));

const SECTIONS: Section[] = [
  { id: "general", group: "general", title: "General", description: "Store identity and basics", fields: [
    { key: "store_name", label: "Store name", type: "text", help: "Shown to customers in the bot." },
    { key: "dashboard_name", label: "Dashboard name", type: "text" },
    { key: "currency", label: "Store currency", type: "select", options: CURRENCIES, help: "Prices are stored in this currency." },
    { key: "currency_symbol", label: "Currency symbol", type: "text", placeholder: "$" },
    { key: "currency_position", label: "Symbol position", type: "select", options: [{ value: "before", label: "Before amount ($10)" }, { value: "after", label: "After amount (10 $)" }] },
    { key: "timezone", label: "Timezone", type: "select", options: TIMEZONES, help: "Used for analytics days and reports." },
    { key: "order_prefix", label: "Order number prefix", type: "text", help: "e.g. NX → NX-10042" },
    { key: "ticket_prefix", label: "Ticket number prefix", type: "text" },
    { key: "support_username", label: "Support Telegram username", type: "text", placeholder: "@your_support", help: "Shown as “Contact a manager” in the bot." },
    { key: "support_url", label: "Support URL", type: "text", placeholder: "https://…" },
    { key: "terms_page", label: "Terms page slug", type: "text" },
  ] },
  { id: "branding", group: "branding", title: "Branding", description: "Dashboard appearance", fields: [
    { key: "accent", label: "Accent color", type: "color" },
    { key: "default_theme", label: "Default theme", type: "select", options: [{ value: "dark", label: "Dark (recommended)" }, { value: "light", label: "Light" }] },
    { key: "logo_media_id", label: "Logo", type: "media" },
    { key: "favicon_media_id", label: "Favicon", type: "media" },
    { key: "footer_text", label: "Footer text", type: "text" },
  ] },
  { id: "checkout", group: "checkout", title: "Store & checkout", description: "Order limits and payment timing", fields: [
    { key: "min_order_amount", label: "Minimum order amount", type: "number", help: "0 = no minimum" },
    { key: "max_order_amount", label: "Maximum order amount", type: "number", help: "0 = no maximum" },
    { key: "payment_timeout_minutes", label: "Payment window (minutes)", type: "number", help: "Unpaid orders expire and stock is released after this time." },
    { key: "max_cart_items", label: "Max different items in cart", type: "number" },
    { key: "max_open_orders_per_user", label: "Max unpaid orders per customer", type: "number", help: "Older unpaid orders are cancelled automatically." },
    { key: "large_payment_threshold", label: "Large payment alert from", type: "number" },
  ] },
  { id: "features", group: "features", title: "Features", description: "Turn whole features on or off — instantly, without code", fields: [
    { key: "cart", label: "Shopping cart", type: "bool", help: "When off, customers use “Buy now” only." },
    { key: "promo_codes", label: "Promo codes", type: "bool" }, { key: "referrals", label: "Referral program", type: "bool" },
    { key: "support", label: "Support tickets", type: "bool" }, { key: "favorites", label: "Favorites", type: "bool" },
    { key: "reviews", label: "Reviews", type: "bool" }, { key: "balance", label: "Internal balance", type: "bool" },
    { key: "broadcasts", label: "Broadcasts", type: "bool" }, { key: "notifications", label: "Admin notifications", type: "bool" },
    { key: "search", label: "Search", type: "bool" }, { key: "recently_viewed", label: "Recently viewed", type: "bool" },
    { key: "recommendations", label: "Recommendations", type: "bool" }, { key: "restock_alerts", label: "Restock alerts", type: "bool" },
    { key: "required_subscription", label: "Require channel subscription", type: "bool", help: "Configure channels under Subscription." },
  ] },
  { id: "subscription", group: "subscription", title: "Subscription", description: "Channels customers must join before using the bot", fields: [
    { key: "channels", label: "Required channels", type: "channels", help: "The bot must be an administrator in each channel to check membership." },
  ] },
  { id: "maintenance", group: "maintenance", title: "Maintenance", description: "Temporarily close the store", fields: [
    { key: "enabled", label: "Maintenance mode", type: "bool", help: "Customers see the maintenance message (edit it in Bot Editor → maintenance.text)." },
    { key: "bypass_telegram_ids", label: "Telegram IDs that bypass maintenance", type: "list", help: "One per line — admins and testers." },
  ] },
  { id: "security", group: "security", title: "Security", description: "Dashboard access policies", fields: [
    { key: "require_2fa", label: "Require 2FA for all admins", type: "bool", help: "Admins without 2FA can't sign in (owners are exempt so they can't lock themselves out)." },
    { key: "ip_allowlist", label: "IP allowlist", type: "list", help: "Only these IPs can sign in. Leave empty to allow all." },
  ] },
  { id: "backups", group: "backups", title: "Backups", description: "Automatic PostgreSQL backups (pg_dump)", fields: [
    { key: "enabled", label: "Scheduled backups", type: "bool" },
    { key: "interval_hours", label: "Every (hours)", type: "number" },
    { key: "retention_days", label: "Keep for (days)", type: "number" },
  ] },
  { id: "integrations", group: "integrations", title: "Exchange rates", description: "Fiat → crypto conversion", fields: [
    { key: "usdt_rate_fixed", label: "USDT pegged 1:1 to USD", type: "bool" },
    { key: "rates_markup_percent", label: "Rate markup %", type: "number", help: "Added to crypto amounts to cover volatility." },
  ] },
];

export default function SettingsPage() {
  const [f, setF] = useUrlState({ tab: "general" });
  const s = useSettings();
  const { can } = useSession();
  const section = SECTIONS.find((x) => x.id === f.tab) ?? SECTIONS[0];
  return (
    <div>
      <PageHeader title="Settings" description="Everything about your store, editable without touching code. Changes apply to the bot within a second." />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col">
          {SECTIONS.map((x) => (
            <button key={x.id} type="button" onClick={() => setF({ tab: x.id })}
              className={cn("h-8 shrink-0 rounded-[8px] px-2.5 text-left text-[13px] text-fg-2 transition-colors hover:bg-hover hover:text-fg", f.tab === x.id && "bg-active font-medium text-fg")}>
              {x.title}
            </button>
          ))}
        </nav>
        {s.data ? <SectionForm key={section.id} section={section} initial={s.data[section.group] as Record<string, unknown>} canEdit={can("settings.edit") || (section.group === "integrations" && can("integrations.manage"))} /> : <Skeleton className="h-96" />}
      </div>
    </div>
  );
}

function SectionForm({ section, initial, canEdit }: { section: Section; initial: Record<string, unknown>; canEdit: boolean }) {
  const [v, setV] = React.useState<Record<string, unknown>>(initial);
  React.useEffect(() => setV(initial), [initial]);
  const save = useSaveSettings(section.group);
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: string, val: unknown) => setV({ ...v, [k]: val });
  const boolOnly = section.fields.every((x) => x.type === "bool");
  return (
    <Card>
      <CardHeader title={section.title} description={section.description}
        action={<Button variant="primary" disabled={!dirty || !canEdit} loading={save.isPending} onClick={() => save.mutate(v, { onSuccess: () => { if (section.group === "branding") applyAccent(String(v.accent)); } })}><Save />Save</Button>} />
      {section.id === "maintenance" && v.enabled ? (
        <div className="mx-5 mb-3 flex items-center gap-2 rounded-[10px] border border-warning/30 bg-warning-bg px-3 py-2 text-[12.5px] text-warning"><AlertTriangle className="size-4" />Maintenance mode is on — customers can't shop right now.</div>
      ) : null}
      <CardBody className={cn(boolOnly ? "divide-y divide-border" : "grid gap-4 sm:grid-cols-2")}>
        {section.fields.map((fs) => {
          const val = v[fs.key];
          if (fs.type === "bool") {
            return (
              <label key={fs.key} className={cn("flex items-start justify-between gap-4", boolOnly ? "py-3" : "sm:col-span-2")}>
                <div><div className="text-[13px] font-medium">{fs.label}</div>{fs.help ? <div className="mt-0.5 text-[12px] text-fg-3">{fs.help}</div> : null}</div>
                <Switch checked={!!val} disabled={!canEdit} onCheckedChange={(x) => set(fs.key, x)} />
              </label>
            );
          }
          return (
            <Field key={fs.key} label={fs.label} help={fs.help} className={cn((fs.type === "list" || fs.type === "channels" || fs.type === "textarea") && "sm:col-span-2")}>
              {fs.type === "select" ? <Select disabled={!canEdit} value={String(val ?? "")} onChange={(x) => set(fs.key, x)} options={fs.options ?? []} />
                : fs.type === "number" ? <Input disabled={!canEdit} type="number" step="any" value={val === null || val === undefined ? "" : String(val)} onChange={(e) => set(fs.key, e.target.value === "" ? 0 : Number(e.target.value))} />
                : fs.type === "color" ? (
                  <div className="flex items-center gap-2">
                    <input type="color" disabled={!canEdit} value={String(val ?? "#7c5cff")} onChange={(e) => { set(fs.key, e.target.value); applyAccent(e.target.value); }} className="h-8 w-12 cursor-pointer rounded-[8px] border border-border bg-transparent" />
                    <Input disabled={!canEdit} className="w-32 font-mono" value={String(val ?? "")} onChange={(e) => set(fs.key, e.target.value)} />
                    <div className="flex gap-1">{["#7c5cff", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6"].map((c) => <button key={c} type="button" aria-label={c} onClick={() => { set(fs.key, c); applyAccent(c); }} className="size-6 rounded-full border border-border" style={{ background: c }} />)}</div>
                  </div>
                )
                : fs.type === "media" ? <MediaPicker value={(val as string) ?? null} onChange={(x) => set(fs.key, x)} aspect="aspect-[3/1]" className="max-w-xs" />
                : fs.type === "list" ? <Textarea disabled={!canEdit} rows={4} className="font-mono" value={((val as unknown[]) ?? []).join("\n")} onChange={(e) => set(fs.key, e.target.value.split(/\n|,/).map((x) => x.trim()).filter(Boolean))} />
                : fs.type === "channels" ? <ChannelsEditor value={(val as { chat_id: string; title: string; url: string }[]) ?? []} onChange={(x) => set(fs.key, x)} />
                : fs.type === "textarea" ? <TgEditor value={String(val ?? "")} onChange={(x) => set(fs.key, x)} rows={3} />
                : <Input disabled={!canEdit} value={String(val ?? "")} placeholder={fs.placeholder} onChange={(e) => set(fs.key, e.target.value)} />}
            </Field>
          );
        })}
      </CardBody>
    </Card>
  );
}

function ChannelsEditor({ value, onChange }: { value: { chat_id: string; title: string; url: string }[]; onChange: (v: { chat_id: string; title: string; url: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((c, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr_auto]">
          <Input placeholder="@channel or -100…" value={c.chat_id} onChange={(e) => onChange(value.map((x, j) => j === i ? { ...x, chat_id: e.target.value } : x))} />
          <Input placeholder="Title" value={c.title} onChange={(e) => onChange(value.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} />
          <Input placeholder="https://t.me/…" value={c.url} onChange={(e) => onChange(value.map((x, j) => j === i ? { ...x, url: e.target.value } : x))} />
          <Button variant="danger-ghost" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      <Button size="sm" onClick={() => onChange([...value, { chat_id: "", title: "", url: "" }])}>Add channel</Button>
    </div>
  );
}
