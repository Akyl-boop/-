"use client";

import * as React from "react";
import { Save } from "lucide-react";
import { TgEditor } from "@/components/shared/tg-editor";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, CardBody, CardHeader, Skeleton, Switch } from "@/components/ui/misc";
import { useSaveSettings, useSettings } from "@/features/settings";

export function AppearanceTab() {
  const s = useSettings();
  const cfg = s.data?.bot as Record<string, unknown> | undefined;
  const [f, setF] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => { if (cfg) setF(cfg); }, [cfg]);
  const save = useSaveSettings("bot");
  if (!cfg) return <Skeleton className="h-96" />;
  const toggle = (k: string, label: string, help?: string) => (
    <label className="flex items-start justify-between gap-4 py-3">
      <div><div className="text-[13px] font-medium">{label}</div>{help ? <div className="mt-0.5 text-[12px] text-fg-3">{help}</div> : null}</div>
      <Switch checked={!!f[k]} onCheckedChange={(v) => setF({ ...f, [k]: v })} />
    </label>
  );
  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Layout" />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Products per page"><Input type="number" min={1} max={20} value={String(f.products_per_page ?? 6)} onChange={(e) => setF({ ...f, products_per_page: Number(e.target.value) })} /></Field>
          <Field label="Categories per row"><Input type="number" min={1} max={4} value={String(f.categories_per_row ?? 2)} onChange={(e) => setF({ ...f, categories_per_row: Number(e.target.value) })} /></Field>
          <Field label="Products per row"><Input type="number" min={1} max={3} value={String(f.products_per_row ?? 1)} onChange={(e) => setF({ ...f, products_per_row: Number(e.target.value) })} /></Field>
          <Field label="“Only N left” below" className="sm:col-span-3"><Input type="number" min={0} className="w-32" value={String(f.low_stock_display_threshold ?? 5)} onChange={(e) => setF({ ...f, low_stock_display_threshold: Number(e.target.value) })} /></Field>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Behaviour" />
        <CardBody className="divide-y divide-border">
          {toggle("show_stock_count", "Show exact stock count", "Otherwise only “In stock / Out of stock”.")}
          {toggle("delete_user_inputs", "Keep the chat clean", "Delete commands and typed inputs (search, promo codes) after handling them.")}
          {toggle("protect_delivered_content", "Protect delivered goods", "Prevents forwarding/saving of delivery messages (Telegram protect_content).")}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Custom emoji & button styles" description="Use only features your bot is allowed to use — Telegram silently falls back otherwise." />
        <CardBody className="divide-y divide-border">
          {toggle("custom_emoji_in_messages", "Custom emoji in messages", "Telegram allows this for bots with a Fragment username or whose owner has Telegram Premium (rules change, so test it). Send an animated emoji to the bot from your linked admin account to test: it replies with the ID and whether Telegram accepts it. When off, <tg-emoji> is replaced with its fallback emoji.")}
          {toggle("custom_emoji_on_buttons", "Custom emoji icons on buttons", "Bot API 9.4+: icon_custom_emoji_id on inline buttons. Needs a Fragment username, or Telegram Premium on the account that owns the bot (private/group chats).")}
          {toggle("button_styles", "Colored buttons", "Bot API 9.4+: primary / success / danger button styles.")}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Announcement" description="Shown at the bottom of the home screen. Leave empty to hide." />
        <CardBody><TgEditor rows={4} value={String(f.announcement ?? "")} onChange={(v) => setF({ ...f, announcement: v })} /></CardBody>
      </Card>
      <div className="lg:col-span-2"><Button variant="primary" loading={save.isPending} onClick={() => save.mutate(f)}><Save />Save appearance</Button></div>
    </div>
  );
}
