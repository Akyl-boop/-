import { Pencil, Percent, Plus } from "lucide-react";
import { Link } from "react-router";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { Badge } from "~/components/ui/badge";
import { ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { useLocale, useT } from "~/i18n/react";
import { formatDate } from "~/lib/format";
import { formatMoney } from "~/lib/money";
import { adminContext } from "~/server/admin/context.server";
import { queryAll } from "~/server/db.server";
import type { PromoRow } from "~/server/pricing.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/discounts";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await adminContext(context, request);
  const settings = await getSettings(db);
  const promos = await queryAll<PromoRow & { used: number; discounted: number }>(
    db,
    `SELECT pc.*, (SELECT COUNT(*) FROM promo_redemptions r WHERE r.promo_id = pc.id AND r.status = 'redeemed') AS used,
       (SELECT COALESCE(SUM(amount), 0) FROM promo_redemptions r WHERE r.promo_id = pc.id AND r.status = 'redeemed') AS discounted
     FROM promo_codes pc ORDER BY pc.created_at DESC`,
  );
  return { promos, currency: settings.general.currency, now: Date.now() };
}

export default function Discounts({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { promos, currency, now } = loaderData;
  const state = (promo: (typeof promos)[number]) => {
    if (!promo.is_active) return { tone: "neutral" as const, label: t("admin.discounts.state.disabled") };
    if (promo.expires_at && promo.expires_at <= now) return { tone: "danger" as const, label: t("admin.discounts.state.expired") };
    if (promo.starts_at && promo.starts_at > now) return { tone: "info" as const, label: t("admin.discounts.state.scheduled") };
    if (promo.max_uses !== null && promo.used >= promo.max_uses) return { tone: "warning" as const, label: t("admin.discounts.state.exhausted") };
    return { tone: "success" as const, label: t("admin.discounts.state.active") };
  };
  return (
    <>
      <AdminPageHeader
        title={t("admin.discounts.title")}
        description={t("admin.discounts.description")}
        actions={
          <ButtonLink to="/admin/discounts/new" variant="primary">
            <Plus className="size-4" />
            {t("admin.discounts.new")}
          </ButtonLink>
        }
      />
      <TableShell>
        {promos.length === 0 ? (
          <EmptyState icon={Percent} title={t("admin.empty.discounts.title")} description={t("admin.empty.discounts.text")} />
        ) : (
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>{t("admin.discounts.col.code")}</th>
                <th>{t("admin.discounts.col.value")}</th>
                <th>{t("admin.discounts.col.usage")}</th>
                <th>{t("admin.discounts.col.period")}</th>
                <th>{t("admin.status")}</th>
                <th>
                  <span className="sr-only">{t("admin.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {promos.map((promo) => {
                const current = state(promo);
                return (
                  <tr key={promo.id}>
                    <td>
                      <Link to={`/admin/discounts/${promo.id}`} className="font-mono font-semibold hover:text-accent-strong">
                        {promo.code}
                      </Link>
                      {promo.description ? <p className="max-w-[260px] truncate text-xs text-fg-subtle">{promo.description}</p> : null}
                    </td>
                    <td className="tabular">{promo.type === "percent" ? `${promo.value}%` : formatMoney(promo.value, promo.currency ?? currency, locale)}</td>
                    <td className="tabular">
                      {promo.used}
                      {promo.max_uses !== null ? <span className="text-fg-subtle"> / {promo.max_uses}</span> : null}
                      <p className="text-xs text-fg-subtle">−{formatMoney(promo.discounted, currency, locale)}</p>
                    </td>
                    <td className="text-xs text-fg-subtle">
                      {promo.starts_at ? formatDate(promo.starts_at, locale) : "—"} → {promo.expires_at ? formatDate(promo.expires_at, locale) : "∞"}
                    </td>
                    <td>
                      <Badge tone={current.tone} dot>
                        {current.label}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <ButtonLink to={`/admin/discounts/${promo.id}`} size="sm" variant="ghost" icon aria-label={t("admin.edit")}>
                        <Pencil className="size-3.5" />
                      </ButtonLink>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableShell>
    </>
  );
}
