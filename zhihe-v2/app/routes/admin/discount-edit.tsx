import { Save, Shuffle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Form, redirect, useNavigation } from "react-router";
import { z } from "zod";
import { ConfirmAction } from "~/components/admin/confirm";
import { AdminPageHeader, Panel } from "~/components/admin/page";
import { Button } from "~/components/ui/button";
import { SwitchField, TextField } from "~/components/ui/field";
import { useFeedbackToast } from "~/components/ui/toast";
import { useT } from "~/i18n/react";
import { minorToInput, parseMoneyInput, SUPPORTED_CURRENCIES } from "~/lib/money";
import { parseLocalized, pickText } from "~/lib/localized";
import { cn } from "~/lib/format";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { newId } from "~/server/crypto.server";
import { isUniqueViolation, queryAll, queryFirst } from "~/server/db.server";
import { notFound } from "~/server/http.server";
import type { PromoRow } from "~/server/pricing.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/discount-edit";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const settings = await getSettings(db);
  const [products, categories] = await Promise.all([
    queryAll<{ id: string; name: string }>(db, "SELECT id, name FROM products ORDER BY sort_priority DESC"),
    queryAll<{ id: string; name: string }>(db, "SELECT id, name FROM categories ORDER BY sort_order"),
  ]);
  let promo: PromoRow | null = null;
  let productIds: string[] = [];
  let categoryIds: string[] = [];
  if (params.id !== "new") {
    promo = await queryFirst<PromoRow>(db, "SELECT * FROM promo_codes WHERE id = ?", params.id);
    if (!promo) notFound();
    productIds = (await queryAll<{ product_id: string }>(db, "SELECT product_id FROM promo_code_products WHERE promo_id = ?", promo.id)).map((row) => row.product_id);
    categoryIds = (await queryAll<{ category_id: string }>(db, "SELECT category_id FROM promo_code_categories WHERE promo_id = ?", promo.id)).map((row) => row.category_id);
  }
  const text = (raw: string) => pickText(parseLocalized(raw), locale);
  return {
    promo,
    productIds,
    categoryIds,
    products: products.map((row) => ({ id: row.id, name: text(row.name) })),
    categories: categories.map((row) => ({ id: row.id, name: text(row.name) })),
    currency: settings.general.currency,
  };
}

const optionalInt = z.preprocess((value) => (value === "" || value === null || value === undefined ? null : Number(value)), z.number().int().min(1).max(10_000_000).nullable());
const optionalDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value) return null;
  const time = Date.parse(value.length === 16 ? `${value}:00Z` : value);
  return Number.isFinite(time) ? time : null;
}, z.number().nullable());

const schema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/),
  description: z.string().trim().max(300).default(""),
  type: z.enum(["percent", "fixed"]),
  value: z.string().trim(),
  currency: z.enum(SUPPORTED_CURRENCIES),
  minOrder: z.string().trim().default(""),
  maxUses: optionalInt,
  perUserLimit: optionalInt,
  startsAt: optionalDate,
  expiresAt: optionalDate,
});

export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const id = params.id === "new" ? null : params.id;
  if (form.get("intent") === "delete" && id) {
    await db.batch([db.prepare("DELETE FROM promo_codes WHERE id = ?").bind(id), auditStatement(db, request, admin, { action: "promo.delete", entityType: "promo", entityId: id })]);
    throw redirect("/admin/discounts");
  }
  const parsed = schema.safeParse(Object.fromEntries(form));
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const issue of parsed.error.issues) fields[String(issue.path[0])] = t("admin.error.field");
    return fail(t("admin.error.invalid"), fields);
  }
  const input = parsed.data;
  const value = input.type === "percent" ? Number.parseInt(input.value, 10) : parseMoneyInput(input.value);
  if (!value || value <= 0 || (input.type === "percent" && value > 100)) return fail(t("admin.discounts.error.value"), { value: t("admin.discounts.error.value") });
  const minOrder = input.minOrder ? parseMoneyInput(input.minOrder) : 0;
  if (minOrder === null) return fail(t("admin.error.invalid"), { minOrder: t("admin.error.field") });
  if (input.startsAt && input.expiresAt && input.expiresAt <= input.startsAt) return fail(t("admin.discounts.error.dates"), { expiresAt: t("admin.discounts.error.dates") });
  const productIds = form.getAll("products").map(String).slice(0, 200);
  const categoryIds = form.getAll("categories").map(String).slice(0, 200);
  const active = form.get("isActive") === "on";
  const promoId = id ?? newId();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [
    id
      ? db
          .prepare("UPDATE promo_codes SET code = ?, description = ?, type = ?, value = ?, currency = ?, min_order_amount = ?, max_uses = ?, per_user_limit = ?, starts_at = ?, expires_at = ?, is_active = ?, updated_at = ? WHERE id = ?")
          .bind(input.code, input.description, input.type, value, input.type === "fixed" ? input.currency : null, minOrder, input.maxUses, input.perUserLimit, input.startsAt, input.expiresAt, active ? 1 : 0, now, promoId)
      : db
          .prepare("INSERT INTO promo_codes (id, code, description, type, value, currency, min_order_amount, max_uses, per_user_limit, starts_at, expires_at, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(promoId, input.code, input.description, input.type, value, input.type === "fixed" ? input.currency : null, minOrder, input.maxUses, input.perUserLimit, input.startsAt, input.expiresAt, active ? 1 : 0, now, now),
    db.prepare("DELETE FROM promo_code_products WHERE promo_id = ?").bind(promoId),
    db.prepare("DELETE FROM promo_code_categories WHERE promo_id = ?").bind(promoId),
    ...productIds.map((productId) => db.prepare("INSERT OR IGNORE INTO promo_code_products (promo_id, product_id) SELECT ?, id FROM products WHERE id = ?").bind(promoId, productId)),
    ...categoryIds.map((categoryId) => db.prepare("INSERT OR IGNORE INTO promo_code_categories (promo_id, category_id) SELECT ?, id FROM categories WHERE id = ?").bind(promoId, categoryId)),
    auditStatement(db, request, admin, { action: id ? "promo.update" : "promo.create", entityType: "promo", entityId: promoId, summary: input.code }),
  ];
  try {
    await db.batch(statements);
  } catch (error) {
    if (isUniqueViolation(error)) return fail(t("admin.discounts.error.code"), { code: t("admin.discounts.error.code") });
    throw error;
  }
  if (!id) throw redirect(`/admin/discounts/${promoId}`);
  return ok(t("admin.saved"));
}

function toDateInput(timestamp: number | null | undefined): string {
  return timestamp ? new Date(timestamp).toISOString().slice(0, 16) : "";
}

export default function DiscountEdit({ loaderData, actionData }: Route.ComponentProps) {
  const t = useT();
  const navigation = useNavigation();
  const { promo, productIds, categoryIds, products, categories, currency } = loaderData;
  const [type, setType] = useState<"percent" | "fixed">(promo?.type ?? "percent");
  const [code, setCode] = useState(promo?.code ?? "");
  useFeedbackToast(actionData);
  const errors = actionData && !actionData.ok ? (actionData.fieldErrors ?? {}) : {};

  return (
    <>
      <AdminPageHeader
        back={{ to: "/admin/discounts", label: t("admin.nav.discounts") }}
        title={promo ? promo.code : t("admin.discounts.new")}
        actions={
          promo ? (
            <ConfirmAction intent="delete" size="sm" variant="danger" danger title={t("admin.discounts.deleteTitle")} description={t("admin.discounts.deleteText")} confirmLabel={t("admin.delete")}>
              <Trash2 className="size-3.5" />
              {t("admin.delete")}
            </ConfirmAction>
          ) : null
        }
      />
      <Form method="post" className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Panel title={t("admin.discounts.section.code")}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="code">
                  {t("admin.discounts.col.code")}
                </label>
                <div className="flex gap-2">
                  <input id="code" name="code" className="input font-mono uppercase" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required aria-invalid={errors.code ? true : undefined} />
                  <Button icon onClick={() => setCode(randomCodeClient())} aria-label={t("admin.discounts.generate")}>
                    <Shuffle className="size-4" />
                  </Button>
                </div>
                {errors.code ? <p className="field-error">{errors.code}</p> : <p className="field-hint">{t("admin.discounts.codeHint")}</p>}
              </div>
              <TextField label={t("admin.discounts.descriptionField")} name="description" defaultValue={promo?.description ?? ""} optional={t("common.optional")} />
            </div>
          </Panel>
          <Panel title={t("admin.discounts.section.value")}>
            <div className="grid gap-5 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <span className="field-label">{t("admin.discounts.type")}</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["percent", "fixed"] as const).map((option) => (
                    <label key={option} className={cn("flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors", type === option ? "border-accent/60 bg-accent-soft" : "border-line bg-panel-2/40 hover:border-line-strong")}>
                      <input type="radio" name="type" value={option} checked={type === option} onChange={() => setType(option)} className="accent-[var(--color-accent)]" />
                      <span className="text-sm font-medium">{t(`admin.discounts.type.${option}`)}</span>
                    </label>
                  ))}
                </div>
              </div>
              <TextField label={type === "percent" ? "%" : t("admin.discounts.amount")} name="value" inputMode="decimal" defaultValue={promo ? (promo.type === "percent" ? String(promo.value) : minorToInput(promo.value)) : ""} required error={errors.value} />
              <div>
                <label className="field-label" htmlFor="currency">
                  {t("admin.product.currency")}
                </label>
                <select id="currency" name="currency" className="input" defaultValue={promo?.currency ?? currency} disabled={type === "percent"}>
                  {SUPPORTED_CURRENCIES.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
                {type === "percent" ? <input type="hidden" name="currency" value={promo?.currency ?? currency} /> : null}
              </div>
              <TextField label={t("admin.discounts.minOrder")} name="minOrder" inputMode="decimal" defaultValue={promo?.min_order_amount ? minorToInput(promo.min_order_amount) : ""} placeholder="0" error={errors.minOrder} />
            </div>
          </Panel>
          <Panel title={t("admin.discounts.section.scope")} description={t("admin.discounts.scopeHint")}>
            <div className="grid gap-6 md:grid-cols-2">
              <fieldset>
                <legend className="field-label">{t("admin.nav.products")}</legend>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                  {products.map((product) => (
                    <label key={product.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03]">
                      <input type="checkbox" className="checkbox" name="products" value={product.id} defaultChecked={productIds.includes(product.id)} />
                      <span className="truncate">{product.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="field-label">{t("admin.nav.categories")}</legend>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
                  {categories.map((category) => (
                    <label key={category.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-white/[0.03]">
                      <input type="checkbox" className="checkbox" name="categories" value={category.id} defaultChecked={categoryIds.includes(category.id)} />
                      <span className="truncate">{category.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
          </Panel>
        </div>
        <aside className="space-y-6">
          <Panel title={t("admin.discounts.section.limits")}>
            <div className="grid gap-4">
              <TextField label={t("admin.discounts.maxUses")} name="maxUses" type="number" min={1} defaultValue={promo?.max_uses ?? ""} placeholder="∞" error={errors.maxUses} />
              <TextField label={t("admin.discounts.perUser")} name="perUserLimit" type="number" min={1} defaultValue={promo?.per_user_limit ?? ""} placeholder="∞" error={errors.perUserLimit} />
              <TextField label={t("admin.discounts.startsAt")} name="startsAt" type="datetime-local" defaultValue={toDateInput(promo?.starts_at)} hint="UTC" />
              <TextField label={t("admin.discounts.expiresAt")} name="expiresAt" type="datetime-local" defaultValue={toDateInput(promo?.expires_at)} hint="UTC" error={errors.expiresAt} />
              <SwitchField label={t("admin.active")} name="isActive" defaultChecked={promo ? Boolean(promo.is_active) : true} />
            </div>
          </Panel>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={navigation.state === "submitting"}>
            <Save className="size-4" />
            {t("admin.save")}
          </Button>
        </aside>
      </Form>
    </>
  );
}

function randomCodeClient(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

