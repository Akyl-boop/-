const MAX_DIMENSION = 1600;

/** Downscales large images to WebP in the browser before upload to keep media light. */
async function optimize(file: File): Promise<{ blob: Blob; width: number; height: number; name: string }> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    return { blob: file, width: 0, height: 0, name: file.name };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return { blob: file, width: bitmap.width, height: bitmap.height, name: file.name };
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.86));
  if (!blob || blob.size >= file.size) return { blob: file, width: bitmap.width, height: bitmap.height, name: file.name };
  return { blob, width, height, name: file.name.replace(/\.[^.]+$/, "") + ".webp" };
}

export async function uploadImage(file: File): Promise<{ url: string } | { error: string }> {
  const optimized = await optimize(file);
  const form = new FormData();
  form.append("file", optimized.blob, optimized.name);
  if (optimized.width) form.append("width", String(optimized.width));
  if (optimized.height) form.append("height", String(optimized.height));
  const response = await fetch("/api/admin/upload", { method: "POST", body: form });
  const data = (await response.json().catch(() => ({ error: "upload_failed" }))) as { url?: string; error?: string };
  return data.url ? { url: data.url } : { error: data.error ?? "upload_failed" };
}
