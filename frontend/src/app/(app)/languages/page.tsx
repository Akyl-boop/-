"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe2, Languages as LangIcon, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { toast } from "sonner";
import { useLanguages } from "@/components/shared/i18n-field";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/input";
import { Badge, Card, CardBody, CardHeader, Skeleton, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { useSaveSettings, useSettings } from "@/features/settings";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Language } from "@/lib/types";
import { number } from "@/lib/utils";

export default function LanguagesPage() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const langs = useLanguages();
  const s = useSettings();
  const loc = s.data?.localization as { default_language: string; fallback_language: string; auto_detect: boolean } | undefined;
  const [locForm, setLocForm] = React.useState(loc);
  React.useEffect(() => setLocForm(loc), [loc]);
  const saveLoc = useSaveSettings("localization");
  const [add, setAdd] = React.useState<Language | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ["languages"] });
  const upsert = useMutation({ mutationFn: (l: Language & { isNew?: boolean }) => l.isNew ? api.post("/languages", l) : api.put(`/languages/${l.code}`, l), onSuccess: () => { toast.success("Language saved"); setAdd(null); inv(); } });
  const del = useMutation({ mutationFn: (code: string) => api.del(`/languages/${code}`), onSuccess: inv });
  const editable = can("languages.manage");
  return (
    <div>
      <PageHeader title="Languages" description="Your bot speaks every enabled language. Customers get their Telegram language automatically and can switch any time."
        actions={editable ? <Button variant="primary" onClick={() => setAdd({ code: "", name: "", native_name: "", flag: "🏳️", enabled: true, sort_order: (langs.data?.length ?? 0) })}><Plus />Add language</Button> : null} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid gap-3 sm:grid-cols-2">
          {langs.isLoading ? <Skeleton className="h-40" /> : (langs.data ?? []).map((l) => (
            <Card key={l.code} className="p-4">
              <div className="flex items-start gap-3">
                <span className="text-[28px] leading-none">{l.flag}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold">{l.native_name}{loc?.default_language === l.code ? <Badge tone="accent">Default</Badge> : null}</div>
                  <div className="text-[12.5px] text-fg-3">{l.name} · <span className="font-mono uppercase">{l.code}</span> · {number(l.customers)} customers</div>
                </div>
                {editable ? <Switch checked={l.enabled} onCheckedChange={(v) => upsert.mutate({ ...l, enabled: v })} /> : null}
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[12px]"><span className="text-fg-3">Bot texts translated</span><span className="tabular">{l.translated}/{l.total} · {l.coverage}%</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent" style={{ width: `${l.coverage}%` }} /></div>
              </div>
              <div className="mt-3 flex gap-1.5">
                <Link href={`/bot-editor?tab=texts`}><Button size="sm"><LangIcon />Translate</Button></Link>
                {editable && !["en"].includes(l.code) && loc?.default_language !== l.code ? (
                  <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" className="ml-auto" onClick={async () => { if ((await confirm({ title: `Delete ${l.name}?`, description: "Its translations are removed. Customers using it fall back to the default language.", danger: true, confirmLabel: "Delete" })).ok) del.mutate(l.code); }}><Trash2 /></Button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
        <Card className="h-fit">
          <CardHeader title="Localization" />
          {locForm ? (
            <CardBody className="space-y-4">
              <Field label="Default language" help="For new customers whose Telegram language isn't available."><Select value={locForm.default_language} onChange={(v) => setLocForm({ ...locForm, default_language: v })} options={(langs.data ?? []).filter((l) => l.enabled).map((l) => ({ value: l.code, label: `${l.flag} ${l.native_name}` }))} /></Field>
              <Field label="Fallback language" help="Used when a text has no translation in the customer's language."><Select value={locForm.fallback_language} onChange={(v) => setLocForm({ ...locForm, fallback_language: v })} options={(langs.data ?? []).map((l) => ({ value: l.code, label: `${l.flag} ${l.native_name}` }))} /></Field>
              <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={locForm.auto_detect} onCheckedChange={(v) => setLocForm({ ...locForm, auto_detect: v })} />Detect language from Telegram on first launch</label>
              <Button variant="primary" disabled={!can("settings.edit")} loading={saveLoc.isPending} onClick={() => saveLoc.mutate(locForm)}><Save />Save</Button>
            </CardBody>
          ) : <CardBody><Skeleton className="h-32" /></CardBody>}
        </Card>
      </div>
      {add ? (
        <Dialog open onOpenChange={(o) => !o && setAdd(null)}>
          <DialogContent size="sm" title="Add language" description="Then translate the bot texts in the Bot Editor and product names in the product editor."
            footer={<><Button variant="ghost" onClick={() => setAdd(null)}>Cancel</Button><Button variant="primary" loading={upsert.isPending} disabled={!add.code || !add.name} onClick={() => upsert.mutate({ ...add, isNew: true } as Language & { isNew: boolean })}><Globe2 />Add</Button></>}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code (ISO 639-1)"><Input value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value.toLowerCase() })} placeholder="de" /></Field>
              <Field label="Flag"><Input value={add.flag} onChange={(e) => setAdd({ ...add, flag: e.target.value })} /></Field>
              <Field label="Name (English)"><Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} placeholder="German" /></Field>
              <Field label="Native name"><Input value={add.native_name} onChange={(e) => setAdd({ ...add, native_name: e.target.value })} placeholder="Deutsch" /></Field>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
