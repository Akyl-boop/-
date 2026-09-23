import { Copy, Eye, EyeOff, Package, Pencil, Plus, Search, Star } from "lucide-react";
import { Form, Link, redirect, useFetcher, useSubmit } from "react-router";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { ProductCover } from "~/components/store/product-cover";
import { Badge } from "~/components/ui/badge";
import { Button, ButtonLink } from "~/components/ui/button";
import { EmptyState } from "~/components/ui/empty-state";
import { Pagination } from "~/components/ui/pagination";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { formatNumber } from "~/lib/format";
import { parseLocalized, pickText } from "~/lib/localized";
import { formatMoney } from "~/lib/money";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, likeTerm, ok, pageParams } from "~/server/admin/context.server";
import { duplicateProduct } from "~/server/admin/products.server";
import { queryAll, queryValue } from "~/server/db.server";
import type { Route } from "./+types/products";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const category = url.searchParams.get("category") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const { page, pageSize, offset } = pageParams(url, 30);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (q) {
    where.push("(lower(p.name) LIKE ? ESCAPE '\\' OR lower(p.slug) LIKE ? ESCAPE '\\' OR lower(p.tags) LIKE ? ESCAPE '\\')");
    params.push(likeTerm(q), likeTerm(q), likeTerm(q));
  }
  if (category === "none") where.push("p.category_id IS NULL");
  else if (category) {
    where.push("p.category_id = ?");
    params.push(category);
  }
  if (status === "active") where.push("p.is_active = 1");
  if (status === "hidden") where.push("p.is_active = 0");
  if (status === "featured") where.push("p.is_featured = 1");
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows, total, categories] = await Promise.all([
    queryAll<{
      id: string;
      slug: string;
      name: string;
      thumbnail_url: string | null;
      accent: string;
      price: number;
      currency: string;
      is_active: number;
      is_featured: number;
      is_popular: number;
      delivery_type: string;
      stock: number;
      unlimited_stock: number;
      category_name: string | null;
      available: number;
      sold: number;
      variants: number;
    }>(
      db,
      `SELECT p.id, p.slug, p.name, p.thumbnail_url, p.accent, p.price, p.currency, p.is_active, p.is_featured, p.is_popular, p.delivery_type, p.stock, p.unlimited_stock,
         c.name AS category_name,
         (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'available') AS available,
         (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.product_id = p.id AND o.status IN ('paid', 'processing', 'completed')) AS sold,
         (SELECT COUNT(*) FROM product_variants v WHERE v.product_id = p.id AND v.is_active = 1) AS variants
       FROM products p LEFT JOIN categories c ON c.id = p.category_id ${clause}
       ORDER BY p.sort_priority DESC, p.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    ),
    queryValue<number>(db, `SELECT COUNT(*) FROM products p ${clause}`, ...params),
    queryAll<{ id: string; name: string }>(db, "SELECT id, name FROM categories ORDER BY sort_order"),
  ]);
  const text = (raw: string) => pickText(parseLocalized(raw), locale);
  return {
    products: rows.map((row) => ({
      ...row,
      name: text(row.name),
      category_name: row.category_name ? text(row.category_name) : null,
      stockLabel: row.delivery_type === "inventory" ? row.available : row.delivery_type === "static" || row.unlimited_stock ? null : row.stock,
    })),
    total: total ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)),
    categories: categories.map((row) => ({ id: row.id, name: text(row.name) })),
    params: { q, category, status },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = String(form.get("id") ?? "");
  if (intent === "toggle_active") {
    await db.batch([
      db.prepare("UPDATE products SET is_active = 1 - is_active, updated_at = ? WHERE id = ?").bind(Date.now(), id),
      auditStatement(db, request, admin, { action: "product.toggle_active", entityType: "product", entityId: id }),
    ]);
    return ok(t("admin.saved"));
  }
  if (intent === "toggle_featured") {
    await db.prepare("UPDATE products SET is_featured = 1 - is_featured, updated_at = ? WHERE id = ?").bind(Date.now(), id).run();
    return ok(t("admin.saved"));
  }
  if (intent === "duplicate") {
    const copyId = await duplicateProduct(db, id);
    if (!copyId) return fail(t("error.generic"));
    await auditStatement(db, request, admin, { action: "product.duplicate", entityType: "product", entityId: copyId }).run();
    throw redirect(`/admin/products/${copyId}`);
  }
  return fail(t("error.generic"));
}

function RowActions({ product }: { product: { id: string; is_active: number; is_featured: number } }) {
  const t = useT();
  const fetcher = useFetcher<ActionFeedback>();
  useFeedbackToast(fetcher.data?.ok ? undefined : fetcher.data);
  const submit = (intent: string) => fetcher.submit({ intent, id: product.id }, { method: "post" });
  const active = fetcher.formData?.get("intent") === "toggle_active" ? !product.is_active : Boolean(product.is_active);
  const featured = fetcher.formData?.get("intent") === "toggle_featured" ? !product.is_featured : Boolean(product.is_featured);
  return (
    <div className="flex items-center justify-end gap-1">
      <Button size="sm" variant="ghost" icon onClick={() => submit("toggle_featured")} aria-label={t("admin.product.featured")} title={t("admin.product.featured")}>
        <Star className={featured ? "size-3.5 fill-warning text-warning" : "size-3.5"} />
      </Button>
      <Button size="sm" variant="ghost" icon onClick={() => submit("toggle_active")} aria-label={active ? t("admin.hide") : t("admin.show")} title={active ? t("admin.hide") : t("admin.show")}>
        {active ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5 text-fg-subtle" />}
      </Button>
      <Button size="sm" variant="ghost" icon onClick={() => submit("duplicate")} aria-label={t("admin.product.duplicate")} title={t("admin.product.duplicate")}>
        <Copy className="size-3.5" />
      </Button>
      <ButtonLink to={`/admin/products/${product.id}`} size="sm" variant="ghost" icon aria-label={t("admin.edit")}>
        <Pencil className="size-3.5" />
      </ButtonLink>
    </div>
  );
}

export default function Products({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const submit = useSubmit();
  const { products, total, page, pageCount, categories, params } = loaderData;
  const stock = (value: number | null) => (value === null ? "∞" : formatNumber(value, locale));

  return (
    <>
      <AdminPageHeader
        title={t("admin.products.title")}
        description={t("admin.products.description", { count: total })}
        actions={
          <ButtonLink to="/admin/products/new" variant="primary">
            <Plus className="size-4" />
            {t("admin.products.new")}
          </ButtonLink>
        }
      />
      <Form method="get" className="mb-4 grid gap-2 sm:grid-cols-[1fr_200px_180px]" onChange={(event) => submit(event.currentTarget, { replace: true })}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input name="q" defaultValue={params.q} placeholder={t("admin.products.search")} className="input pl-9" aria-label={t("admin.products.search")} />
        </div>
        <select name="category" defaultValue={params.category} className="input" aria-label={t("admin.product.category")}>
          <option value="">{t("admin.products.allCategories")}</option>
          <option value="none">{t("admin.product.noCategory")}</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status} className="input" aria-label={t("admin.status")}>
          <option value="">{t("admin.products.allStatuses")}</option>
          <option value="active">{t("admin.active")}</option>
          <option value="hidden">{t("admin.hidden")}</option>
          <option value="featured">{t("admin.product.featured")}</option>
        </select>
      </Form>

      <TableShell footer={<Pagination page={page} pageCount={pageCount} total={total} />}>
        {products.length === 0 ? (
          <EmptyState
            icon={Package}
            title={t("admin.empty.products.title")}
            description={t("admin.empty.products.text")}
            action={
              <ButtonLink to="/admin/products/new" variant="primary">
                <Plus className="size-4" />
                {t("admin.products.new")}
              </ButtonLink>
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-line md:hidden">
              {products.map((product) => (
                <li key={product.id} className="flex items-center gap-3 px-4 py-3">
                  <Link to={`/admin/products/${product.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <ProductCover name={product.name} imageUrl={product.thumbnail_url} accent={product.accent} size="thumb" className="size-11 shrink-0 rounded-lg" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      <p className="text-xs text-fg-subtle">
                        {formatMoney(product.price, product.currency, locale)} · {t("admin.products.stockShort", { stock: stock(product.stockLabel) })}
                      </p>
                    </div>
                  </Link>
                  {!product.is_active ? <Badge>{t("admin.hidden")}</Badge> : null}
                </li>
              ))}
            </ul>
            <table className="data-table hidden md:table">
              <thead>
                <tr>
                  <th>{t("admin.products.col.product")}</th>
                  <th>{t("admin.product.category")}</th>
                  <th className="text-right">{t("admin.product.price")}</th>
                  <th className="text-right">{t("admin.product.stock")}</th>
                  <th className="text-right">{t("admin.products.col.sold")}</th>
                  <th>{t("admin.status")}</th>
                  <th className="text-right">
                    <span className="sr-only">{t("admin.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <Link to={`/admin/products/${product.id}`} className="group flex items-center gap-3">
                        <ProductCover name={product.name} imageUrl={product.thumbnail_url} accent={product.accent} size="thumb" className="size-10 shrink-0 rounded-lg" />
                        <span className="min-w-0">
                          <span className="block max-w-[280px] truncate font-medium group-hover:text-accent-strong">{product.name}</span>
                          <span className="block font-mono text-[11px] text-fg-subtle">/{product.slug}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="text-fg-muted">{product.category_name ?? "—"}</td>
                    <td className="text-right tabular">
                      {formatMoney(product.price, product.currency, locale)}
                      {product.variants > 0 ? <span className="block text-[11px] text-fg-subtle">{t("admin.products.variants", { count: product.variants })}</span> : null}
                    </td>
                    <td className="text-right tabular">
                      <span className={product.stockLabel !== null && product.stockLabel <= 3 ? "text-warning" : undefined}>{stock(product.stockLabel)}</span>
                      <span className="block text-[11px] text-fg-subtle">{t(`admin.delivery.${product.delivery_type}` as never)}</span>
                    </td>
                    <td className="text-right tabular text-fg-muted">{formatNumber(product.sold, locale)}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {product.is_active ? <Badge tone="success" dot>{t("admin.active")}</Badge> : <Badge dot>{t("admin.hidden")}</Badge>}
                        {product.is_popular ? <Badge tone="accent">{t("admin.product.popular")}</Badge> : null}
                      </div>
                    </td>
                    <td>
                      <RowActions product={product} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </TableShell>
    </>
  );
}
