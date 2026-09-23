import { Image, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { useRevalidator } from "react-router";
import { ConfirmAction } from "~/components/admin/confirm";
import { useImageUpload } from "~/components/admin/media-picker";
import { AdminPageHeader } from "~/components/admin/page";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { EmptyState } from "~/components/ui/empty-state";
import { useToast } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { formatDate } from "~/lib/format";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { queryAll, queryFirst } from "~/server/db.server";
import type { Route } from "./+types/media";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = await adminContext(context, request);
  const items = await queryAll<{ id: string; url: string; filename: string; size: number; width: number | null; height: number | null; created_at: number }>(
    db,
    "SELECT id, url, filename, size, width, height, created_at FROM media ORDER BY created_at DESC LIMIT 300",
  );
  return { items, storage: Boolean(env.MEDIA) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, env, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  if (form.get("intent") !== "delete") return fail(t("error.generic"));
  const id = String(form.get("id"));
  const row = await queryFirst<{ key: string }>(db, "SELECT key FROM media WHERE id = ?", id);
  if (!row) return fail(t("common.notFound"));
  await (env.MEDIA as R2Bucket | undefined)?.delete(row.key);
  await db.batch([db.prepare("DELETE FROM media WHERE id = ?").bind(id), auditStatement(db, request, admin, { action: "media.delete", entityType: "media", entityId: id })]);
  return ok(t("admin.deleted"));
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function Media({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const toast = useToast();
  const revalidator = useRevalidator();
  const input = useRef<HTMLInputElement>(null);
  const { upload, uploading } = useImageUpload(() => {
    toast({ tone: "success", title: t("admin.media.uploaded") });
    revalidator.revalidate();
  });

  return (
    <>
      <AdminPageHeader
        title={t("admin.media.title")}
        description={loaderData.storage ? t("admin.media.description") : t("admin.media.noStorage")}
        actions={
          <Button variant="primary" onClick={() => input.current?.click()} loading={uploading} disabled={!loaderData.storage}>
            <Upload className="size-4" />
            {t("admin.media.upload")}
          </Button>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/x-icon"
        className="hidden"
        onChange={async (event) => {
          for (const file of Array.from(event.target.files ?? [])) await upload(file);
          event.target.value = "";
        }}
      />
      {loaderData.items.length === 0 ? (
        <div className="surface">
          <EmptyState icon={Image} title={t("admin.empty.media.title")} description={t("admin.empty.media.text")} />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {loaderData.items.map((item) => (
            <figure key={item.id} className="surface group overflow-hidden">
              <div className="aspect-square bg-panel-2">
                <img src={item.url} alt={item.filename} loading="lazy" className="size-full object-cover" />
              </div>
              <figcaption className="p-3">
                <p className="truncate text-xs font-medium">{item.filename}</p>
                <p className="mt-0.5 text-[11px] text-fg-subtle">
                  {formatBytes(item.size)}
                  {item.width ? ` · ${item.width}×${item.height}` : ""} · {formatDate(item.created_at, locale)}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <CopyButton value={item.url} label="URL" className="h-7 flex-1 px-2" />
                  <ConfirmAction intent="delete" fields={{ id: item.id }} size="sm" variant="ghost" icon danger title={t("admin.media.deleteTitle")} description={t("admin.media.deleteText")} confirmLabel={t("admin.delete")} className="h-7 w-7" ariaLabel={t("admin.delete")}>
                    <Trash2 className="size-3.5" />
                  </ConfirmAction>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </>
  );
}
