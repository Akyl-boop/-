import { newId, sha256Hex } from "../crypto.server";

export const MAX_UNITS_PER_UPLOAD = 5000;
export const MAX_UNIT_LENGTH = 4000;

export function normalizeUnits(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const value = raw.replace(/\r/g, "").trim();
    if (!value || value.length > MAX_UNIT_LENGTH || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

/** Inserts units, skipping ones already stored for this product (unique content hash). */
export async function addInventory(db: D1Database, productId: string, variantId: string | null, units: string[]): Promise<{ added: number; skipped: number }> {
  const batch = newId().slice(0, 8);
  const now = Date.now();
  let added = 0;
  for (let offset = 0; offset < units.length; offset += 100) {
    const chunk = units.slice(offset, offset + 100);
    const hashes = await Promise.all(chunk.map((unit) => sha256Hex(unit)));
    const results = await db.batch(
      chunk.map((unit, index) =>
        db
          .prepare("INSERT OR IGNORE INTO inventory (id, product_id, variant_id, content, content_hash, status, batch, created_at) VALUES (?, ?, ?, ?, ?, 'available', ?, ?)")
          .bind(newId(), productId, variantId, unit, hashes[index] as string, batch, now + offset + index),
      ),
    );
    added += results.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);
  }
  return { added, skipped: units.length - added };
}

export function maskUnit(value: string): string {
  const flat = value.replace(/\s+/g, " ");
  if (flat.length <= 8) return "•".repeat(flat.length);
  return `${flat.slice(0, 4)}${"•".repeat(Math.min(12, flat.length - 8))}${flat.slice(-4)}`;
}
