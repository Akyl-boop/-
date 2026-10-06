"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { useLanguages } from "@/components/shared/i18n-field";
import { MediaPicker } from "@/components/shared/media-picker";
import { Button } from "@/components/ui/button";
import { Card, Segmented, Skeleton, Switch } from "@/components/ui/misc";
import { api } from "@/lib/api";
import type { MediaItem } from "@/lib/types";

interface Banner { id: number; placement: string; language: string | null; enabled: boolean; media: MediaItem | null }

const LABELS: Record<string, [string, string]> = {
  home: ["Home", "Welcome screen"], categories: ["Categories", "Catalog & category screens without their own image"],
  products: ["Products", "Product pages without their own image"], promotions: ["Promotions", "Promo code & referral screens"],
  checkout: ["Checkout", "Cart and payment method selection"], success: ["Successful payment", "Completed order screen"],
  profile: ["Profile", "Customer profile"], support: ["Support", "Support & FAQ"], maintenance: ["Maintenance", "Shown while maintenance mode is on"],
};

export function BannersTab() {
  const qc = useQueryClient();
  const langs = useLanguages().data ?? [];
  const [lang, setLang] = React.useState<string>("all");
  const q = useQuery({ queryKey: ["banners"], queryFn: () => api.get<{ placements: string[]; banners: Banner[] }>("/banners") });
  const inv = () => qc.invalidateQueries({ queryKey: ["banners"] });
  const set = useMutation({ mutationFn: (b: { placement: string; media_id: string; enabled: boolean }) => api.put("/banners", { ...b, language: lang === "all" ? null : lang }), onSuccess: () => { toast.success("Banner updated"); inv(); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/banners/${id}`), onSuccess: inv });
  if (q.isLoading) return <Skeleton className="h-96" />;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={lang} onChange={setLang} options={[{ value: "all", label: "All languages" }, ...langs.map((l) => ({ value: l.code, label: `${l.flag} ${l.code.toUpperCase()}` }))]} />
        <p className="text-[12.5px] text-fg-3">Language-specific banners override the “All languages” banner for customers using that language.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(q.data?.placements ?? []).map((p) => {
          const b = q.data?.banners.find((x) => x.placement === p && (x.language ?? "all") === lang);
          const fallback = lang !== "all" ? q.data?.banners.find((x) => x.placement === p && x.language === null) : undefined;
          return (
            <Card key={p} className="overflow-hidden p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <div><div className="text-[13.5px] font-semibold">{LABELS[p]?.[0] ?? p}</div><div className="text-[12px] text-fg-3">{LABELS[p]?.[1]}</div></div>
                {b ? (
                  <div className="flex items-center gap-1">
                    <Switch checked={b.enabled} onCheckedChange={(v) => set.mutate({ placement: p, media_id: b.media!.id, enabled: v })} />
                    <Button size="icon-sm" variant="danger-ghost" aria-label="Remove banner" onClick={() => del.mutate(b.id)}><Trash2 /></Button>
                  </div>
                ) : null}
              </div>
              <MediaPicker value={b?.media?.id ?? null} onChange={(id) => id ? set.mutate({ placement: p, media_id: id, enabled: true }) : b && del.mutate(b.id)} />
              {!b && fallback ? <p className="mt-2 text-[11.5px] text-fg-3">Using the “All languages” banner.</p> : null}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
