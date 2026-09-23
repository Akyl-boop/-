import { PackageSearch, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Form, Link, useNavigation, useSubmit } from "react-router";
import { CategoryIcon } from "~/components/store/category-icon";
import { ProductCard, ProductCardSkeleton } from "~/components/store/product-card";
import { PageHeader } from "~/components/store/section-heading";
import { EmptyState } from "~/components/ui/empty-state";
import { useT } from "~/i18n/react";
import { cn } from "~/lib/format";
import { metaT, rootData, seo } from "~/lib/seo";
import { listCategories, listProducts, type ProductSort } from "~/server/catalog.server";
import { getRequestContext } from "~/server/context";
import { notFound } from "~/server/http.server";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/catalog";

const SORTS: ProductSort[] = ["featured", "price_asc", "price_desc", "newest", "name"];

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const sortParam = url.searchParams.get("sort") as ProductSort | null;
  const sort = sortParam && SORTS.includes(sortParam) ? sortParam : "featured";
  const categories = await listCategories(env.DB, locale);
  const active = params.category ? categories.find((category) => category.slug === params.category) : null;
  if (params.category && !active) notFound();
  const products = await listProducts(env.DB, locale, { categorySlug: active?.slug, search: q || null, sort });
  return { categories, active, products, q, sort };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  const active = loaderData?.active;
  return seo(root, {
    title: active ? active.name : metaT(root, "catalog.title"),
    description: active?.description || metaT(root, "catalog.description"),
    path: active ? `/catalog/${active.slug}` : "/catalog",
  });
};

export default function Catalog({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { categories, active, products, q, sort } = loaderData;
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const [query, setQuery] = useState(q);
  const loading = navigation.state === "loading" && navigation.location.pathname.startsWith("/catalog");

  useEffect(() => setQuery(q), [q]);
  useEffect(() => {
    if (query === q) return;
    const timer = window.setTimeout(() => {
      if (formRef.current) submit(formRef.current, { replace: true, preventScrollReset: true });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, q, submit]);

  const chip = (isActive: boolean) =>
    cn(
      "inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
      isActive ? "border-accent/40 bg-accent-soft text-fg" : "border-line bg-panel-2/50 text-fg-muted hover:border-line-strong hover:text-fg",
    );

  return (
    <>
      <PageHeader eyebrow={t("catalog.eyebrow")} title={active?.name ?? t("catalog.title")} description={active?.description || t("catalog.description")} />

      <div className="page-container">
        <div className="flex flex-col gap-4 border-b border-line pb-6 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label={t("catalog.categories")} className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:flex-wrap sm:px-0">
            <Link to={{ pathname: "/catalog", search: q ? `?q=${encodeURIComponent(q)}` : "" }} className={chip(!active)} preventScrollReset>
              {t("catalog.all")}
            </Link>
            {categories.map((category) => (
              <Link
                key={category.id}
                to={{ pathname: `/catalog/${category.slug}`, search: q ? `?q=${encodeURIComponent(q)}` : "" }}
                className={chip(active?.id === category.id)}
                preventScrollReset
              >
                <CategoryIcon name={category.icon} className="size-3.5" />
                {category.name}
              </Link>
            ))}
          </nav>

          <Form ref={formRef} method="get" className="flex gap-2" role="search">
            <div className="relative flex-1 lg:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
              <input
                name="q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("catalog.search")}
                aria-label={t("catalog.search")}
                className="input pr-9 pl-9"
                autoComplete="off"
              />
              {query ? (
                <button type="button" onClick={() => setQuery("")} className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-fg-subtle hover:text-fg" aria-label={t("common.clear")}>
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <select
              name="sort"
              defaultValue={sort}
              key={sort}
              aria-label={t("catalog.sort")}
              className="input w-auto"
              onChange={(event) => submit(event.currentTarget.form, { replace: true, preventScrollReset: true })}
            >
              {SORTS.map((option) => (
                <option key={option} value={option}>
                  {t(`catalog.sort.${option}`)}
                </option>
              ))}
            </select>
          </Form>
        </div>

        <div className="flex items-center justify-between py-5 text-[13px] text-fg-subtle">
          <span>{t("catalog.count", { count: products.length })}</span>
        </div>

        {loading && products.length === 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <ProductCardSkeleton key={index} />
            ))}
          </div>
        ) : products.length === 0 ? (
          <div className="surface">
            <EmptyState
              icon={PackageSearch}
              title={t("catalog.empty.title")}
              description={q ? t("catalog.empty.search", { q }) : t("catalog.empty.text")}
              action={
                <Link to="/catalog" className="btn btn-secondary">
                  {t("catalog.reset")}
                </Link>
              }
            />
          </div>
        ) : (
          <div className={cn("grid gap-4 transition-opacity duration-200 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4", loading && "opacity-50")}>
            {products.map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index < 4} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
