import { Copy, ExternalLink, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { redirect, useBlocker, useFetcher, useNavigate } from "react-router";
import { ConfirmAction } from "~/components/admin/confirm";
import { AdminPageHeader } from "~/components/admin/page";
import { BasicsSection, DeliverySection, DetailsSection, FaqSection, MediaSection, PricingSection, RelatedSection, SeoSection, VariantsSection, VisibilitySection } from "~/components/admin/product-form/sections";
import type { ProductDraft, SetDraft } from "~/components/admin/product-form/types";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { useFeedbackToast } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import type { AdminMessageKey } from "~/i18n/messages";
import { cn, formatDateTime } from "~/lib/format";
import { isLocalizedEmpty, parseLocalized, pickText } from "~/lib/localized";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { deleteProduct, duplicateProduct, emptyProduct, getProductForEdit, productInputSchema, saveProduct } from "~/server/admin/products.server";
import { queryAll } from "~/server/db.server";
import { notFound } from "~/server/http.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/product-edit";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const settings = await getSettings(db);
  const isNew = params.id === "new";
  const product = isNew ? emptyProduct(settings.general.currency) : await getProductForEdit(db, params.id);
  if (!product) notFound();
  const [categories, instructions, products] = await Promise.all([
    queryAll<{ id: string; name: string }>(db, "SELECT id, name FROM categories ORDER BY sort_order, created_at"),
    queryAll<{ id: string; title: string }>(db, "SELECT id, title FROM instructions ORDER BY sort_order, created_at"),
    queryAll<{ id: string; name: string }>(db, "SELECT id, name FROM products ORDER BY sort_priority DESC, created_at DESC"),
  ]);
  const name = (raw: string) => pickText(parseLocalized(raw), locale);
  return {
    product,
    categories: categories.map((row) => ({ id: row.id, name: name(row.name) })),
    instructions: instructions.map((row) => ({ id: row.id, name: name(row.title) })),
    products: products.map((row) => ({ id: row.id, name: name(row.name) })),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "save");
  const id = params.id === "new" ? null : params.id;

  if (intent === "duplicate" && id) {
    const copyId = await duplicateProduct(db, id);
    if (!copyId) return fail(t("error.generic"));
    await auditStatement(db, request, admin, { action: "product.duplicate", entityType: "product", entityId: copyId, summary: `from ${id}` }).run();
    throw redirect(`/admin/products/${copyId}`);
  }
  if (intent === "delete" && id) {
    const result = await deleteProduct(db, id);
    if (!result.ok) return fail(t(result.error === "has_open_orders" ? "admin.product.error.openOrders" : "common.notFound"));
    await auditStatement(db, request, admin, { action: "product.delete", entityType: "product", entityId: id }).run();
    throw redirect("/admin/products");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}"));
  } catch {
    return fail(t("admin.error.invalid"));
  }
  const parsed = productInputSchema.safeParse(payload);
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] = t("admin.error.field");
    return fail(t("admin.error.invalid"), fields);
  }
  const result = await saveProduct(db, id, parsed.data);
  if (!result.ok) {
    const map: Record<typeof result.error, [string, AdminMessageKey]> = {
      name_required: ["name", "admin.product.error.name"],
      slug_taken: ["slug", "admin.product.error.slug"],
      variant_name_required: ["variants", "admin.product.error.variantName"],
    };
    const [field, key] = map[result.error];
    return fail(t(key), { [field]: t(key) });
  }
  await auditStatement(db, request, admin, { action: id ? "product.update" : "product.create", entityType: "product", entityId: result.id, summary: parsed.data.name.en ?? parsed.data.name.ru ?? "" }).run();
  return ok(t("admin.saved"), { redirectTo: id ? undefined : `/admin/products/${result.id}`, id: result.id });
}

const SECTIONS: { id: string; label: AdminMessageKey }[] = [
  { id: "basics", label: "admin.product.section.basics" },
  { id: "media", label: "admin.product.section.media" },
  { id: "pricing", label: "admin.product.section.pricing" },
  { id: "variants", label: "admin.product.section.variants" },
  { id: "delivery", label: "admin.product.section.delivery" },
  { id: "details", label: "admin.product.section.details" },
  { id: "faq", label: "admin.product.section.faq" },
  { id: "visibility", label: "admin.product.section.visibility" },
  { id: "seo", label: "admin.product.section.seo" },
  { id: "related", label: "admin.product.section.related" },
];

export default function ProductEdit({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState<ProductDraft>(loaderData.product);
  const [dirty, setDirty] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});
  const allowLeave = useRef(false);
  useFeedbackToast(fetcher.data);

  useEffect(() => {
    setDraft(loaderData.product);
    setDirty(false);
    allowLeave.current = false;
  }, [loaderData.product]);

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data) return;
    if (data.ok) {
      setDirty(false);
      if (data.redirectTo) {
        allowLeave.current = true;
        navigate(data.redirectTo);
      }
    }
  }, [fetcher.state, fetcher.data, navigate]);

  const set: SetDraft = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setDirty(true);
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && !allowLeave.current && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const serverErrors = fetcher.data && !fetcher.data.ok ? (fetcher.data.fieldErrors ?? {}) : {};
  const errors = { ...serverErrors, ...clientErrors };

  const save = () => {
    const next: Record<string, string> = {};
    if (isLocalizedEmpty(draft.name)) next.name = t("admin.product.error.name");
    setClientErrors(next);
    if (Object.keys(next).length) {
      document.getElementById("basics")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const { id: _id, createdAt: _c, updatedAt: _u, inventory: _i, ...input } = draft;
    fetcher.submit({ intent: "save", payload: JSON.stringify(input) }, { method: "post" });
  };

  const title = useMemo(() => pickText(draft.name, locale) || t("admin.products.new"), [draft.name, locale, t]);
  const saving = fetcher.state !== "idle" && fetcher.formData?.get("intent") === "save";

  return (
    <>
      <AdminPageHeader
        back={{ to: "/admin/products", label: t("admin.nav.products") }}
        title={title}
        description={draft.updatedAt ? `${t("admin.updated")} ${formatDateTime(draft.updatedAt, locale)}` : t("admin.product.newHint")}
        actions={
          draft.id ? (
            <>
              <a href={`/product/${draft.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                <ExternalLink className="size-3.5" />
                {t("admin.viewOnSite")}
              </a>
              <ConfirmAction intent="duplicate" size="sm" title={t("admin.product.duplicateTitle")} description={t("admin.product.duplicateText")} confirmLabel={t("admin.product.duplicate")}>
                <Copy className="size-3.5" />
                {t("admin.product.duplicate")}
              </ConfirmAction>
              <ConfirmAction intent="delete" size="sm" variant="danger" danger title={t("admin.product.deleteTitle")} description={t("admin.product.deleteText")} confirmLabel={t("admin.delete")}>
                <Trash2 className="size-3.5" />
                {t("admin.delete")}
              </ConfirmAction>
            </>
          ) : null
        }
      />

      <div className="grid gap-6 xl:grid-cols-[180px_1fr]">
        <nav className="hidden xl:block" aria-label={t("admin.product.sections")}>
          <ul className="sticky top-24 space-y-0.5">
            {SECTIONS.map((section) => (
              <li key={section.id}>
                <a href={`#${section.id}`} className="block rounded-lg px-3 py-1.5 text-[13px] text-fg-muted transition-colors hover:bg-white/[0.04] hover:text-fg">
                  {t(section.label)}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-6 pb-24">
          <BasicsSection draft={draft} set={set} categories={loaderData.categories} errors={errors} />
          <MediaSection draft={draft} set={set} />
          <PricingSection draft={draft} set={set} />
          <VariantsSection draft={draft} set={set} />
          <DeliverySection draft={draft} set={set} />
          <DetailsSection draft={draft} set={set} instructions={loaderData.instructions} />
          <FaqSection draft={draft} set={set} />
          <VisibilitySection draft={draft} set={set} />
          <SeoSection draft={draft} set={set} />
          <RelatedSection draft={draft} set={set} products={loaderData.products} />
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/85 backdrop-blur-xl lg:left-[248px]">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <p className={cn("text-[13px] transition-colors", dirty ? "text-warning" : "text-fg-subtle")}>{dirty ? t("admin.unsaved") : t("admin.allSaved")}</p>
          <div className="flex gap-2">
            <Button onClick={() => navigate("/admin/products")}>{t("common.cancel")}</Button>
            <Button variant="primary" onClick={save} loading={saving}>
              <Save className="size-4" />
              {t("admin.save")}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={blocker.state === "blocked"}
        onClose={() => blocker.reset?.()}
        title={t("admin.leaveTitle")}
        description={t("admin.leaveText")}
        size="sm"
        footer={
          <>
            <Button onClick={() => blocker.reset?.()}>{t("admin.stay")}</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t("admin.leave")}
            </Button>
          </>
        }
      />
    </>
  );
}
