import { BookOpen, Pencil, Plus } from "lucide-react";
import { Link } from "react-router";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { Badge } from "~/components/ui/badge";
import { ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { useLocale, useT } from "~/i18n/react";
import { LOCALES } from "~/i18n/config";
import { formatDateTime } from "~/lib/format";
import { parseInstructionContent } from "~/lib/instructions-schema";
import { parseLocalized, pickText } from "~/lib/localized";
import { adminContext } from "~/server/admin/context.server";
import { queryAll } from "~/server/db.server";
import type { Route } from "./+types/instructions";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const rows = await queryAll<{ id: string; slug: string; title: string; content: string; is_published: number; updated_at: number; products: number }>(
    db,
    "SELECT i.id, i.slug, i.title, i.content, i.is_published, i.updated_at, (SELECT COUNT(*) FROM products p WHERE p.instruction_id = i.id) AS products FROM instructions i ORDER BY i.sort_order, i.created_at",
  );
  return {
    items: rows.map((row) => {
      const content = parseInstructionContent(row.content);
      return {
        id: row.id,
        slug: row.slug,
        title: pickText(parseLocalized(row.title), locale),
        published: Boolean(row.is_published),
        updatedAt: row.updated_at,
        products: row.products,
        languages: LOCALES.filter((code) => (content[code]?.length ?? 0) > 0),
      };
    }),
  };
}

export default function Instructions({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <AdminPageHeader
        title={t("admin.instructions.title")}
        description={t("admin.instructions.description")}
        actions={
          <ButtonLink to="/admin/instructions/new" variant="primary">
            <Plus className="size-4" />
            {t("admin.instructions.new")}
          </ButtonLink>
        }
      />
      <TableShell>
        {loaderData.items.length === 0 ? (
          <EmptyState icon={BookOpen} title={t("admin.empty.instructions.title")} description={t("admin.empty.instructions.text")} />
        ) : (
          <ul className="divide-y divide-line">
            {loaderData.items.map((item) => (
              <li key={item.id}>
                <Link to={`/admin/instructions/${item.id}`} className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-white/[0.02]">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-strong bg-panel-3 text-fg-muted">
                    <BookOpen className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {item.title}
                      {!item.published ? <Badge>{t("admin.draft")}</Badge> : null}
                    </p>
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      /instructions/{item.slug} · {t("admin.instructions.usedBy", { count: item.products })} · {formatDateTime(item.updatedAt, locale)}
                    </p>
                  </div>
                  <div className="hidden gap-1 sm:flex">
                    {LOCALES.map((code) => (
                      <span key={code} className={item.languages.includes(code) ? "rounded-md bg-success-soft px-1.5 py-0.5 text-[10px] font-semibold text-success uppercase" : "rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-fg-subtle uppercase"}>
                        {code}
                      </span>
                    ))}
                  </div>
                  <Pencil className="size-4 shrink-0 text-fg-subtle" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </TableShell>
    </>
  );
}
