export type SqlValue = string | number | null;

export async function queryAll<T>(db: D1Database, sql: string, ...params: SqlValue[]): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results;
}

export async function queryFirst<T>(db: D1Database, sql: string, ...params: SqlValue[]): Promise<T | null> {
  return db.prepare(sql).bind(...params).first<T>();
}

export async function queryValue<T extends SqlValue>(db: D1Database, sql: string, ...params: SqlValue[]): Promise<T | null> {
  const row = await db.prepare(sql).bind(...params).first<Record<string, T>>();
  if (!row) return null;
  const first = Object.values(row)[0];
  return first === undefined ? null : first;
}

export async function execute(db: D1Database, sql: string, ...params: SqlValue[]): Promise<number> {
  const result = await db.prepare(sql).bind(...params).run();
  return result.meta.changes ?? 0;
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true || value === "1";
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function bindList(count: number): string {
  return Array.from({ length: count }, () => "?").join(", ");
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
