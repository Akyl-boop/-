import { redirect } from "react-router";
import { hashPassword, newId, randomToken, sha256Hex, verifyPassword } from "./crypto.server";
import { execute, queryFirst } from "./db.server";
import { clientIp, userAgent } from "./http.server";
import { readCookie } from "./locale.server";
import { clearRateLimit, hitRateLimit, peekRateLimit } from "./rate-limit.server";

export const SESSION_COOKIE = "__Host-zh_admin";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_REFRESH_MS = 15 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_EMAIL = 5;
const MAX_ATTEMPTS_PER_IP = 20;

export type AdminRole = "owner" | "manager";

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
}

interface AdminRow extends AdminUser {
  password_hash: string;
  is_active: number;
}

function sessionCookie(value: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}

export async function adminCount(db: D1Database): Promise<number> {
  const row = await queryFirst<{ n: number }>(db, "SELECT COUNT(*) AS n FROM admins");
  return row?.n ?? 0;
}

export async function createAdmin(db: D1Database, input: { email: string; name: string; password: string; role: AdminRole }): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db
    .prepare("INSERT INTO admins (id, email, name, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.email.trim().toLowerCase(), input.name.trim(), await hashPassword(input.password), input.role, now, now)
    .run();
  return id;
}

export type LoginResult = { ok: true; cookie: string } | { ok: false; error: "invalid_credentials" | "locked" };

export async function login(db: D1Database, request: Request, email: string, password: string): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const ip = clientIp(request);
  const emailKey = `login:email:${normalized}`;
  const ipKey = `login:ip:${ip}`;
  if (!(await peekRateLimit(db, emailKey, MAX_ATTEMPTS_PER_EMAIL)) || !(await peekRateLimit(db, ipKey, MAX_ATTEMPTS_PER_IP))) {
    return { ok: false, error: "locked" };
  }

  const admin = await queryFirst<AdminRow>(db, "SELECT id, email, name, role, password_hash, is_active FROM admins WHERE email = ?", normalized);
  // Verify against a dummy hash when the account is unknown so timing does not reveal valid emails.
  const valid = await verifyPassword(password, admin?.password_hash ?? "pbkdf2_sha256$100000$00000000000000000000000000000000$00");
  if (!admin || !valid || !admin.is_active) {
    await Promise.all([hitRateLimit(db, emailKey, MAX_ATTEMPTS_PER_EMAIL, LOGIN_WINDOW_MS), hitRateLimit(db, ipKey, MAX_ATTEMPTS_PER_IP, LOGIN_WINDOW_MS)]);
    return { ok: false, error: "invalid_credentials" };
  }

  await clearRateLimit(db, emailKey);
  const token = randomToken(32);
  const now = Date.now();
  await db.batch([
    db
      .prepare("INSERT INTO admin_sessions (id, admin_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(await sha256Hex(token), admin.id, now, now + SESSION_TTL_MS, now, ip, userAgent(request)),
    db.prepare("UPDATE admins SET last_login_at = ? WHERE id = ?").bind(now, admin.id),
    db.prepare("DELETE FROM admin_sessions WHERE expires_at < ?").bind(now),
  ]);
  return { ok: true, cookie: sessionCookie(token, SESSION_TTL_MS / 1000) };
}

export async function getAdmin(db: D1Database, request: Request): Promise<AdminUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const sessionId = await sha256Hex(token);
  const row = await queryFirst<AdminUser & { expires_at: number; last_seen_at: number; is_active: number }>(
    db,
    `SELECT a.id, a.email, a.name, a.role, a.is_active, s.expires_at, s.last_seen_at
     FROM admin_sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id = ?`,
    sessionId,
  );
  const now = Date.now();
  if (!row || row.expires_at < now || !row.is_active) return null;
  if (now - row.last_seen_at > SESSION_REFRESH_MS) {
    await execute(db, "UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?", now, sessionId);
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

/** Every admin loader and action calls this; hidden routes alone are never trusted. */
export async function requireAdmin(db: D1Database, request: Request, role?: AdminRole): Promise<AdminUser> {
  const admin = await getAdmin(db, request);
  if (!admin) {
    const url = new URL(request.url);
    const next = url.pathname.startsWith("/admin") && !url.pathname.startsWith("/admin/login") ? `?next=${encodeURIComponent(url.pathname + url.search)}` : "";
    throw redirect(`/admin/login${next}`);
  }
  if (role === "owner" && admin.role !== "owner") throw new Response("Forbidden", { status: 403 });
  return admin;
}

export async function logout(db: D1Database, request: Request): Promise<string> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await execute(db, "DELETE FROM admin_sessions WHERE id = ?", await sha256Hex(token));
  return sessionCookie("", 0);
}

export async function changePassword(db: D1Database, adminId: string, current: string, next: string): Promise<boolean> {
  const row = await queryFirst<{ password_hash: string }>(db, "SELECT password_hash FROM admins WHERE id = ?", adminId);
  if (!row || !(await verifyPassword(current, row.password_hash))) return false;
  await db.batch([
    db.prepare("UPDATE admins SET password_hash = ?, updated_at = ? WHERE id = ?").bind(await hashPassword(next), Date.now(), adminId),
    db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").bind(adminId),
  ]);
  return true;
}
