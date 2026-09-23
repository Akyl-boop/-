import { Copy, Eye, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { redirect, useFetcher, useNavigate } from "react-router";
import { BlockEditor } from "~/components/admin/block-editor";
import { ConfirmAction } from "~/components/admin/confirm";
import { LocalizedField } from "~/components/admin/localized-input";
import { AdminPageHeader, Panel } from "~/components/admin/page";
import { InstructionView } from "~/components/store/instruction-view";
import { Button } from "~/components/ui/button";
import { SwitchField } from "~/components/ui/field";
import { SegmentedTabs } from "~/components/ui/tabs";
import { useFeedbackToast } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { LOCALE_META, LOCALES, type Locale } from "~/i18n/config";
import { slugify } from "~/lib/format";
import { formJson } from "~/lib/form";
import { type InstructionContent } from "~/lib/instructions";
import { instructionBlockSchema, parseInstructionContent } from "~/lib/instructions-schema";
import { isLocalizedEmpty, parseLocalized, pickText, type LocalizedText } from "~/lib/localized";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { newId } from "~/server/crypto.server";
import { isUniqueViolation, queryFirst } from "~/server/db.server";
import { notFound } from "~/server/http.server";
import type { Route } from "./+types/instruction-edit";

interface Draft {
  id: string | null;
  slug: string;
  title: LocalizedText;
  summary: LocalizedText;
  content: InstructionContent;
  published: boolean;
}

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { db } = await adminContext(context, request);
  if (params.id === "new") return { draft: { id: null, slug: "", title: {}, summary: {}, content: {}, published: true } as Draft };
  const row = await queryFirst<{ id: string; slug: string; title: string; summary: string; content: string; is_published: number }>(db, "SELECT * FROM instructions WHERE id = ?", params.id);
  if (!row) notFound();
  return { draft: { id: row.id, slug: row.slug, title: parseLocalized(row.title), summary: parseLocalized(row.summary), content: parseInstructionContent(row.content), published: Boolean(row.is_published) } as Draft };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  const id = params.id === "new" ? null : params.id;
  if (intent === "delete" && id) {
    await db.batch([db.prepare("DELETE FROM instructions WHERE id = ?").bind(id), auditStatement(db, request, admin, { action: "instruction.delete", entityType: "instruction", entityId: id })]);
    throw redirect("/admin/instructions");
  }
  const draft = formJson<Draft | null>(form, "payload", null);
  if (!draft || isLocalizedEmpty(draft.title)) return fail(t("admin.instructions.error.title"));
  const content: InstructionContent = {};
  for (const locale of LOCALES) {
    const blocks = draft.content?.[locale];
    if (Array.isArray(blocks)) content[locale] = blocks.slice(0, 200).map((block) => instructionBlockSchema.safeParse(block)).filter((result) => result.success).map((result) => result.data);
  }
  const slug = slugify(draft.slug || draft.title.en || draft.title.ru || "") || newId().slice(0, 8);
  const now = Date.now();
  const instructionId = id ?? newId();
  try {
    if (id) {
      await db.prepare("UPDATE instructions SET slug = ?, title = ?, summary = ?, content = ?, is_published = ?, updated_at = ? WHERE id = ?").bind(slug, JSON.stringify(draft.title), JSON.stringify(draft.summary ?? {}), JSON.stringify(content), draft.published ? 1 : 0, now, id).run();
    } else {
      await db
        .prepare("INSERT INTO instructions (id, slug, title, summary, content, is_published, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM instructions), ?, ?)")
        .bind(instructionId, slug, JSON.stringify(draft.title), JSON.stringify(draft.summary ?? {}), JSON.stringify(content), draft.published ? 1 : 0, now, now)
        .run();
    }
  } catch (error) {
    if (isUniqueViolation(error)) return fail(t("admin.product.error.slug"));
    throw error;
  }
  await auditStatement(db, request, admin, { action: id ? "instruction.update" : "instruction.create", entityType: "instruction", entityId: instructionId, summary: slug }).run();
  return ok(t("admin.saved"), { redirectTo: id ? undefined : `/admin/instructions/${instructionId}` });
}

export default function InstructionEdit({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const uiLocale = useLocale();
  const navigate = useNavigate();
  const fetcher = useFetcher<typeof action>();
  const [draft, setDraft] = useState<Draft>(loaderData.draft);
  const [locale, setLocale] = useState<Locale>("en");
  const [preview, setPreview] = useState(false);
  useFeedbackToast(fetcher.data);
  useEffect(() => setDraft(loaderData.draft), [loaderData.draft]);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok && fetcher.data.redirectTo) navigate(fetcher.data.redirectTo);
  }, [fetcher.state, fetcher.data, navigate]);

  const blocks = draft.content[locale] ?? [];
  const setBlocks = (next: typeof blocks) => setDraft({ ...draft, content: { ...draft.content, [locale]: next } });
  const sourceLocale = LOCALES.find((code) => code !== locale && (draft.content[code]?.length ?? 0) > 0);

  return (
    <>
      <AdminPageHeader
        back={{ to: "/admin/instructions", label: t("admin.nav.instructions") }}
        title={pickText(draft.title, uiLocale) || t("admin.instructions.new")}
        actions={
          <>
            {draft.id ? (
              <>
                <a href={`/instructions/${draft.slug}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm">
                  {t("admin.viewOnSite")}
                </a>
                <ConfirmAction intent="delete" size="sm" variant="danger" danger title={t("admin.instructions.deleteTitle")} description={t("admin.instructions.deleteText")} confirmLabel={t("admin.delete")}>
                  <Trash2 className="size-3.5" />
                  {t("admin.delete")}
                </ConfirmAction>
              </>
            ) : null}
            <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "save", payload: JSON.stringify(draft) }, { method: "post" })}>
              <Save className="size-4" />
              {t("admin.save")}
            </Button>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Panel
            title={t("admin.instructions.content")}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setPreview((value) => !value)}>
                <Eye className="size-3.5" />
                {preview ? t("admin.edit") : t("admin.preview")}
              </Button>
            }
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <SegmentedTabs value={locale} onChange={setLocale} options={LOCALES.map((code) => ({ value: code, label: `${LOCALE_META[code].label}${draft.content[code]?.length ? ` · ${draft.content[code]?.length}` : ""}` }))} />
              {blocks.length === 0 && sourceLocale ? (
                <Button size="sm" onClick={() => setBlocks(structuredClone(draft.content[sourceLocale] ?? []))}>
                  <Copy className="size-3.5" />
                  {t("admin.instructions.copyFrom", { lang: LOCALE_META[sourceLocale].label })}
                </Button>
              ) : null}
            </div>
            {preview ? (
              <div className="rounded-xl border border-line bg-canvas/50 p-5">{blocks.length ? <InstructionView blocks={blocks} /> : <p className="text-sm text-fg-subtle">{t("admin.instructions.emptyLocale")}</p>}</div>
            ) : (
              <BlockEditor blocks={blocks} onChange={setBlocks} />
            )}
          </Panel>
        </div>
        <aside className="space-y-6">
          <Panel title={t("admin.instructions.settings")}>
            <div className="grid gap-5">
              <LocalizedField label={t("admin.instructions.titleField")} value={draft.title} onChange={(title) => setDraft({ ...draft, title })} required />
              <LocalizedField label={t("admin.instructions.summary")} value={draft.summary} onChange={(summary) => setDraft({ ...draft, summary })} multiline rows={3} />
              <div>
                <label className="field-label" htmlFor="instruction-slug">
                  {t("admin.product.slug")}
                </label>
                <input id="instruction-slug" className="input font-mono text-[13px]" value={draft.slug} placeholder={slugify(draft.title.en ?? "") || "guide"} onChange={(event) => setDraft({ ...draft, slug: event.target.value.toLowerCase() })} />
              </div>
              <SwitchField label={t("admin.instructions.published")} description={t("admin.instructions.publishedHint")} checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} />
            </div>
          </Panel>
        </aside>
      </div>
    </>
  );
}
