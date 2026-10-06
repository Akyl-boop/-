"""Authentication & account security endpoints."""

from __future__ import annotations

import secrets
import uuid
from typing import Any

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from app.api.deps import DB, Auth, client_ip
from app.core.config import settings
from app.core.crypto import decrypt_str, encrypt_str
from app.core.errors import Forbidden, NotFound, Unauthorized, ValidationFailed
from app.models import Admin, AdminSession
from app.security import totp
from app.security.passwords import hash_password, password_problems, verify_password
from app.services import auth as auth_service
from app.services.audit import audit
from app.services.settings import settings_store

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)


class SecondFactorIn(BaseModel):
    challenge: str
    code: str = Field(min_length=4, max_length=32)


class ChallengeIn(BaseModel):
    challenge: str


class ForgotIn(BaseModel):
    email: EmailStr


class ResetIn(BaseModel):
    token: str
    password: str = Field(min_length=10, max_length=256)


class PasswordChangeIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=256)


class ProfileIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    receive_telegram_notifications: bool | None = None
    telegram_2fa_enabled: bool | None = None
    preferences: dict[str, Any] | None = None


class TotpEnableIn(BaseModel):
    code: str


class TotpDisableIn(BaseModel):
    password: str
    code: str


def set_auth_cookies(response: Response, token: str) -> str:
    csrf = secrets.token_urlsafe(32)
    common = {"secure": settings.cookie_secure, "samesite": "lax", "path": "/", "domain": settings.cookie_domain}
    response.set_cookie(settings.session_cookie_name, token, httponly=True, max_age=settings.session_ttl_hours * 3600,
                        **common)
    response.set_cookie(settings.csrf_cookie_name, csrf, httponly=False, max_age=settings.session_ttl_hours * 3600,
                        **common)
    return csrf


def clear_auth_cookies(response: Response) -> None:
    for name in (settings.session_cookie_name, settings.csrf_cookie_name):
        response.delete_cookie(name, path="/", domain=settings.cookie_domain)


def admin_out(admin: Admin) -> dict[str, Any]:
    perms = sorted(p.code for p in admin.role.permissions) if not admin.is_owner else None
    if admin.is_owner:
        from app.security.permissions import ALL_CODES

        perms = sorted(ALL_CODES)
    return {
        "id": admin.id, "email": admin.email, "name": admin.name, "is_owner": admin.is_owner,
        "role": {"id": admin.role.id, "slug": admin.role.slug, "name": admin.role.name, "color": admin.role.color},
        "permissions": perms, "totp_enabled": admin.totp_enabled, "telegram_linked": admin.telegram_id is not None,
        "telegram_2fa_enabled": admin.telegram_2fa_enabled,
        "receive_telegram_notifications": admin.receive_telegram_notifications,
        "last_login_at": admin.last_login_at, "avatar_url": admin.avatar_url, "preferences": admin.preferences or {},
    }


async def _finish_login(session: Any, response: Response, admin: Admin, request: Request) -> dict[str, Any]:
    ip = client_ip(request)
    token, _ = await auth_service.create_session(session, admin, ip, request.headers.get("user-agent"))
    csrf = set_auth_cookies(response, token)
    return {"status": "ok", "admin": admin_out(admin), "csrf_token": csrf}


@router.post("/login")
async def login(body: LoginIn, request: Request, response: Response, session: DB) -> dict[str, Any]:
    ip = client_ip(request)
    admin = await auth_service.authenticate(session, body.email, body.password, ip)
    methods = auth_service.second_factors(admin)
    sec = await settings_store.group("security")
    if sec.get("require_2fa") and not methods and not admin.is_owner:
        raise Forbidden("Two-factor authentication is required. Ask the owner to help you set it up.",
                        code="2fa_required_setup")
    if methods:
        cid = await auth_service.create_challenge(admin, ip, request.headers.get("user-agent"))
        if "telegram" in methods:
            try:
                await auth_service.send_telegram_approval(admin, cid, ip, request.headers.get("user-agent"))
            except Exception:
                methods = [m for m in methods if m != "telegram"]
        return {"status": "2fa_required", "challenge": cid, "methods": methods}
    return await _finish_login(session, response, admin, request)


@router.post("/login/2fa")
async def login_second_factor(body: SecondFactorIn, request: Request, response: Response, session: DB) -> dict[str, Any]:
    from app.security.ratelimit import enforce

    await enforce(f"2fa:{body.challenge}", 6, 300, "Too many attempts")
    data = await auth_service.get_challenge(body.challenge)
    admin = await session.get(Admin, data["admin_id"])
    if admin is None or not admin.is_active:
        raise Unauthorized("Invalid sign-in request")
    if not auth_service.verify_second_factor(admin, body.code):
        await audit(session, admin, "auth.2fa_failed", "Invalid 2FA code", entity_type="admin", entity_id=admin.id)
        raise Unauthorized("Invalid verification code", code="invalid_code")
    await auth_service.consume_challenge(body.challenge)
    return await _finish_login(session, response, admin, request)


@router.post("/login/telegram")
async def login_telegram_poll(body: ChallengeIn, request: Request, response: Response, session: DB) -> dict[str, Any]:
    data = await auth_service.get_challenge(body.challenge)
    if data.get("tg") == "pending":
        return {"status": "pending"}
    if data.get("tg") == "denied":
        await auth_service.consume_challenge(body.challenge)
        raise Unauthorized("Sign-in was denied from Telegram", code="denied")
    admin = await session.get(Admin, data["admin_id"])
    if admin is None:
        raise Unauthorized("Invalid sign-in request")
    await auth_service.consume_challenge(body.challenge)
    return await _finish_login(session, response, admin, request)


@router.post("/logout")
async def logout(auth: Auth, response: Response, session: DB) -> dict[str, str]:
    from app.core.utils import utcnow

    auth.session.revoked_at = utcnow()
    await audit(session, auth.admin, "auth.logout", "Signed out", entity_type="admin", entity_id=auth.admin.id)
    clear_auth_cookies(response)
    return {"status": "ok"}


@router.get("/me")
async def me(auth: Auth) -> dict[str, Any]:
    return admin_out(auth.admin)


@router.patch("/me")
async def update_me(body: ProfileIn, auth: Auth, session: DB) -> dict[str, Any]:
    admin = auth.admin
    if body.name is not None:
        admin.name = body.name
    if body.receive_telegram_notifications is not None:
        admin.receive_telegram_notifications = body.receive_telegram_notifications
    if body.telegram_2fa_enabled is not None:
        if body.telegram_2fa_enabled and not admin.telegram_id:
            raise ValidationFailed("Link your Telegram account first")
        admin.telegram_2fa_enabled = body.telegram_2fa_enabled
    if body.preferences is not None:
        admin.preferences = {**(admin.preferences or {}), **body.preferences}
    return admin_out(admin)


@router.post("/forgot-password")
async def forgot_password(body: ForgotIn, request: Request, session: DB) -> dict[str, str]:
    await auth_service.start_password_reset(session, body.email, client_ip(request))
    return {"status": "ok", "message": "If an account exists for this e-mail, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(body: ResetIn, session: DB) -> dict[str, str]:
    await auth_service.complete_password_reset(session, body.token, body.password)
    return {"status": "ok"}


@router.post("/password")
async def change_password(body: PasswordChangeIn, auth: Auth, session: DB) -> dict[str, str]:
    admin = auth.admin
    if not verify_password(body.current_password, admin.password_hash):
        raise ValidationFailed("Current password is incorrect", code="invalid_password")
    if problems := password_problems(body.new_password):
        raise ValidationFailed("Password must contain " + ", ".join(problems))
    from app.core.utils import utcnow

    admin.password_hash = hash_password(body.new_password)
    admin.password_changed_at = utcnow()
    await auth_service.revoke_sessions(session, admin.id, except_id=auth.session.id)
    await audit(session, admin, "auth.password_changed", "Changed password", entity_type="admin", entity_id=admin.id)
    return {"status": "ok"}


@router.get("/sessions")
async def list_sessions(auth: Auth, session: DB) -> list[dict[str, Any]]:
    rows = (await session.execute(
        select(AdminSession).where(AdminSession.admin_id == auth.admin.id, AdminSession.revoked_at.is_(None))
        .order_by(AdminSession.last_seen_at.desc())
    )).scalars().all()
    from app.core.utils import utcnow

    now = utcnow()
    return [{"id": str(s.id), "ip": s.ip, "device": s.device, "user_agent": s.user_agent, "created_at": s.created_at,
             "last_seen_at": s.last_seen_at, "expires_at": s.expires_at, "current": s.id == auth.session.id}
            for s in rows if s.expires_at > now]


@router.delete("/sessions/{session_id}")
async def revoke_session(session_id: uuid.UUID, auth: Auth, session: DB) -> dict[str, str]:
    from app.core.utils import utcnow

    s = await session.get(AdminSession, session_id)
    if s is None or s.admin_id != auth.admin.id:
        raise NotFound("Session not found")
    s.revoked_at = utcnow()
    await audit(session, auth.admin, "auth.session_revoked", f"Revoked session {s.device} ({s.ip})", entity_type="session",
                entity_id=s.id)
    return {"status": "ok"}


@router.post("/sessions/revoke-others")
async def revoke_other_sessions(auth: Auth, session: DB) -> dict[str, int]:
    n = await auth_service.revoke_sessions(session, auth.admin.id, except_id=auth.session.id)
    await audit(session, auth.admin, "auth.sessions_revoked", f"Revoked {n} other sessions")
    return {"revoked": n}


@router.post("/2fa/setup")
async def totp_setup(auth: Auth) -> dict[str, str]:
    secret = totp.new_secret()
    from app.core.redis import redis

    await redis.set(f"totp-setup:{auth.admin.id}", encrypt_str(secret) or "", ex=900)
    issuer = (await settings_store.get("general.dashboard_name")) or "Nexa"
    uri = totp.provisioning_uri(secret, auth.admin.email, issuer)
    return {"secret": secret, "otpauth_uri": uri, "qr": totp.qr_svg_data_uri(uri)}


@router.post("/2fa/enable")
async def totp_enable(body: TotpEnableIn, auth: Auth, session: DB) -> dict[str, Any]:
    from app.core.redis import redis

    enc = await redis.get(f"totp-setup:{auth.admin.id}")
    if not enc:
        raise ValidationFailed("Setup expired, start again")
    secret = decrypt_str(enc) or ""
    if not totp.verify(secret, body.code):
        raise ValidationFailed("Invalid code — check your authenticator app's time", code="invalid_code")
    codes, hashes = totp.generate_recovery_codes()
    auth.admin.totp_secret_enc = encrypt_str(secret)
    auth.admin.totp_enabled = True
    auth.admin.recovery_codes_hash = hashes
    await redis.delete(f"totp-setup:{auth.admin.id}")
    await audit(session, auth.admin, "auth.2fa_enabled", "Enabled authenticator 2FA", entity_type="admin",
                entity_id=auth.admin.id)
    return {"status": "ok", "recovery_codes": codes}


@router.post("/2fa/disable")
async def totp_disable(body: TotpDisableIn, auth: Auth, session: DB) -> dict[str, str]:
    admin = auth.admin
    if not verify_password(body.password, admin.password_hash) or not auth_service.verify_second_factor(admin, body.code):
        raise ValidationFailed("Invalid password or code")
    admin.totp_enabled = False
    admin.totp_secret_enc = None
    admin.recovery_codes_hash = None
    await audit(session, admin, "auth.2fa_disabled", "Disabled authenticator 2FA", entity_type="admin", entity_id=admin.id)
    return {"status": "ok"}


@router.post("/telegram/link")
async def telegram_link_code(auth: Auth) -> dict[str, Any]:
    code = await auth_service.create_telegram_link_code(auth.admin.id)
    username = None
    try:
        from app.bot.instance import get_bot

        username = (await get_bot().me()).username
    except Exception:
        pass
    return {"code": code, "command": f"/link {code}", "bot_username": username,
            "deep_link": f"https://t.me/{username}" if username else None, "expires_in": 600}


@router.delete("/telegram/link")
async def telegram_unlink(auth: Auth, session: DB) -> dict[str, str]:
    auth.admin.telegram_id = None
    auth.admin.telegram_2fa_enabled = False
    await audit(session, auth.admin, "admin.telegram_unlinked", "Unlinked Telegram account")
    return {"status": "ok"}
