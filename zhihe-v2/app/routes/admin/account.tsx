import { KeyRound, LogOut, UserPlus, Users } from "lucide-react";
import { useEffect, useRef } from "react";
import { redirect, useFetcher } from "react-router";
import { z } from "zod";
import { ConfirmAction } from "~/components/admin/confirm";
import { AdminPageHeader, Panel } from "~/components/admin/page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { SelectField, TextField } from "~/components/ui/field";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useLocale, useT } from "~/i18n/react";
import { formatDateTime } from "~/lib/format";
import { auditStatement } from "~/server/audit.server";
import { changePassword, createAdmin, SESSION_COOKIE } from "~/server/auth.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { sha256Hex } from "~/server/crypto.server";
import { isUniqueViolation, queryAll } from "~/server/db.server";
import { readCookie } from "~/server/locale.server";
import type { Route } from "./+types/account";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, admin } = await adminContext(context, request);
  const current = await sha256Hex(readCookie(request, SESSION_COOKIE) ?? "");
  const [sessions, team] = await Promise.all([
    queryAll<{ id: string; created_at: number; last_seen_at: number; ip: string | null; user_agent: string | null }>(db, "SELECT id, created_at, last_seen_at, ip, user_agent FROM admin_sessions WHERE admin_id = ? AND expires_at > ? ORDER BY last_seen_at DESC", admin.id, Date.now()),
    admin.role === "owner" ? queryAll<{ id: string; email: string; name: string; role: string; is_active: number; last_login_at: number | null }>(db, "SELECT id, email, name, role, is_active, last_login_at FROM admins ORDER BY created_at") : Promise.resolve([]),
  ]);
  return {
    admin,
    sessions: sessions.map((session) => ({ ...session, id: session.id.slice(0, 12), current: session.id === current })),
    team,
  };
}

const passwordSchema = z.object({ current: z.string().min(1).max(256), next: z.string().min(12).max(256) });
const memberSchema = z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().toLowerCase().email(), password: z.string().min(12).max(256), role: z.enum(["owner", "manager"]) });

export async function action({ request, context }: Route.ActionArgs) {
  const { db, admin, t } = await adminContext(context, request);
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "password") {
    const parsed = passwordSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(t("admin.account.passwordRules"));
    if (!(await changePassword(db, admin.id, parsed.data.current, parsed.data.next))) return fail(t("admin.account.wrongPassword"));
    await auditStatement(db, request, admin, { action: "admin.password_change", entityType: "admin", entityId: admin.id }).run();
    throw redirect("/admin/login");
  }
  if (intent === "logout_others") {
    const current = await sha256Hex(readCookie(request, SESSION_COOKIE) ?? "");
    await db.prepare("DELETE FROM admin_sessions WHERE admin_id = ? AND id != ?").bind(admin.id, current).run();
    return ok(t("admin.account.othersSignedOut"));
  }
  if (admin.role !== "owner") return fail(t("common.forbidden"));
  if (intent === "add_member") {
    const parsed = memberSchema.safeParse(Object.fromEntries(form));
    if (!parsed.success) return fail(t("admin.account.memberInvalid"));
    try {
      const id = await createAdmin(db, parsed.data);
      await auditStatement(db, request, admin, { action: "admin.create", entityType: "admin", entityId: id, summary: parsed.data.email }).run();
    } catch (error) {
      if (isUniqueViolation(error)) return fail(t("admin.account.memberExists"));
      throw error;
    }
    return ok(t("admin.account.memberAdded"));
  }
  if (intent === "toggle_member") {
    const id = String(form.get("id"));
    if (id === admin.id) return fail(t("admin.account.cannotSelf"));
    await db.batch([
      db.prepare("UPDATE admins SET is_active = 1 - is_active, updated_at = ? WHERE id = ?").bind(Date.now(), id),
      db.prepare("DELETE FROM admin_sessions WHERE admin_id = ?").bind(id),
      auditStatement(db, request, admin, { action: "admin.toggle", entityType: "admin", entityId: id }),
    ]);
    return ok(t("admin.saved"));
  }
  return fail(t("error.generic"));
}

export default function Account({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const passwordFetcher = useFetcher<ActionFeedback>();
  const memberFetcher = useFetcher<ActionFeedback>();
  const memberForm = useRef<HTMLFormElement>(null);
  useFeedbackToast(passwordFetcher.data);
  useFeedbackToast(memberFetcher.data);
  useEffect(() => {
    if (memberFetcher.state === "idle" && memberFetcher.data?.ok) memberForm.current?.reset();
  }, [memberFetcher.state, memberFetcher.data]);
  const { admin, sessions, team } = loaderData;

  return (
    <>
      <AdminPageHeader title={t("admin.account.title")} description={`${admin.name} · ${admin.email}`} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title={t("admin.account.password")}>
          <passwordFetcher.Form method="post" className="grid gap-4">
            <input type="hidden" name="intent" value="password" />
            <TextField label={t("admin.account.currentPassword")} name="current" type="password" autoComplete="current-password" required />
            <TextField label={t("admin.account.newPassword")} name="next" type="password" autoComplete="new-password" minLength={12} required hint={t("admin.setup.passwordHint")} />
            <div>
              <Button type="submit" variant="primary" loading={passwordFetcher.state !== "idle"}>
                <KeyRound className="size-4" />
                {t("admin.account.changePassword")}
              </Button>
            </div>
          </passwordFetcher.Form>
        </Panel>

        <Panel
          title={t("admin.account.sessions")}
          bodyClassName="p-0"
          actions={
            sessions.length > 1 ? (
              <ConfirmAction intent="logout_others" size="sm" title={t("admin.account.signOutOthers")} confirmLabel={t("admin.account.signOutOthers")}>
                <LogOut className="size-3.5" />
                {t("admin.account.signOutOthers")}
              </ConfirmAction>
            ) : null
          }
        >
          <ul className="divide-y divide-line">
            {sessions.map((session) => (
              <li key={session.id} className="px-5 py-3.5">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-fg-muted">{session.user_agent || "—"}</span>
                  {session.current ? <Badge tone="success">{t("admin.account.thisDevice")}</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-fg-subtle">
                  {session.ip ?? "—"} · {formatDateTime(session.last_seen_at, locale)}
                </p>
              </li>
            ))}
          </ul>
        </Panel>

        {admin.role === "owner" ? (
          <Panel title={t("admin.account.team")} className="xl:col-span-2" bodyClassName="p-0">
            <ul className="divide-y divide-line">
              {team.map((member) => (
                <li key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                  <Users className="size-4 text-fg-subtle" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {member.name} <span className="font-normal text-fg-subtle">· {member.email}</span>
                    </p>
                    <p className="text-xs text-fg-subtle">
                      {t(`admin.role.${member.role}` as never)} · {t("admin.account.lastLogin")}: {formatDateTime(member.last_login_at, locale)}
                    </p>
                  </div>
                  {member.is_active ? <Badge tone="success">{t("admin.active")}</Badge> : <Badge>{t("admin.disabled")}</Badge>}
                  {member.id !== admin.id ? (
                    <ConfirmAction intent="toggle_member" fields={{ id: member.id }} size="sm" title={member.is_active ? t("admin.account.disableMember") : t("admin.account.enableMember")} confirmLabel={t("admin.confirm")}>
                      {member.is_active ? t("admin.account.disableMember") : t("admin.account.enableMember")}
                    </ConfirmAction>
                  ) : null}
                </li>
              ))}
            </ul>
            <memberFetcher.Form ref={memberForm} method="post" className="grid gap-4 border-t border-line p-5 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_160px_auto] lg:items-end">
              <input type="hidden" name="intent" value="add_member" />
              <TextField label={t("admin.setup.name")} name="name" required />
              <TextField label="Email" name="email" type="email" required />
              <TextField label={t("admin.login.password")} name="password" type="password" minLength={12} required autoComplete="new-password" />
              <SelectField label={t("admin.account.role")} name="role" defaultValue="manager">
                <option value="manager">{t("admin.role.manager")}</option>
                <option value="owner">{t("admin.role.owner")}</option>
              </SelectField>
              <Button type="submit" variant="primary" loading={memberFetcher.state !== "idle"}>
                <UserPlus className="size-4" />
                {t("admin.account.addMember")}
              </Button>
            </memberFetcher.Form>
          </Panel>
        ) : null}
      </div>
    </>
  );
}
