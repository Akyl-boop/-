"""Administrator authentication: password login, lockout, sessions, 2FA (TOTP / Telegram approval), resets."""

from __future__ import annotations

import re
import secrets
from datetime import timedelta
from typing import Any

import orjson
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.crypto import decrypt_str, sha256_hex
from app.core.errors import Forbidden, NotFound, RateLimited, Unauthorized, ValidationFailed
from app.core.logging import get_logger
from app.core.redis import redis
from app.core.utils import utcnow
from app.models import Admin, AdminSession, PasswordResetToken
from app.security import totp
from app.security.passwords import hash_password, needs_rehash, password_problems, verify_password
from app.security.ratelimit import hit
from app.services.audit import audit
from app.services.settings import settings_store

log = get_logger(__name__)
CHALLENGE_TTL = 300


def describe_device(ua: str | None) -> str:
    ua = ua or ""
    os_ = next((name for pat, name in [(r"iPhone|iPad", "iOS"), (r"Android", "Android"), (r"Mac OS X", "macOS"),
                                       (r"Windows", "Windows"), (r"Linux", "Linux")] if re.search(pat, ua)), "Unknown OS")
    browser = next((name for pat, name in [(r"Edg/", "Edge"), (r"OPR/", "Opera"), (r"Chrome/", "Chrome"),
                                           (r"Firefox/", "Firefox"), (r"Safari/", "Safari")] if re.search(pat, ua)),
                   "Browser")
    return f"{browser} · {os_}"


async def authenticate(session: AsyncSession, email: str, password: str, ip: str) -> Admin:
    email = email.strip().lower()
    ok_ip, _ = await hit(f"login-ip:{ip}", 20, 900)
    ok_email, _ = await hit(f"login-email:{email}", 10, 900)
    if not ok_ip or not ok_email:
        raise RateLimited("Too many login attempts. Try again later.")
    admin = (await session.execute(select(Admin).where(func.lower(Admin.email) == email))).scalar_one_or_none()
    now = utcnow()
    if admin is not None and admin.locked_until and admin.locked_until > now:
        mins = int((admin.locked_until - now).total_seconds() // 60) + 1
        raise Forbidden(f"Account temporarily locked. Try again in {mins} min.", code="account_locked")
    if not verify_password(password, admin.password_hash if admin else None) or admin is None:
        if admin is not None:
            # Bookkeeping must survive the request's rollback → separate unit of work.
            from app.core.database import session_scope

            async with session_scope() as s2:
                a2 = (await s2.execute(select(Admin).where(Admin.id == admin.id).with_for_update(of=Admin))).scalar_one_or_none()
                if a2 is not None:
                    a2.failed_logins += 1
                    if a2.failed_logins >= settings.login_max_attempts:
                        a2.locked_until = now + timedelta(minutes=settings.login_lockout_minutes)
                        a2.failed_logins = 0
                        await audit(s2, a2, "auth.locked", f"Account locked after failed logins from {ip}",
                                    entity_type="admin", entity_id=a2.id, ip=ip)
                    await audit(s2, a2, "auth.login_failed", f"Failed login for {email}", entity_type="admin",
                                entity_id=a2.id, ip=ip)
        log.info("login_failed", email=email, ip=ip)
        raise Unauthorized("Invalid email or password", code="invalid_credentials")
    if not admin.is_active:
        raise Forbidden("This account is disabled", code="account_disabled")
    sec = await settings_store.group("security")
    if sec.get("ip_allowlist") and ip not in sec["ip_allowlist"]:
        await audit(session, admin, "auth.ip_blocked", f"Login blocked from non-allowlisted IP {ip}", ip=ip)
        raise Forbidden("Sign-in from this IP address is not allowed", code="ip_not_allowed")
    if needs_rehash(admin.password_hash):
        admin.password_hash = hash_password(password)
    admin.failed_logins = 0
    return admin


def second_factors(admin: Admin) -> list[str]:
    methods = []
    if admin.totp_enabled:
        methods.append("totp")
    if admin.telegram_2fa_enabled and admin.telegram_id:
        methods.append("telegram")
    return methods


async def create_challenge(admin: Admin, ip: str, ua: str | None) -> str:
    cid = secrets.token_urlsafe(24)
    await redis.set(f"login-challenge:{cid}", orjson.dumps({"admin_id": admin.id, "ip": ip, "ua": ua, "tg": "pending"}),
                    ex=CHALLENGE_TTL)
    return cid


async def get_challenge(cid: str) -> dict[str, Any]:
    raw = await redis.get(f"login-challenge:{cid}")
    if not raw:
        raise Unauthorized("Sign-in request expired. Please sign in again.", code="challenge_expired")
    return orjson.loads(raw)


async def consume_challenge(cid: str) -> None:
    await redis.delete(f"login-challenge:{cid}")


async def set_telegram_decision(cid: str, approved: bool) -> bool:
    key = f"login-challenge:{cid}"
    raw = await redis.get(key)
    if not raw:
        return False
    data = orjson.loads(raw)
    data["tg"] = "approved" if approved else "denied"
    ttl = await redis.ttl(key)
    await redis.set(key, orjson.dumps(data), ex=max(ttl, 30))
    return True


async def send_telegram_approval(admin: Admin, cid: str, ip: str, ua: str | None) -> None:
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

    from app.bot.instance import get_bot
    from app.services.texts import t

    markup = InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(text="✅ Approve", callback_data=f"adm:ok:{cid}"[:64], style="success"),
        InlineKeyboardButton(text="✕ Deny", callback_data=f"adm:no:{cid}"[:64], style="danger"),
    ]])
    text = await t("admin.login_approval", "en", email=admin.email, ip=ip, device=describe_device(ua))
    await get_bot().send_message(admin.telegram_id, text, reply_markup=markup)


def verify_second_factor(admin: Admin, code: str) -> bool:
    code = (code or "").strip()
    if admin.totp_enabled and admin.totp_secret_enc:
        secret = decrypt_str(admin.totp_secret_enc) or ""
        if totp.verify(secret, code):
            return True
    # Recovery codes (single use)
    hashes = list(admin.recovery_codes_hash or [])
    h = sha256_hex(code.lower())
    if h in hashes:
        hashes.remove(h)
        admin.recovery_codes_hash = hashes
        return True
    return False


async def create_session(session: AsyncSession, admin: Admin, ip: str, ua: str | None) -> tuple[str, AdminSession]:
    token = secrets.token_urlsafe(48)
    now = utcnow()
    s = AdminSession(admin_id=admin.id, token_hash=sha256_hex(token), ip=ip, user_agent=(ua or "")[:500],
                     device=describe_device(ua), expires_at=now + timedelta(hours=settings.session_ttl_hours),
                     last_seen_at=now, created_at=now)
    session.add(s)
    admin.last_login_at = now
    admin.last_login_ip = ip
    await session.flush()
    await audit(session, admin, "auth.login", f"Signed in from {describe_device(ua)}", entity_type="admin",
                entity_id=admin.id, ip=ip, user_agent=ua)
    return token, s


async def revoke_sessions(session: AsyncSession, admin_id: int, *, except_id: Any = None) -> int:
    q = update(AdminSession).where(AdminSession.admin_id == admin_id, AdminSession.revoked_at.is_(None))
    if except_id is not None:
        q = q.where(AdminSession.id != except_id)
    res = await session.execute(q.values(revoked_at=utcnow()).returning(AdminSession.id))
    return len(res.all())


async def start_password_reset(session: AsyncSession, email: str, ip: str) -> str | None:
    """Create a reset token and e-mail it. Always behaves the same for unknown e-mails (no enumeration)."""
    ok, _ = await hit(f"reset:{ip}", 5, 3600)
    if not ok:
        raise RateLimited("Too many reset requests")
    admin = (await session.execute(select(Admin).where(func.lower(Admin.email) == email.strip().lower()))).scalar_one_or_none()
    if admin is None or not admin.is_active:
        return None
    token = secrets.token_urlsafe(32)
    session.add(PasswordResetToken(admin_id=admin.id, token_hash=sha256_hex(token), expires_at=utcnow() + timedelta(hours=1)))
    link = f"{settings.public_url.rstrip('/')}/reset-password?token={token}"
    from app.services.notifications import send_email

    sent = await send_email([admin.email], "Reset your dashboard password",
                            f"Hi {admin.name},\n\nUse this link to set a new password (valid for 1 hour):\n{link}\n\n"
                            "If you didn't request this, ignore this e-mail.")
    if not sent and admin.telegram_id:
        from app.bot.notify import send_text

        await send_text(admin.telegram_id, f"🔐 Password reset link (valid 1 hour):\n{link}")
    await audit(session, admin, "auth.reset_requested", "Password reset requested", entity_type="admin",
                entity_id=admin.id, ip=ip)
    return token


async def complete_password_reset(session: AsyncSession, token: str, password: str) -> Admin:
    row = (await session.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == sha256_hex(token))
                                 .with_for_update())).scalar_one_or_none()
    if row is None or row.used_at is not None or row.expires_at < utcnow():
        raise ValidationFailed("This reset link is invalid or has expired", code="invalid_token")
    if problems := password_problems(password):
        raise ValidationFailed("Password must contain " + ", ".join(problems))
    admin = await session.get(Admin, row.admin_id)
    if admin is None:
        raise NotFound("Account not found")
    admin.password_hash = hash_password(password)
    admin.password_changed_at = utcnow()
    admin.locked_until = None
    admin.failed_logins = 0
    row.used_at = utcnow()
    await revoke_sessions(session, admin.id)
    await audit(session, admin, "auth.password_reset", "Password reset via link", entity_type="admin", entity_id=admin.id)
    return admin


async def create_telegram_link_code(admin_id: int) -> str:
    code = secrets.token_hex(4).upper()
    await redis.set(f"tg-link:{code}", str(admin_id), ex=600)
    return code


async def consume_telegram_link_code(code: str) -> int | None:
    key = f"tg-link:{code.strip().upper()}"
    value = await redis.get(key)
    if value:
        await redis.delete(key)
        return int(value)
    return None
