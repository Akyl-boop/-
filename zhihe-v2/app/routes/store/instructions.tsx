import { ArrowUpRight, BookOpen } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "~/components/store/section-heading";
import { EmptyState } from "~/components/ui/empty-state";
import { useT } from "~/i18n/react";
import { parseLocalized, pickText } from "~/lib/localized";
import { metaT, rootData, seo } from "~/lib/seo";
import { getRequestContext } from "~/server/context";
import { queryAll } from "~/server/db.server";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/instructions";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const rows = await queryAll<{ id: string; slug: string; title: string; summary: string; products: string | null }>(
    env.DB,
    `SELECT i.id, i.slug, i.title, i.summary,
       (SELECT json_group_array(p.name) FROM products p WHERE p.instruction_id = i.id AND p.is_active = 1) AS products
     FROM instructions i WHERE i.is_published = 1 ORDER BY i.sort_order, i.created_at`,
  );
  return {
    guides: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: pickText(parseLocalized(row.title), locale),
      summary: pickText(parseLocalized(row.summary), locale),
      products: (JSON.parse(row.products ?? "[]") as string[]).map((name) => pickText(parseLocalized(name), locale)).filter(Boolean),
    })),
  };
}

export const meta: Route.MetaFunction = ({ matches }) => {
  const root = rootData(matches);
  return seo(root, { title: metaT(root, "instructions.title"), description: metaT(root, "instructions.description"), path: "/instructions" });
};

export default function Instructions({ loaderData }: Route.ComponentProps) {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t("instructions.eyebrow")} title={t("instructions.title")} description={t("instructions.description")} />
      <div className="page-container">
        {loaderData.guides.length === 0 ? (
          <div className="surface">
            <EmptyState icon={BookOpen} title={t("instructions.empty.title")} description={t("instructions.empty.text")} />
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {loaderData.guides.map((guide) => (
              <Link key={guide.id} to={`/instructions/${guide.slug}`} prefetch="intent" className="group surface surface-hover flex flex-col p-6">
                <div className="flex items-start justify-between gap-4">
                  <span className="grid size-10 place-items-center rounded-xl border border-line-strong bg-panel-3 text-fg-muted transition-colors group-hover:border-accent/40 group-hover:text-accent-strong">
                    <BookOpen className="size-[18px]" />
                  </span>
                  <ArrowUpRight className="size-4 text-fg-subtle transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-fg" />
                </div>
                <h2 className="mt-5 text-[17px] font-semibold">{guide.title}</h2>
                {guide.summary ? <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-fg-muted">{guide.summary}</p> : null}
                {guide.products.length > 0 ? (
                  <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
                    {guide.products.slice(0, 3).map((name) => (
                      <span key={name} className="rounded-md border border-line bg-panel-2 px-2 py-0.5 text-[11px] text-fg-subtle">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
