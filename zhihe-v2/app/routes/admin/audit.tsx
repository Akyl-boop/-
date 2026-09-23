import { ScrollText, Search } from "lucide-react";
import { Form, useSubmit } from "react-router";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { EmptyState } from "~/components/ui/empty-state";
import { Pagination } from "~/components/ui/pagination";
import { useLocale, useT } from "~/i18n/react";
import { formatDateTime } from "~/lib/format";
import { adminContext, likeTerm, pageParams } from "~/server/admin/context.server";
import { queryAll, queryValue } from "~/server/db.server";
import type { Route } from "./+types/audit";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await adminContext(context, request, "owner");
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const { page, pageSize, offset } = pageParams(url, 50);
  const clause = q ? "WHERE lower(action) LIKE ? ESCAPE '\\' OR lower(COALESCE(admin_email, '')) LIKE ? ESCAPE '\\' OR lower(summary) LIKE ? ESCAPE '\\'" : "";
  const params = q ? [likeTerm(q), likeTerm(q), likeTerm(q)] : [];
  const [entries, total] = await Promise.all([
    queryAll<{ id: string; admin_email: string | null; action: string; entity_type: string; entity_id: string | null; summary: string; ip: string | null; created_at: number }>(
      db,
      `SELECT id, admin_email, action, entity_type, entity_id, summary, ip, created_at FROM audit_logs ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    ),
    queryValue<number>(db, `SELECT COUNT(*) FROM audit_logs ${clause}`, ...params),
  ]);
  return { entries, total: total ?? 0, page, pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)), q };
}

export default function Audit({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const submit = useSubmit();
  const { entries, total, page, pageCount, q } = loaderData;
  return (
    <>
      <AdminPageHeader title={t("admin.audit.title")} description={t("admin.audit.description")} />
      <Form method="get" className="mb-4" onChange={(event) => submit(event.currentTarget, { replace: true })}>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input name="q" defaultValue={q} placeholder={t("admin.audit.search")} className="input pl-9" aria-label={t("admin.audit.search")} />
        </div>
      </Form>
      <TableShell footer={<Pagination page={page} pageCount={pageCount} total={total} />}>
        {entries.length === 0 ? (
          <EmptyState icon={ScrollText} title={t("admin.empty.audit.title")} description={t("admin.empty.audit.text")} />
        ) : (
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>{t("admin.audit.col.time")}</th>
                <th>{t("admin.audit.col.admin")}</th>
                <th>{t("admin.audit.col.action")}</th>
                <th>{t("admin.audit.col.details")}</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="text-xs whitespace-nowrap text-fg-subtle">{formatDateTime(entry.created_at, locale)}</td>
                  <td className="text-fg-muted">{entry.admin_email ?? "system"}</td>
                  <td>
                    <code className="rounded-md bg-panel-2 px-1.5 py-0.5 font-mono text-xs">{entry.action}</code>
                  </td>
                  <td className="max-w-[360px] truncate text-fg-muted">{entry.summary || entry.entity_id || "—"}</td>
                  <td className="font-mono text-xs text-fg-subtle">{entry.ip ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableShell>
    </>
  );
}
