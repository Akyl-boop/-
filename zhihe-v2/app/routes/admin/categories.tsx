import { ArrowDown, ArrowUp, Pencil, Plus, Tags, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { ConfirmAction } from "~/components/admin/confirm";
import { LocalizedField } from "~/components/admin/localized-input";
import { AdminPageHeader, TableShell } from "~/components/admin/page";
import { CategoryIcon } from "~/components/store/category-icon";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { SwitchField } from "~/components/ui/field";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { CATEGORY_ICONS, type CategoryIcon as IconName } from "~/lib/domain";
import { cn, slugify } from "~/lib/format";
import { formJson } from "~/lib/form";
import { isLocalizedEmpty, parseLocalized, pickText, type LocalizedText } from "~/lib/localized";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { toCategoryIcon, type CategoryRow } from "~/server/catalog.server";
import { newId } from "~/server/crypto.server";
import { isUniqueViolation, queryAll } from "~/server/db.server";
import type { Route } from "./+types/categories";

interface CategoryDraft {
  id: string | null;
  slug: string;
  name: LocalizedText;
  description: LocalizedText;
  icon: IconName;
  isActive: boolean;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db } = await adminContext(context, request);
  const rows = await queryAll<CategoryRow & { products: number }>(
    db,
    "SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products FROM categories c ORDER BY c.sort_order, c.created_at",
  );
  return {
    categories: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: parseLocalized(row.name),
      description: parseLocalized(row.description),
      icon: toCategoryIcon(row.icon),
      isActive: Boolean(row.is_active),
      products: row.products,
    })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const now = Date.now();

  if (intent === "save") {
    const draft = formJson<CategoryDraft | null>(form, "payload", null);
    if (!draft || isLocalizedEmpty(draft.name)) return fail(t("admin.category.error.name"), { name: t("admin.category.error.name") });
    const slug = slugify(draft.slug || draft.name.en || draft.name.ru || "") || newId().slice(0, 8);
    const icon = toCategoryIcon(draft.icon);
    const name = JSON.stringify(draft.name);
    const description = JSON.stringify(draft.description ?? {});
    try {
      if (draft.id) {
        await db.prepare("UPDATE categories SET slug = ?, name = ?, description = ?, icon = ?, is_active = ?, updated_at = ? WHERE id = ?").bind(slug, name, description, icon, draft.isActive ? 1 : 0, now, draft.id).run();
      } else {
        await db
          .prepare("INSERT INTO categories (id, slug, name, description, icon, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories), ?, ?, ?)")
          .bind(newId(), slug, name, description, icon, draft.isActive ? 1 : 0, now, now)
          .run();
      }
    } catch (error) {
      if (isUniqueViolation(error)) return fail(t("admin.product.error.slug"), { slug: t("admin.product.error.slug") });
      throw error;
    }
    await auditStatement(db, request, admin, { action: draft.id ? "category.update" : "category.create", entityType: "category", entityId: draft.id, summary: slug }).run();
    return ok(t("admin.saved"));
  }
  if (intent === "delete") {
    const id = String(form.get("id"));
    await db.batch([db.prepare("DELETE FROM categories WHERE id = ?").bind(id), auditStatement(db, request, admin, { action: "category.delete", entityType: "category", entityId: id })]);
    return ok(t("admin.deleted"));
  }
  if (intent === "move") {
    const ids = formJson<string[]>(form, "order", []);
    await db.batch(ids.slice(0, 200).map((id, index) => db.prepare("UPDATE categories SET sort_order = ? WHERE id = ?").bind(index, id)));
    return ok();
  }
  return fail(t("error.generic"));
}

const EMPTY: CategoryDraft = { id: null, slug: "", name: {}, description: {}, icon: "box", isActive: true };

export default function Categories({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const fetcher = useFetcher<ActionFeedback & { fieldErrors?: Record<string, string> }>();
  const moveFetcher = useFetcher();
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  useFeedbackToast(fetcher.data);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setDraft(null);
  }, [fetcher.state, fetcher.data]);

  const categories = loaderData.categories;
  const move = (index: number, delta: number) => {
    const ids = categories.map((category) => category.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    moveFetcher.submit({ intent: "move", order: JSON.stringify(ids) }, { method: "post" });
  };
  const errors = fetcher.data && !fetcher.data.ok ? (fetcher.data.fieldErrors ?? {}) : {};

  return (
    <>
      <AdminPageHeader
        title={t("admin.categories.title")}
        description={t("admin.categories.description")}
        actions={
          <Button variant="primary" onClick={() => setDraft({ ...EMPTY })}>
            <Plus className="size-4" />
            {t("admin.categories.new")}
          </Button>
        }
      />
      <TableShell>
        {categories.length === 0 ? (
          <EmptyState icon={Tags} title={t("admin.empty.categories.title")} description={t("admin.empty.categories.text")} />
        ) : (
          <ul className="divide-y divide-line">
            {categories.map((category, index) => (
              <li key={category.id} className="flex items-center gap-4 px-4 py-3 sm:px-5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-strong bg-panel-3 text-fg-muted">
                  <CategoryIcon name={category.icon} className="size-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {pickText(category.name, locale)}
                    {!category.isActive ? <Badge>{t("admin.hidden")}</Badge> : null}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    /catalog/{category.slug} · {t("admin.categories.products", { count: category.products })}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" icon onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("admin.moveUp")}>
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" icon onClick={() => move(index, 1)} disabled={index === categories.length - 1} aria-label={t("admin.moveDown")}>
                    <ArrowDown className="size-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" icon onClick={() => setDraft({ ...category })} aria-label={t("admin.edit")}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <ConfirmAction intent="delete" fields={{ id: category.id }} size="sm" variant="ghost" icon danger title={t("admin.categories.deleteTitle")} description={t("admin.categories.deleteText", { count: category.products })} confirmLabel={t("admin.delete")} ariaLabel={t("admin.delete")}>
                    <Trash2 className="size-3.5" />
                  </ConfirmAction>
                </div>
              </li>
            ))}
          </ul>
        )}
      </TableShell>

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("admin.categories.edit") : t("admin.categories.new")}
        footer={
          <>
            <Button onClick={() => setDraft(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => draft && fetcher.submit({ intent: "save", payload: JSON.stringify(draft) }, { method: "post" })}>
              {t("admin.save")}
            </Button>
          </>
        }
      >
        {draft ? (
          <div className="grid gap-5">
            <LocalizedField label={t("admin.product.name")} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required error={errors.name} />
            <div>
              <label className="field-label" htmlFor="category-slug">
                {t("admin.product.slug")}
              </label>
              <input id="category-slug" className="input font-mono text-[13px]" value={draft.slug} placeholder={slugify(draft.name.en ?? "") || "category"} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase() })} aria-invalid={errors.slug ? true : undefined} />
              {errors.slug ? <p className="field-error">{errors.slug}</p> : null}
            </div>
            <LocalizedField label={t("admin.product.shortDescription")} value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
            <div>
              <span className="field-label">{t("admin.categories.icon")}</span>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_ICONS.map((icon) => (
                  <button key={icon} type="button" onClick={() => setDraft({ ...draft, icon })} aria-pressed={draft.icon === icon} aria-label={icon} className={cn("grid size-10 place-items-center rounded-xl border transition-colors", draft.icon === icon ? "border-accent bg-accent-soft text-accent-strong" : "border-line bg-panel-2 text-fg-muted hover:border-line-strong")}>
                    <CategoryIcon name={icon} className="size-[18px]" />
                  </button>
                ))}
              </div>
            </div>
            <SwitchField label={t("admin.active")} description={t("admin.categories.activeHint")} checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} />
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
