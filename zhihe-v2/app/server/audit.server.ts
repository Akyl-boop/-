import type { AdminUser } from "./auth.server";
import { newId } from "./crypto.server";
import { clientIp } from "./http.server";

export function auditStatement(
  db: D1Database,
  request: Request,
  admin: AdminUser | null,
  entry: { action: string; entityType: string; entityId?: string | null; summary?: string },
): D1PreparedStatement {
  return db
    .prepare("INSERT INTO audit_logs (id, admin_id, admin_email, action, entity_type, entity_id, summary, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(newId(), admin?.id ?? null, admin?.email ?? null, entry.action, entry.entityType, entry.entityId ?? null, (entry.summary ?? "").slice(0, 500), clientIp(request), Date.now());
}

export async function audit(
  db: D1Database,
  request: Request,
  admin: AdminUser | null,
  entry: { action: string; entityType: string; entityId?: string | null; summary?: string },
): Promise<void> {
  await auditStatement(db, request, admin, entry).run();
}
