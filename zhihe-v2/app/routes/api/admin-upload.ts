import { audit } from "~/server/audit.server";
import { requireAdmin } from "~/server/auth.server";
import { getRequestContext } from "~/server/context";
import { newId } from "~/server/crypto.server";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, sniffImageType } from "~/server/media.server";
import type { Route } from "./+types/admin-upload";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getRequestContext(context);
  const admin = await requireAdmin(env.DB, request);
  const bucket = env.MEDIA as R2Bucket | undefined;
  if (!bucket) return Response.json({ error: "storage_not_configured" }, { status: 503 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type || !ALLOWED_IMAGE_TYPES[type]) return Response.json({ error: "unsupported_type" }, { status: 415 });

  const id = newId();
  const now = new Date();
  const key = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${ALLOWED_IMAGE_TYPES[type]}`;
  await bucket.put(key, bytes, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  const url = `/media/${key}`;
  const width = Number(form.get("width")) || null;
  const height = Number(form.get("height")) || null;
  const filename = (file.name || "image").slice(0, 200);
  await env.DB.prepare("INSERT INTO media (id, key, url, filename, content_type, size, width, height, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, key, url, filename, type, bytes.byteLength, width, height, admin.id, Date.now())
    .run();
  await audit(env.DB, request, admin, { action: "media.upload", entityType: "media", entityId: id, summary: filename });
  return Response.json({ id, url, width, height });
}
