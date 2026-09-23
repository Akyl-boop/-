import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { InstructionView } from "~/components/store/instruction-view";
import { ProductCover } from "~/components/store/product-cover";
import { useT } from "~/i18n/react";
import { pickBlocks } from "~/lib/instructions";
import { parseInstructionContent } from "~/lib/instructions-schema";
import { parseLocalized, pickText } from "~/lib/localized";
import { rootData, seo } from "~/lib/seo";
import { getRequestContext } from "~/server/context";
import { queryAll, queryFirst } from "~/server/db.server";
import { notFound } from "~/server/http.server";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/instruction";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const row = await queryFirst<{ id: string; slug: string; title: string; summary: string; content: string; updated_at: number }>(
    env.DB,
    "SELECT id, slug, title, summary, content, updated_at FROM instructions WHERE slug = ? AND is_published = 1",
    params.slug,
  );
  if (!row) notFound();
  const products = await queryAll<{ slug: string; name: string; thumbnail_url: string | null; accent: string }>(
    env.DB,
    "SELECT slug, name, thumbnail_url, accent FROM products WHERE instruction_id = ? AND is_active = 1 ORDER BY sort_priority DESC LIMIT 4",
    row.id,
  );
  return {
    guide: {
      slug: row.slug,
      title: pickText(parseLocalized(row.title), locale),
      summary: pickText(parseLocalized(row.summary), locale),
      blocks: pickBlocks(parseInstructionContent(row.content), locale),
      updatedAt: row.updated_at,
    },
    products: products.map((product) => ({ slug: product.slug, name: pickText(parseLocalized(product.name), locale), thumbnailUrl: product.thumbnail_url, accent: product.accent })),
  };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  const guide = loaderData?.guide;
  return seo(root, {
    title: guide?.title ?? "",
    description: guide?.summary,
    path: `/instructions/${guide?.slug ?? ""}`,
    type: "article",
    jsonLd: guide ? { "@context": "https://schema.org", "@type": "HowTo", name: guide.title, description: guide.summary } : undefined,
  });
};

export default function InstructionPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { guide, products } = loaderData;
  return (
    <div className="page-container pt-8 sm:pt-12">
      <Link to="/instructions" className="inline-flex items-center gap-1.5 text-[13px] text-fg-subtle transition-colors hover:text-fg">
        <ArrowLeft className="size-3.5" />
        {t("instructions.back")}
      </Link>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_300px] lg:gap-12">
        <article className="min-w-0">
          <p className="eyebrow text-accent-strong">{t("instructions.eyebrow")}</p>
          <h1 className="text-gradient mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{guide.title}</h1>
          {guide.summary ? <p className="mt-3 text-[15px] leading-7 text-fg-muted">{guide.summary}</p> : null}
          <div className="surface mt-8 p-6 sm:p-8">
            {guide.blocks.length > 0 ? <InstructionView blocks={guide.blocks} /> : <p className="text-sm text-fg-muted">{t("instructions.emptyGuide")}</p>}
          </div>
        </article>
        {products.length > 0 ? (
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <h2 className="eyebrow">{t("instructions.appliesTo")}</h2>
            <div className="mt-4 space-y-2">
              {products.map((product) => (
                <Link key={product.slug} to={`/product/${product.slug}`} className="group surface surface-hover flex items-center gap-3 p-3">
                  <ProductCover name={product.name} imageUrl={product.thumbnailUrl} accent={product.accent} size="thumb" className="size-10 shrink-0 rounded-lg" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.name}</span>
                  <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
