"""Administrators, roles & permissions, audit logs."""

from __future__ import annotations

from datetime import date, datetime, time
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func, or_, select

from app.api.deps import DB, Paging, Perm, page_response, paginate
from app.core.errors import Conflict, Forbidden, NotFound, ValidationFailed
from app.models import Admin, AdminSession, AuditLog, Permission, Role
from app.security.passwords import hash_password, password_problems
from app.security.permissions import PERMISSIONS
from app.services.audit import audit
from app.services.auth import revoke_sessions

router = APIRouter(tags=["admins"])


def admin_row(a: Admin, online: bool = False) -> dict[str, Any]:
    return {"id": a.id, "email": a.email, "name": a.name, "is_owner": a.is_owner, "is_active": a.is_active,
            "role": {"id": a.role.id, "slug": a.role.slug, "name": a.role.name, "color": a.role.color},
            "totp_enabled": a.totp_enabled, "telegram_linked": a.telegram_id is not None, "last_login_at": a.last_login_at,
            "last_login_ip": a.last_login_ip, "created_at": a.created_at, "locked": bool(a.locked_until), "online": online}


@router.get("/admins")
async def list_admins(session: DB, auth: Perm("admins.manage")) -> list[dict[str, Any]]:
    from app.core.redis import redis

    admins = (await session.execute(select(Admin).order_by(Admin.created_at))).scalars().all()
    out = []
    for a in admins:
        out.append(admin_row(a, bool(await redis.get(f"admin-online:{a.id}"))))
    return out


class AdminIn(BaseModel):
    email: EmailStr
    name: str = Field(min_length=1, max_length=120)
    role_id: int
    password: str = Field(min_length=10, max_length=256)


@router.post("/admins", status_code=201)
async def create_admin(body: AdminIn, session: DB, auth: Perm("admins.manage")) -> dict[str, Any]:
    if (await session.execute(select(Admin).where(func.lower(Admin.email) == body.email.lower()))).first():
        raise Conflict("An administrator with this e-mail already exists")
    if problems := password_problems(body.password):
        raise ValidationFailed("Password must contain " + ", ".join(problems))
    role = await session.get(Role, body.role_id)
    if role is None:
        raise NotFound("Role not found")
    if role.slug == "owner" and not auth.admin.is_owner:
        raise Forbidden("Only the owner can create another owner")
    a = Admin(email=body.email.lower(), name=body.name, role_id=role.id, password_hash=hash_password(body.password),
              is_owner=role.slug == "owner")
    session.add(a)
    await session.flush()
    await session.refresh(a, ["role"])
    await audit(session, auth.admin, "admin.create", f"Added administrator {a.email} ({role.name})", entity_type="admin",
                entity_id=a.id)
    return admin_row(a)


class AdminUpdateIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    role_id: int | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=10, max_length=256)
    reset_2fa: bool = False
    unlock: bool = False


@router.patch("/admins/{admin_id}")
async def update_admin(admin_id: int, body: AdminUpdateIn, session: DB, auth: Perm("admins.manage")) -> dict[str, Any]:
    a = await session.get(Admin, admin_id)
    if a is None:
        raise NotFound("Administrator not found")
    if a.is_owner and not auth.admin.is_owner:
        raise Forbidden("Only the owner can modify the owner account")
    changes: dict[str, Any] = {}
    if body.name is not None:
        a.name = body.name
    if body.role_id is not None and body.role_id != a.role_id:
        role = await session.get(Role, body.role_id)
        if role is None:
            raise NotFound("Role not found")
        if a.id == auth.admin.id and a.is_owner and role.slug != "owner":
            raise ValidationFailed("You cannot remove your own owner role")
        changes["role"] = {"from": a.role.slug, "to": role.slug}
        a.role_id = role.id
        a.is_owner = role.slug == "owner"
    if body.is_active is not None and body.is_active != a.is_active:
        if a.id == auth.admin.id:
            raise ValidationFailed("You cannot deactivate yourself")
        a.is_active = body.is_active
        changes["is_active"] = body.is_active
        if not body.is_active:
            await revoke_sessions(session, a.id)
    if body.password:
        if problems := password_problems(body.password):
            raise ValidationFailed("Password must contain " + ", ".join(problems))
        a.password_hash = hash_password(body.password)
        await revoke_sessions(session, a.id)
        changes["password"] = "reset"
    if body.reset_2fa:
        a.totp_enabled, a.totp_secret_enc, a.recovery_codes_hash = False, None, None
        changes["2fa"] = "reset"
    if body.unlock:
        a.locked_until, a.failed_logins = None, 0
    await session.flush()
    await session.refresh(a, ["role"])
    await audit(session, auth.admin, "admin.update", f"Updated administrator {a.email}", entity_type="admin", entity_id=a.id,
                new=changes)
    return admin_row(a)


@router.delete("/admins/{admin_id}")
async def delete_admin(admin_id: int, session: DB, auth: Perm("admins.manage")) -> dict[str, str]:
    a = await session.get(Admin, admin_id)
    if a is None:
        raise NotFound("Administrator not found")
    if a.id == auth.admin.id:
        raise ValidationFailed("You cannot delete your own account")
    if a.is_owner:
        owners = (await session.execute(select(func.count()).select_from(Admin).where(Admin.is_owner.is_(True)))).scalar_one()
        if owners <= 1 or not auth.admin.is_owner:
            raise Forbidden("The last owner cannot be deleted")
    await session.delete(a)
    await audit(session, auth.admin, "admin.delete", f"Removed administrator {a.email}", entity_type="admin", entity_id=admin_id)
    return {"status": "ok"}


@router.get("/admins/{admin_id}/sessions")
async def admin_sessions(admin_id: int, session: DB, auth: Perm("admins.manage")) -> list[dict[str, Any]]:
    rows = (await session.execute(select(AdminSession).where(AdminSession.admin_id == admin_id, AdminSession.revoked_at.is_(None))
                                  .order_by(AdminSession.last_seen_at.desc()))).scalars().all()
    return [{"id": str(s.id), "ip": s.ip, "device": s.device, "last_seen_at": s.last_seen_at, "created_at": s.created_at}
            for s in rows]


@router.post("/admins/{admin_id}/revoke-sessions")
async def admin_revoke(admin_id: int, session: DB, auth: Perm("admins.manage")) -> dict[str, int]:
    n = await revoke_sessions(session, admin_id)
    await audit(session, auth.admin, "admin.sessions_revoked", f"Revoked {n} session(s)", entity_type="admin", entity_id=admin_id)
    return {"revoked": n}


# ─── Roles ──────────────────────────────────────────────────────────────────


@router.get("/permissions")
async def permissions(auth: Perm("admins.manage")) -> list[dict[str, str]]:
    return [{"code": p.code, "name": p.name, "group": p.group} for p in PERMISSIONS]


@router.get("/roles")
async def list_roles(session: DB, auth: Perm("admins.manage")) -> list[dict[str, Any]]:
    counts = dict((await session.execute(select(Admin.role_id, func.count()).group_by(Admin.role_id))).all())
    roles = (await session.execute(select(Role).order_by(Role.id))).scalars().all()
    return [{"id": r.id, "slug": r.slug, "name": r.name, "description": r.description, "color": r.color,
             "is_system": r.is_system, "permissions": sorted(r.permission_codes), "admins": counts.get(r.id, 0)} for r in roles]


class RoleIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(None, max_length=255)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    permissions: list[str]


@router.post("/roles", status_code=201)
async def create_role(body: RoleIn, session: DB, auth: Perm("admins.manage")) -> dict[str, Any]:
    from app.core.utils import slugify

    slug = slugify(body.name).replace("-", "_")
    if (await session.execute(select(Role).where(Role.slug == slug))).first():
        raise Conflict("Role already exists")
    perms = (await session.execute(select(Permission).where(Permission.code.in_(body.permissions)))).scalars().all()
    r = Role(slug=slug, name=body.name, description=body.description, color=body.color or "#64748b")
    r.permissions = list(perms)
    session.add(r)
    await session.flush()
    await audit(session, auth.admin, "role.create", f"Created role {r.name}", entity_type="role", entity_id=r.id,
                new={"permissions": body.permissions})
    return {"id": r.id}


@router.put("/roles/{role_id}")
async def update_role(role_id: int, body: RoleIn, session: DB, auth: Perm("admins.manage")) -> dict[str, str]:
    r = await session.get(Role, role_id)
    if r is None:
        raise NotFound("Role not found")
    if r.slug == "owner":
        raise Forbidden("The owner role always has full access")
    old = sorted(r.permission_codes)
    r.name, r.description, r.color = body.name, body.description, body.color or r.color
    r.permissions = list((await session.execute(select(Permission).where(Permission.code.in_(body.permissions)))).scalars())
    await audit(session, auth.admin, "role.update", f"Updated role {r.name}", entity_type="role", entity_id=r.id,
                old={"permissions": old}, new={"permissions": sorted(body.permissions)})
    return {"status": "ok"}


@router.delete("/roles/{role_id}")
async def delete_role(role_id: int, session: DB, auth: Perm("admins.manage")) -> dict[str, str]:
    r = await session.get(Role, role_id)
    if r is None:
        raise NotFound("Role not found")
    if r.is_system:
        raise Forbidden("Built-in roles cannot be deleted")
    if (await session.execute(select(func.count()).select_from(Admin).where(Admin.role_id == r.id))).scalar_one():
        raise Conflict("Role is assigned to administrators")
    await session.delete(r)
    await audit(session, auth.admin, "role.delete", f"Deleted role {r.name}", entity_type="role", entity_id=role_id)
    return {"status": "ok"}


# ─── Audit logs ─────────────────────────────────────────────────────────────


@router.get("/audit-logs")
async def audit_logs(session: DB, auth: Perm("audit.view"), paging: Paging, q: str | None = None,
                     admin_id: int | None = None, action: str | None = None, entity_type: str | None = None,
                     entity_id: str | None = None, date_from: date | None = None, date_to: date | None = None) -> dict[str, Any]:
    query = select(AuditLog).order_by(AuditLog.created_at.desc())
    if q:
        query = query.where(or_(AuditLog.summary.ilike(f"%{q}%"), AuditLog.admin_email.ilike(f"%{q}%"),
                                AuditLog.ip.ilike(f"%{q}%"), AuditLog.action.ilike(f"%{q}%")))
    if admin_id:
        query = query.where(AuditLog.admin_id == admin_id)
    if action:
        query = query.where(AuditLog.action.like(f"{action}%"))
    if entity_type:
        query = query.where(AuditLog.entity_type == entity_type)
    if entity_id:
        query = query.where(AuditLog.entity_id == entity_id)
    if date_from:
        query = query.where(AuditLog.created_at >= datetime.combine(date_from, time.min))
    if date_to:
        query = query.where(AuditLog.created_at <= datetime.combine(date_to, time.max))
    items, total = await paginate(session, query, paging)
    resp = page_response([{"id": a.id, "admin_id": a.admin_id, "admin_email": a.admin_email, "action": a.action,
                           "entity_type": a.entity_type, "entity_id": a.entity_id, "summary": a.summary,
                           "old_value": a.old_value, "new_value": a.new_value, "ip": a.ip, "user_agent": a.user_agent,
                           "created_at": a.created_at} for a in items], total, paging)
    resp["actions"] = sorted({r for r in (await session.execute(select(AuditLog.action).distinct().limit(300))).scalars()})
    return resp
