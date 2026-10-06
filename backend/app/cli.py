"""Management CLI: `python -m app.cli --help`."""

from __future__ import annotations

import asyncio
import getpass
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import typer

from app.core.config import settings

cli = typer.Typer(help="Nexa Commerce management commands", no_args_is_help=True)


def _run(coro):  # type: ignore[no-untyped-def]
    return asyncio.run(coro)


@cli.command("gen-keys")
def gen_keys() -> None:
    """Print freshly generated SECRET_KEY, ENCRYPTION_KEY and TELEGRAM_WEBHOOK_SECRET values."""
    import secrets

    from app.core.crypto import generate_fernet_key

    typer.echo(f"SECRET_KEY={secrets.token_urlsafe(48)}")
    typer.echo(f"ENCRYPTION_KEY={generate_fernet_key()}")
    typer.echo(f"TELEGRAM_WEBHOOK_SECRET={secrets.token_urlsafe(32)}")


@cli.command()
def seed(demo: bool = typer.Option(False, help="Also load demo catalog, customers and orders")) -> None:
    """Seed reference data (roles, permissions, languages, menus, payment methods). Idempotent."""
    from app.core.database import session_scope
    from app.services.seed import seed_core, seed_demo

    async def go() -> None:
        async with session_scope() as s:
            await seed_core(s)
        typer.echo("✓ Core data seeded")
        if demo:
            async with session_scope() as s:
                result = await seed_demo(s)
            typer.echo(f"✓ Demo data: {result}")

    _run(go())


@cli.command("create-admin")
def create_admin(
    email: str = typer.Option(..., prompt=True),
    name: str = typer.Option("Owner", prompt=True),
    role: str = typer.Option("owner", help="owner|administrator|manager|support|content_manager|analyst"),
    password: str = typer.Option(None, help="Omit to be prompted securely"),
) -> None:
    """Create (or reset) an administrator account."""
    from app.core.database import session_scope
    from app.security.passwords import password_problems
    from app.services.seed import create_admin as _create
    from app.services.seed import seed_core

    if not password:
        password = getpass.getpass("Password: ")
        if password != getpass.getpass("Repeat password: "):
            typer.echo("Passwords do not match", err=True)
            raise typer.Exit(1)
    if problems := password_problems(password):
        typer.echo("Password must contain: " + ", ".join(problems), err=True)
        raise typer.Exit(1)

    async def go() -> None:
        async with session_scope() as s:
            await seed_core(s)
            admin = await _create(s, email, name, password, role)
            typer.echo(f"✓ Admin {admin.email} ({role}) ready")

    _run(go())


@cli.command("set-webhook")
def set_webhook(drop_pending: bool = False) -> None:
    """Register the Telegram webhook (production mode)."""
    from app.bot.instance import get_bot

    if not settings.telegram_webhook_url:
        typer.echo("TELEGRAM_WEBHOOK_URL is not set", err=True)
        raise typer.Exit(1)

    async def go() -> None:
        from app.bot.factory import ALLOWED_UPDATES

        bot = get_bot()
        ok = await bot.set_webhook(settings.telegram_webhook_url,
                                   secret_token=settings.telegram_webhook_secret.get_secret_value() or None,
                                   allowed_updates=ALLOWED_UPDATES, drop_pending_updates=drop_pending)
        info = await bot.get_webhook_info()
        typer.echo(f"✓ set_webhook={ok} url={info.url} pending={info.pending_update_count}")
        await bot.session.close()

    _run(go())


@cli.command("delete-webhook")
def delete_webhook() -> None:
    """Remove the Telegram webhook (switch back to polling)."""
    from app.bot.instance import get_bot

    async def go() -> None:
        bot = get_bot()
        await bot.delete_webhook()
        await bot.session.close()
        typer.echo("✓ Webhook removed")

    _run(go())


def _pg_env() -> tuple[list[str], dict[str, str]]:
    from sqlalchemy.engine import make_url

    url = make_url(settings.database_url)
    env = {**os.environ, "PGPASSWORD": url.password or ""}
    args = ["-h", url.host or "localhost", "-p", str(url.port or 5432), "-U", url.username or "postgres"]
    return [*args, url.database or "postgres"], env


@cli.command()
def backup(output: Path = typer.Option(None, help="Output file (.dump)")) -> None:
    """Create a compressed PostgreSQL backup (pg_dump custom format)."""
    Path(settings.backup_dir).mkdir(parents=True, exist_ok=True)
    out = output or Path(settings.backup_dir) / f"nexa-{datetime.now():%Y%m%d-%H%M%S}.dump"
    args, env = _pg_env()
    cmd = ["pg_dump", "-Fc", "--no-owner", "-f", str(out), *args[:-1], args[-1]]
    subprocess.run(cmd, check=True, env=env)
    typer.echo(f"✓ Backup written to {out} ({out.stat().st_size // 1024} KB)")


@cli.command()
def restore(file: Path, yes: bool = typer.Option(False, "--yes", help="Skip confirmation")) -> None:
    """Restore a backup created with `backup` (DESTRUCTIVE: replaces current data)."""
    if not yes and not typer.confirm(f"Restore {file}? Current data will be overwritten."):
        raise typer.Exit(1)
    args, env = _pg_env()
    cmd = ["pg_restore", "--clean", "--if-exists", "--no-owner", "-d", args[-1], *args[:-1], str(file)]
    subprocess.run(cmd, check=True, env=env)
    typer.echo("✓ Restore complete")


@cli.command("prune-backups")
def prune_backups(days: int = 14) -> None:
    """Delete backups older than N days."""
    import time

    cutoff = time.time() - days * 86400
    removed = 0
    for f in Path(settings.backup_dir).glob("nexa-*.dump"):
        if f.stat().st_mtime < cutoff:
            f.unlink()
            removed += 1
    typer.echo(f"✓ Removed {removed} old backup(s)")


if __name__ == "__main__":
    sys.exit(cli())
