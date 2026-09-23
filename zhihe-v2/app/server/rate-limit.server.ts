import { data } from "react-router";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

/** Fixed-window counter stored in D1. Atomic via a single UPSERT statement. */
export async function hitRateLimit(db: D1Database, key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = Date.now();
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at <= ?3 THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= ?3 THEN ?2 ELSE rate_limits.reset_at END
       RETURNING count, reset_at`,
    )
    .bind(key, now + windowMs, now)
    .first<{ count: number; reset_at: number }>();
  const count = row?.count ?? 1;
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetAt: row?.reset_at ?? now + windowMs };
}

export async function peekRateLimit(db: D1Database, key: string, limit: number): Promise<boolean> {
  const row = await db.prepare("SELECT count, reset_at FROM rate_limits WHERE key = ?").bind(key).first<{ count: number; reset_at: number }>();
  if (!row || row.reset_at <= Date.now()) return true;
  return row.count < limit;
}

export async function clearRateLimit(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM rate_limits WHERE key = ?").bind(key).run();
}

export async function enforceRateLimit(db: D1Database, key: string, limit: number, windowMs: number): Promise<void> {
  const result = await hitRateLimit(db, key, limit, windowMs);
  if (!result.allowed) {
    const retryAfter = Math.ceil((result.resetAt - Date.now()) / 1000);
    throw data({ error: "rate_limited" }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  }
}
