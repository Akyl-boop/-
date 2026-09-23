import { AlertTriangle, Boxes, Eye, EyeOff, FileUp, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Form, Link, useFetcher, useSubmit } from "react-router";
import { ConfirmAction } from "~/components/admin/confirm";
import { AdminPageHeader, StatCard, TableShell } from "~/components/admin/page";
import { Badge, type Tone } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { EmptyState } from "~/components/ui/empty-state";
import { Pagination } from "~/components/ui/pagination";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { INVENTORY_STATUSES, type InventoryStatus } from "~/lib/domain";
import { cn, formatDateTime, formatNumber } from "~/lib/format";
import { formJson } from "~/lib/form";
import { parseLocalized, pickText } from "~/lib/localized";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, likeTerm, ok, pageParams } from "~/server/admin/context.server";
import { addInventory, MAX_UNITS_PER_UPLOAD, maskUnit, normalizeUnits } from "~/server/admin/inventory.server";
import { bindList, queryAll, queryFirst, queryValue } from "~/server/db.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/inventory";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, locale } = await adminContext(context, request);
  const settings = await getSettings(db);
  const url = new URL(request.url);
  const productId = url.searchParams.get("product") ?? "";
  const status = url.searchParams.get("status") ?? "";
  const q = url.searchParams.get("q")?.trim().slice(0, 100) ?? "";
  const { page, pageSize, offset } = pageParams(url, 50);

  const where: string[] = ["i.product_id IS NOT NULL"];
  const params: Array<string | number> = [];
  if (productId) {
    where.push("i.product_id = ?");
    params.push(productId);
  }
  if ((INVENTORY_STATUSES as readonly string[]).includes(status)) {
    where.push("i.status = ?");
    params.push(status);
  }
  if (q) {
    where.push("(lower(i.content) LIKE ? ESCAPE '\\' OR o.number LIKE ?)");
    params.push(likeTerm(q), `%${q.toUpperCase()}%`);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const text = (raw: string | null) => (raw ? pickText(parseLocalized(raw), locale) : "");

  const [rows, total, products, variants, counts] = await Promise.all([
    queryAll<{ id: string; content: string; status: InventoryStatus; product_name: string; variant_name: string | null; order_id: string | null; order_number: string | null; created_at: number; sold_at: number | null; reserved_until: number | null }>(
      db,
      `SELECT i.id, i.content, i.status, p.name AS product_name, v.name AS variant_name, i.order_id, o.number AS order_number, i.created_at, i.sold_at, i.reserved_until
       FROM inventory i JOIN products p ON p.id = i.product_id LEFT JOIN product_variants v ON v.id = i.variant_id LEFT JOIN orders o ON o.id = i.order_id
       ${clause} ORDER BY i.created_at DESC LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      offset,
    ),
    queryValue<number>(db, `SELECT COUNT(*) FROM inventory i LEFT JOIN orders o ON o.id = i.order_id ${clause}`, ...params),
    queryAll<{ id: string; name: string; delivery_type: string; available: number; reserved: number; sold: number }>(
      db,
      `SELECT p.id, p.name, p.delivery_type,
         (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'available') AS available,
         (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'reserved') AS reserved,
         (SELECT COUNT(*) FROM inventory i WHERE i.product_id = p.id AND i.status = 'sold') AS sold
       FROM products p ORDER BY p.sort_priority DESC, p.created_at DESC`,
    ),
    queryAll<{ id: string; product_id: string; name: string }>(db, "SELECT id, product_id, name FROM product_variants WHERE is_active = 1 ORDER BY sort_order"),
    queryAll<{ status: string; n: number }>(db, `SELECT i.status, COUNT(*) AS n FROM inventory i ${productId ? "WHERE i.product_id = ?" : "WHERE i.product_id IS NOT NULL"} GROUP BY i.status`, ...(productId ? [productId] : [])),
  ]);
  const count = (key: string) => counts.find((row) => row.status === key)?.n ?? 0;
  const threshold = settings.notifications.lowStockThreshold;

  return {
    units: rows.map((row) => ({
      id: row.id,
      masked: maskUnit(row.content),
      content: row.content,
      status: row.status,
      product: text(row.product_name),
      variant: row.variant_name ? text(row.variant_name) : null,
      orderId: row.order_id,
      orderNumber: row.order_number,
      createdAt: row.created_at,
      soldAt: row.sold_at,
    })),
    total: total ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((total ?? 0) / pageSize)),
    products: products.map((row) => ({ id: row.id, name: text(row.name), deliveryType: row.delivery_type, available: row.available, reserved: row.reserved, sold: row.sold })),
    variants: variants.map((row) => ({ id: row.id, productId: row.product_id, name: text(row.name) })),
    stats: { available: count("available"), reserved: count("reserved"), sold: count("sold") },
    lowStock: products.filter((row) => row.delivery_type === "inventory" && row.available <= threshold).map((row) => ({ id: row.id, name: text(row.name), available: row.available })),
    threshold,
    params: { product: productId, status, q },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "add") {
    const productId = String(form.get("productId") ?? "");
    const variantId = String(form.get("variantId") ?? "") || null;
    const product = await queryFirst<{ id: string }>(db, "SELECT id FROM products WHERE id = ?", productId);
    if (!product) return fail(t("admin.inventory.error.product"));
    if (variantId && !(await queryFirst(db, "SELECT id FROM product_variants WHERE id = ? AND product_id = ?", variantId, productId))) return fail(t("admin.inventory.error.product"));
    const units = normalizeUnits(formJson<string[]>(form, "units", []));
    if (units.length === 0) return fail(t("admin.inventory.error.empty"));
    if (units.length > MAX_UNITS_PER_UPLOAD) return fail(t("admin.inventory.error.tooMany", { max: MAX_UNITS_PER_UPLOAD }));
    const result = await addInventory(db, productId, variantId, units);
    await auditStatement(db, request, admin, { action: "inventory.add", entityType: "product", entityId: productId, summary: `+${result.added} (skipped ${result.skipped})` }).run();
    return ok(t("admin.inventory.added", { added: result.added, skipped: result.skipped }));
  }
  if (intent === "delete") {
    const ids = formJson<string[]>(form, "ids", []).slice(0, 500);
    if (ids.length === 0) return fail(t("admin.inventory.error.empty"));
    const result = await db.prepare(`DELETE FROM inventory WHERE status = 'available' AND id IN (${bindList(ids.length)})`).bind(...ids).run();
    await auditStatement(db, request, admin, { action: "inventory.delete", entityType: "inventory", summary: `-${result.meta.changes ?? 0}` }).run();
    return ok(t("admin.inventory.deleted", { count: result.meta.changes ?? 0 }));
  }
  if (intent === "delete_available") {
    const productId = String(form.get("productId") ?? "");
    const result = await db.prepare("DELETE FROM inventory WHERE status = 'available' AND product_id = ?").bind(productId).run();
    await auditStatement(db, request, admin, { action: "inventory.delete_available", entityType: "product", entityId: productId, summary: `-${result.meta.changes ?? 0}` }).run();
    return ok(t("admin.inventory.deleted", { count: result.meta.changes ?? 0 }));
  }
  if (intent === "reveal") {
    const id = String(form.get("id") ?? "");
    await auditStatement(db, request, admin, { action: "inventory.reveal", entityType: "inventory", entityId: id }).run();
    return ok();
  }
  return fail(t("error.generic"));
}

const STATUS_TONE: Record<InventoryStatus, Tone> = { available: "success", reserved: "warning", sold: "neutral" };

function parseFile(text: string, name: string): string[] {
  const lines = text.split(/\n/);
  if (!/\.csv$/i.test(name)) return lines;
  const rows = lines.map((line) => {
    const cell = line.match(/^\s*"((?:[^"]|"")*)"|^([^,;\t]*)/);
    return (cell?.[1] ?? cell?.[2] ?? "").replace(/""/g, '"');
  });
  if (rows[0] && /^(code|key|license|content|value|account)s?$/i.test(rows[0].trim())) rows.shift();
  return rows;
}

function AddInventoryDialog({ open, onClose, products, variants, defaultProduct }: { open: boolean; onClose: () => void; products: { id: string; name: string; deliveryType: string }[]; variants: { id: string; productId: string; name: string }[]; defaultProduct: string }) {
  const t = useT();
  const fetcher = useFetcher<ActionFeedback>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [productId, setProductId] = useState(defaultProduct || products.find((p) => p.deliveryType === "inventory")?.id || "");
  const [variantId, setVariantId] = useState("");
  const [text, setText] = useState("");
  useFeedbackToast(fetcher.data);
  const productVariants = variants.filter((variant) => variant.productId === productId);
  const units = useMemo(() => [...new Set(text.split("\n").map((line) => line.trim()).filter(Boolean))], [text]);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setText("");
      onClose();
    }
  }, [fetcher.state, fetcher.data, onClose]);
  useEffect(() => setVariantId(productVariants[0]?.id ?? ""), [productId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("admin.inventory.add")}
      description={t("admin.inventory.addHint")}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button variant="primary" disabled={!productId || units.length === 0} loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "add", productId, variantId, units: JSON.stringify(units) }, { method: "post" })}>
            {t("admin.inventory.addCount", { count: units.length })}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="inv-product">
              {t("admin.inventory.product")}
            </label>
            <select id="inv-product" className="input" value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">—</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                  {product.deliveryType !== "inventory" ? ` (${t(`admin.delivery.${product.deliveryType}` as never)})` : ""}
                </option>
              ))}
            </select>
          </div>
          {productVariants.length > 0 ? (
            <div>
              <label className="field-label" htmlFor="inv-variant">
                {t("admin.inventory.variant")}
              </label>
              <select id="inv-variant" className="input" value={variantId} onChange={(event) => setVariantId(event.target.value)}>
                {productVariants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-[13px] font-medium text-fg-muted" htmlFor="inv-units">
              {t("admin.inventory.units")}
            </label>
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
              <FileUp className="size-3.5" />
              TXT / CSV
            </Button>
          </div>
          <textarea id="inv-units" rows={10} className="input font-mono text-[13px]" value={text} onChange={(event) => setText(event.target.value)} placeholder={"CODE-XXXX-XXXX\nCODE-YYYY-YYYY\nCODE-ZZZZ-ZZZZ"} spellCheck={false} />
          <p className="field-hint">{t("admin.inventory.unitsHint", { count: units.length })}</p>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              const content = await file.text();
              setText((current) => [current.trim(), ...parseFile(content, file.name)].filter(Boolean).join("\n"));
              event.target.value = "";
            }}
          />
        </div>
      </div>
    </Dialog>
  );
}

function UnitRow({ unit }: { unit: Route.ComponentProps["loaderData"]["units"][number] }) {
  const t = useT();
  const locale = useLocale();
  const [revealed, setRevealed] = useState(false);
  const fetcher = useFetcher();
  return (
    <tr>
      <td className="max-w-[320px]">
        <div className="flex items-center gap-2">
          <code className="truncate font-mono text-xs">{revealed ? unit.content : unit.masked}</code>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-fg-subtle hover:text-fg"
            onClick={() => {
              if (!revealed) fetcher.submit({ intent: "reveal", id: unit.id }, { method: "post" });
              setRevealed((value) => !value);
            }}
            aria-label={revealed ? t("admin.inventory.hide") : t("admin.inventory.reveal")}
          >
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </button>
        </div>
      </td>
      <td className="max-w-[220px] truncate text-fg-muted">
        {unit.product}
        {unit.variant ? <span className="text-fg-subtle"> · {unit.variant}</span> : null}
      </td>
      <td>
        <Badge tone={STATUS_TONE[unit.status]} dot>
          {t(`admin.inventory.status.${unit.status}`)}
        </Badge>
      </td>
      <td>
        {unit.orderId ? (
          <Link to={`/admin/orders/${unit.orderId}`} className="font-mono text-xs text-accent-strong hover:underline">
            {unit.orderNumber}
          </Link>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </td>
      <td className="text-xs whitespace-nowrap text-fg-subtle">{formatDateTime(unit.soldAt ?? unit.createdAt, locale)}</td>
      <td className="text-right">
        {unit.status === "available" ? (
          <ConfirmAction intent="delete" fields={{ ids: JSON.stringify([unit.id]) }} size="sm" variant="ghost" icon danger title={t("admin.inventory.deleteTitle")} description={t("admin.inventory.deleteText")} confirmLabel={t("admin.delete")} ariaLabel={t("admin.delete")}>
            <Trash2 className="size-3.5" />
          </ConfirmAction>
        ) : null}
      </td>
    </tr>
  );
}

export default function Inventory({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const submit = useSubmit();
  const [adding, setAdding] = useState(false);
  const { units, total, page, pageCount, products, variants, stats, lowStock, threshold, params } = loaderData;
  const selected = products.find((product) => product.id === params.product);

  return (
    <>
      <AdminPageHeader
        title={t("admin.inventory.title")}
        description={t("admin.inventory.description")}
        actions={
          <>
            {selected && selected.available > 0 ? (
              <ConfirmAction intent="delete_available" fields={{ productId: selected.id }} variant="danger" danger size="sm" title={t("admin.inventory.clearTitle")} description={t("admin.inventory.clearText", { count: selected.available, product: selected.name })} confirmLabel={t("admin.delete")}>
                <Trash2 className="size-3.5" />
                {t("admin.inventory.clear")}
              </ConfirmAction>
            ) : null}
            <Button variant="primary" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              {t("admin.inventory.add")}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label={t("admin.inventory.status.available")} value={formatNumber(stats.available, locale)} tone="success" icon={Boxes} />
        <StatCard label={t("admin.inventory.status.reserved")} value={formatNumber(stats.reserved, locale)} tone="warning" icon={Boxes} />
        <StatCard label={t("admin.inventory.status.sold")} value={formatNumber(stats.sold, locale)} icon={Boxes} />
      </div>

      {lowStock.length > 0 ? (
        <div className="mt-4 rounded-2xl border border-warning/25 bg-warning-soft p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" />
            {t("admin.inventory.lowStock", { count: threshold })}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {lowStock.map((product) => (
              <Link key={product.id} to={`/admin/inventory?product=${product.id}`} className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors", product.available === 0 ? "border-danger/30 text-danger hover:bg-danger/10" : "border-warning/30 text-warning hover:bg-warning/10")}>
                {product.name} · {product.available}
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <Form method="get" className="mt-6 mb-4 grid gap-2 sm:grid-cols-[1fr_240px_180px]" onChange={(event) => submit(event.currentTarget, { replace: true })}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle" />
          <input name="q" defaultValue={params.q} placeholder={t("admin.inventory.search")} className="input pl-9" aria-label={t("admin.inventory.search")} />
        </div>
        <select name="product" defaultValue={params.product} className="input" aria-label={t("admin.inventory.product")}>
          <option value="">{t("admin.inventory.allProducts")}</option>
          {products.map((product) => (
            <option key={product.id} value={product.id}>
              {product.name} ({product.available})
            </option>
          ))}
        </select>
        <select name="status" defaultValue={params.status} className="input" aria-label={t("admin.status")}>
          <option value="">{t("admin.inventory.allStatuses")}</option>
          {INVENTORY_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`admin.inventory.status.${status}`)}
            </option>
          ))}
        </select>
      </Form>

      <TableShell footer={<Pagination page={page} pageCount={pageCount} total={total} />}>
        {units.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={t("admin.empty.inventory.title")}
            description={t("admin.empty.inventory.text")}
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                <Plus className="size-4" />
                {t("admin.inventory.add")}
              </Button>
            }
          />
        ) : (
          <table className="data-table min-w-[760px]">
            <thead>
              <tr>
                <th>{t("admin.inventory.unit")}</th>
                <th>{t("admin.inventory.product")}</th>
                <th>{t("admin.status")}</th>
                <th>{t("admin.inventory.order")}</th>
                <th>{t("admin.inventory.date")}</th>
                <th>
                  <span className="sr-only">{t("admin.actions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <UnitRow key={unit.id} unit={unit} />
              ))}
            </tbody>
          </table>
        )}
      </TableShell>

      {adding ? <AddInventoryDialog open={adding} onClose={() => setAdding(false)} products={products} variants={variants} defaultProduct={params.product} /> : null}
    </>
  );
}
