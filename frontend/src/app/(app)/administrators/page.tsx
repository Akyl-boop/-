"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, LogOut, MoreHorizontal, Plus, ShieldCheck, Trash2, UserCog, Users } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { DataTable } from "@/components/ui/data-table";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Dropdown, DropdownContent, DropdownItem, DropdownSeparator, DropdownTrigger } from "@/components/ui/dropdown";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Avatar, Badge, Card, Checkbox, Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { timeAgo } from "@/lib/utils";

interface AdminRow { id: number; email: string; name: string; is_owner: boolean; is_active: boolean; role: { id: number; slug: string; name: string; color?: string }; totp_enabled: boolean; telegram_linked: boolean; last_login_at?: string; last_login_ip?: string; locked: boolean; online: boolean }
interface Role { id: number; slug: string; name: string; description?: string; color?: string; is_system: boolean; permissions: string[]; admins: number }
interface Perm { code: string; name: string; group: string }

export default function AdministratorsPage() {
  return (
    <div>
      <PageHeader title="Administrators" description="Your team, their roles and exactly what each role can do." />
      <Tabs defaultValue="team">
        <TabsList className="mb-4"><TabsTrigger value="team"><Users />Team</TabsTrigger><TabsTrigger value="roles"><ShieldCheck />Roles & permissions</TabsTrigger></TabsList>
        <TabsContent value="team"><Team /></TabsContent>
        <TabsContent value="roles"><Roles /></TabsContent>
      </Tabs>
    </div>
  );
}

function Team() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { admin: me } = useSession();
  const list = useQuery({ queryKey: ["admins"], queryFn: () => api.get<AdminRow[]>("/admins") });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles") });
  const [invite, setInvite] = React.useState(false);
  const [form, setForm] = React.useState({ email: "", name: "", role_id: "", password: "" });
  const inv = () => qc.invalidateQueries({ queryKey: ["admins"] });
  const create = useMutation({ mutationFn: () => api.post("/admins", { ...form, role_id: Number(form.role_id) }), onSuccess: () => { toast.success("Administrator added — share the password securely"); setInvite(false); setForm({ email: "", name: "", role_id: "", password: "" }); inv(); } });
  const patch = useMutation({ mutationFn: ({ id, ...b }: { id: number } & Record<string, unknown>) => api.patch(`/admins/${id}`, b), onSuccess: () => { toast.success("Updated"); inv(); } });
  const revoke = useMutation({ mutationFn: (id: number) => api.post<{ revoked: number }>(`/admins/${id}/revoke-sessions`), onSuccess: (r) => toast.success(`${r.revoked} session(s) revoked`) });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/admins/${id}`), onSuccess: inv });
  const genPassword = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789"[b % 56]).join("") + "7";
  return (<>
    <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => { setForm({ ...form, password: genPassword() }); setInvite(true); }}><Plus />Add administrator</Button></div>
    <DataTable rows={list.data} loading={list.isLoading} getId={(a) => a.id} columns={[
      { key: "n", header: "Administrator", cell: (a) => (
        <div className="flex items-center gap-2.5">
          <div className="relative"><Avatar name={a.name} size={30} />{a.online ? <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-success ring-2 ring-[var(--surface)]" /> : null}</div>
          <div><div className="font-medium">{a.name}{a.id === me?.id ? <span className="ml-1.5 text-[12px] text-fg-3">(you)</span> : null}</div><div className="text-[12px] text-fg-3">{a.email}</div></div>
        </div>
      ) },
      { key: "r", header: "Role", cell: (a) => <Badge style={{ color: a.role.color, background: `${a.role.color}1f` }}>{a.role.name}</Badge> },
      { key: "s", header: "Security", hide: "md", cell: (a) => <div className="flex gap-1">{a.totp_enabled ? <Badge tone="success">2FA</Badge> : <Badge tone="warning">No 2FA</Badge>}{a.telegram_linked ? <Badge tone="info">Telegram</Badge> : null}{a.locked ? <Badge tone="danger">Locked</Badge> : null}</div> },
      { key: "st", header: "Status", cell: (a) => a.is_active ? <Badge tone="success" dot>Active</Badge> : <Badge dot>Disabled</Badge> },
      { key: "l", header: "Last login", hide: "lg", cell: (a) => <span className="text-fg-3">{a.last_login_at ? `${timeAgo(a.last_login_at)} · ${a.last_login_ip}` : "Never"}</span> },
      { key: "x", header: "", cell: (a) => a.id === me?.id ? null : (
        <Dropdown>
          <DropdownTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Actions"><MoreHorizontal /></Button></DropdownTrigger>
          <DropdownContent>
            {(roles.data ?? []).map((r) => <DropdownItem key={r.id} icon={<UserCog />} disabled={r.id === a.role.id} onSelect={() => patch.mutate({ id: a.id, role_id: r.id })}>Make {r.name}</DropdownItem>)}
            <DropdownSeparator />
            <DropdownItem icon={<KeyRound />} onSelect={async () => { const p = genPassword(); if ((await confirm({ title: `Reset password for ${a.name}?`, description: <>New password: <code className="font-mono text-fg">{p}</code> — copy it now. All their sessions are signed out.</>, confirmLabel: "Reset" })).ok) { await navigator.clipboard?.writeText(p).catch(() => {}); patch.mutate({ id: a.id, password: p }); } }}>Reset password</DropdownItem>
            {a.totp_enabled ? <DropdownItem icon={<ShieldCheck />} onSelect={() => patch.mutate({ id: a.id, reset_2fa: true })}>Reset 2FA</DropdownItem> : null}
            {a.locked ? <DropdownItem icon={<KeyRound />} onSelect={() => patch.mutate({ id: a.id, unlock: true })}>Unlock account</DropdownItem> : null}
            <DropdownItem icon={<LogOut />} onSelect={() => revoke.mutate(a.id)}>Sign out everywhere</DropdownItem>
            <DropdownItem icon={<UserCog />} onSelect={() => patch.mutate({ id: a.id, is_active: !a.is_active })}>{a.is_active ? "Disable account" : "Enable account"}</DropdownItem>
            <DropdownSeparator />
            <DropdownItem danger icon={<Trash2 />} onSelect={async () => { if ((await confirm({ title: `Remove ${a.name}?`, danger: true, confirmLabel: "Remove", typeToConfirm: a.email })).ok) del.mutate(a.id); }}>Remove</DropdownItem>
          </DropdownContent>
        </Dropdown>
      ) },
    ]} />
    <Dialog open={invite} onOpenChange={setInvite}>
      <DialogContent title="Add administrator" description="They sign in with this e-mail and password, and should enable 2FA right away."
        footer={<><Button variant="ghost" onClick={() => setInvite(false)}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!form.email || !form.name || !form.role_id || form.password.length < 10} onClick={() => create.mutate()}>Add</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="E-mail"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Role"><Select value={form.role_id} onChange={(v) => setForm({ ...form, role_id: v })} options={(roles.data ?? []).map((r) => ({ value: String(r.id), label: r.name, hint: r.description }))} /></Field>
          <Field label="Initial password" help="Generated — copy and share securely."><Input className="font-mono" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        </div>
      </DialogContent>
    </Dialog>
  </>);
}

function Roles() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => api.get<Role[]>("/roles") });
  const perms = useQuery({ queryKey: ["permissions"], queryFn: () => api.get<Perm[]>("/permissions") });
  const [edit, setEdit] = React.useState<Partial<Role> | null>(null);
  const inv = () => qc.invalidateQueries({ queryKey: ["roles"] });
  const save = useMutation({ mutationFn: (r: Partial<Role>) => r.id ? api.put(`/roles/${r.id}`, r) : api.post("/roles", r), onSuccess: () => { toast.success("Role saved"); setEdit(null); inv(); } });
  const del = useMutation({ mutationFn: (id: number) => api.del(`/roles/${id}`), onSuccess: inv });
  const groups = Array.from(new Set((perms.data ?? []).map((p) => p.group)));
  return (<>
    <div className="mb-3 flex justify-end"><Button variant="primary" onClick={() => setEdit({ name: "", description: "", color: "#64748b", permissions: ["dashboard.view"] })}><Plus />New role</Button></div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {(roles.data ?? []).map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div><div className="flex items-center gap-2 font-semibold"><span className="size-2.5 rounded-full" style={{ background: r.color }} />{r.name}</div><div className="mt-0.5 text-[12.5px] text-fg-3">{r.description}</div></div>
            <Badge>{r.admins} admin{r.admins === 1 ? "" : "s"}</Badge>
          </div>
          <div className="mt-3 text-[12px] text-fg-3">{r.slug === "owner" ? "All permissions" : `${r.permissions.length} permissions`}</div>
          <div className="mt-3 flex gap-1.5">
            {r.slug !== "owner" ? <Button size="sm" onClick={() => setEdit(r)}>Edit permissions</Button> : <Badge tone="warning">Full access, locked</Badge>}
            {!r.is_system ? <Button size="icon-sm" variant="danger-ghost" aria-label="Delete" onClick={async () => { if ((await confirm({ title: `Delete role ${r.name}?`, danger: true, confirmLabel: "Delete" })).ok) del.mutate(r.id); }}><Trash2 /></Button> : null}
          </div>
        </Card>
      ))}
    </div>
    {edit ? (
      <Dialog open onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent size="lg" title={edit.id ? `Edit role · ${edit.name}` : "New role"}
          footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button variant="primary" disabled={!edit.name} loading={save.isPending} onClick={() => save.mutate(edit)}>Save role</Button></>}>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <Field label="Name"><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Color"><input type="color" value={edit.color ?? "#64748b"} onChange={(e) => setEdit({ ...edit, color: e.target.value })} className="h-8 w-14 cursor-pointer rounded-[8px] border border-border bg-transparent" /></Field>
            </div>
            <Field label="Description"><Textarea rows={2} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map((g) => {
                const items = (perms.data ?? []).filter((p) => p.group === g);
                const all = items.every((p) => edit.permissions?.includes(p.code));
                return (
                  <div key={g} className="rounded-[12px] border border-border p-3">
                    <label className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold"><Checkbox checked={all} onCheckedChange={(v) => setEdit({ ...edit, permissions: v ? Array.from(new Set([...(edit.permissions ?? []), ...items.map((p) => p.code)])) : (edit.permissions ?? []).filter((c) => !items.some((p) => p.code === c)) })} />{g}</label>
                    <div className="space-y-1.5 pl-1">{items.map((p) => (
                      <label key={p.code} className="flex items-center gap-2 text-[12.5px] text-fg-2"><Checkbox checked={!!edit.permissions?.includes(p.code)} onCheckedChange={(v) => setEdit({ ...edit, permissions: v ? [...(edit.permissions ?? []), p.code] : (edit.permissions ?? []).filter((c) => c !== p.code) })} />{p.name}</label>
                    ))}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    ) : null}
  </>);
}
