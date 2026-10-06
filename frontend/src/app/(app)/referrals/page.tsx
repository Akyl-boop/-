"use client";

import { useQuery } from "@tanstack/react-query";
import { Gift, Percent, Save, TrendingUp, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import * as React from "react";
import { BarList } from "@/components/shared/charts";
import { StatCard } from "@/components/shared/stat-card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/input";
import { Avatar, Badge, Card, CardBody, CardHeader, EmptyState, Segmented, Switch } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { useSaveSettings, useSettings } from "@/features/settings";
import { api } from "@/lib/api";
import type { Paged, UserBrief } from "@/lib/types";
import { date, money, number, toNum, type Num } from "@/lib/utils";

interface Overview { referral_links: number; referrers: number; registered: number; converted: number; revenue: Num; rewards: Num; conversion_rate: number; top_referrers: { customer: UserBrief | null; registered: number; converted: number; revenue: Num; rewards: Num }[] }
interface Row { id: number; referrer: UserBrief; referred: UserBrief; converted_at?: string | null; revenue: Num; reward_total: Num; created_at: string }

export default function ReferralsPage() {
  const ov = useQuery({ queryKey: ["referrals", "overview"], queryFn: () => api.get<Overview>("/referrals/overview") });
  const [page, setPage] = React.useState(1);
  const list = useQuery({ queryKey: ["referrals", page], queryFn: () => api.get<Paged<Row>>("/referrals", { page, page_size: 20 }) });
  const s = useSettings();
  const cfg = s.data?.referrals as Record<string, unknown> | undefined;
  const enabled = !!(s.data?.features as Record<string, boolean> | undefined)?.referrals;
  const [form, setForm] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => { if (cfg) setForm(cfg); }, [cfg]);
  const save = useSaveSettings("referrals");
  const saveFeature = useSaveSettings("features");
  const d = ov.data;

  return (
    <div>
      <PageHeader title="Referral program" description="Customers share their link and earn store balance from their friends' purchases."
        actions={<label className="flex items-center gap-2.5 rounded-[9px] border border-border px-3 py-1.5 text-[13px]"><Switch checked={enabled} onCheckedChange={(v) => saveFeature.mutate({ referrals: v })} />Program {enabled ? "enabled" : "disabled"}</label>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Referral links" icon={<Gift />} loading={ov.isLoading} value={d?.referral_links} format={(n) => number(n)} />
        <StatCard label="Registered" icon={<UserPlus />} loading={ov.isLoading} value={d?.registered} format={(n) => number(n)} />
        <StatCard label="Converted" icon={<TrendingUp />} loading={ov.isLoading} value={d?.converted} format={(n) => number(n)} hint={d ? `${d.conversion_rate}% conversion` : undefined} />
        <StatCard label="Revenue from referrals" icon={<Users />} loading={ov.isLoading} value={d ? toNum(d.revenue) : undefined} format={(n) => money(n)} />
        <StatCard label="Rewards paid" icon={<Percent />} loading={ov.isLoading} value={d ? toNum(d.rewards) : undefined} format={(n) => money(n)} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Reward rules" description="Rewards are credited to the referrer's balance when a referred customer pays." />
          <CardBody className="space-y-4">
            <Field label="Reward type"><Segmented value={String(form.reward_type ?? "percent")} onChange={(v) => setForm({ ...form, reward_type: v })} options={[{ value: "percent", label: "% of order" }, { value: "fixed", label: "Fixed amount" }]} /></Field>
            {form.reward_type === "fixed"
              ? <Field label="Reward amount"><Input type="number" step="0.01" value={String(form.reward_amount ?? "")} onChange={(e) => setForm({ ...form, reward_amount: Number(e.target.value) })} /></Field>
              : <Field label="Reward percentage"><Input type="number" step="0.1" value={String(form.reward_percent ?? "")} onChange={(e) => setForm({ ...form, reward_percent: Number(e.target.value) })} suffix="%" /></Field>}
            <Field label="Minimum purchase" help="Orders below this amount don't earn rewards."><Input type="number" step="0.01" value={String(form.min_purchase ?? 0)} onChange={(e) => setForm({ ...form, min_purchase: Number(e.target.value) })} /></Field>
            <Field label="Max rewards per referrer" help="0 = unlimited"><Input type="number" value={String(form.max_rewards_per_referrer ?? 0)} onChange={(e) => setForm({ ...form, max_rewards_per_referrer: Number(e.target.value) })} /></Field>
            <label className="flex items-center gap-2.5 text-[13px]"><Switch checked={!!form.first_order_only} onCheckedChange={(v) => setForm({ ...form, first_order_only: v })} />Reward the first order only</label>
            <Button variant="primary" loading={save.isPending} onClick={() => save.mutate(form)}><Save />Save rules</Button>
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Top referrers" description="By revenue generated" />
          <CardBody>
            <BarList format={(n) => money(n)} color="var(--series-3)" empty="No referrals yet"
              items={(d?.top_referrers ?? []).map((t, i) => ({ key: t.customer?.id ?? i, value: toNum(t.revenue), sub: `${t.converted}/${t.registered} converted · earned ${money(t.rewards)}`,
                label: t.customer ? <Link href={`/customers/${t.customer.id}`} className="hover:underline">{t.customer.display_name}</Link> : "Deleted" }))} />
          </CardBody>
        </Card>
      </div>
      <h2 className="mb-3 mt-6 text-[15px] font-semibold">All referrals</h2>
      <DataTable rows={list.data?.items} loading={list.isLoading} getId={(r) => r.id} page={page} pages={list.data?.pages} total={list.data?.total} onPage={setPage}
        empty={<EmptyState icon={<Gift />} title="No referrals yet" description="Customers find their link in Profile → Invite friends." />} columns={[
          { key: "a", header: "Referrer", cell: (r) => <Link href={`/customers/${r.referrer.id}`} className="flex items-center gap-2 hover:underline"><Avatar name={r.referrer.display_name} size={22} />{r.referrer.display_name}</Link> },
          { key: "b", header: "Invited customer", cell: (r) => <Link href={`/customers/${r.referred.id}`} className="flex items-center gap-2 hover:underline"><Avatar name={r.referred.display_name} size={22} />{r.referred.display_name}</Link> },
          { key: "c", header: "Status", cell: (r) => r.converted_at ? <Badge tone="success" dot>Converted</Badge> : <Badge dot>Registered</Badge> },
          { key: "d", header: "Revenue", align: "right", cell: (r) => money(r.revenue) },
          { key: "e", header: "Reward", align: "right", hide: "md", cell: (r) => money(r.reward_total) },
          { key: "f", header: "Joined", hide: "md", cell: (r) => <span className="text-fg-3">{date(r.created_at, false)}</span> },
        ]} />
    </div>
  );
}
