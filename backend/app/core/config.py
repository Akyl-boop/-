"""Application configuration loaded from environment variables.

Only *infrastructure* configuration lives here (database URLs, secrets, ports).
Everything a store owner may want to change at runtime (texts, payment methods,
feature flags, branding…) lives in the database and is edited from the dashboard.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ── Application ──────────────────────────────────────────────────────────
    app_name: str = "Nexa Commerce"
    app_version: str = "1.0.0"
    environment: Literal["development", "production", "test"] = "development"
    debug: bool = False
    log_level: str = "INFO"
    log_json: bool = True

    # Public URL of the dashboard/API (used for webhooks, password reset links…)
    public_url: str = "http://localhost:3000"
    api_prefix: str = "/api"
    cors_origins: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["http://localhost:3000"])

    # ── Security ─────────────────────────────────────────────────────────────
    # Secret used to sign tokens. MUST be long and random in production.
    secret_key: SecretStr = SecretStr("dev-insecure-secret-change-me-dev-insecure-secret")
    # Fernet key (urlsafe base64, 32 bytes) used to encrypt secrets at rest.
    encryption_key: SecretStr = SecretStr("")
    session_cookie_name: str = "nexa_sid"
    csrf_cookie_name: str = "nexa_csrf"
    session_ttl_hours: int = 24 * 7
    session_idle_timeout_hours: int = 24 * 2
    cookie_secure: bool = False
    cookie_domain: str | None = None
    login_max_attempts: int = 5
    login_lockout_minutes: int = 15
    api_rate_limit_per_minute: int = 300
    trusted_proxies: Annotated[list[str], NoDecode] = Field(default_factory=lambda: ["127.0.0.1", "172.16.0.0/12", "10.0.0.0/8"])

    # ── Database / Redis ─────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://shop:shop@localhost:5432/shop"
    database_pool_size: int = 10
    database_max_overflow: int = 20
    database_echo: bool = False
    redis_url: str = "redis://localhost:6379/0"

    # ── Telegram ─────────────────────────────────────────────────────────────
    bot_token: SecretStr = SecretStr("")
    bot_mode: Literal["polling", "webhook"] = "polling"
    # Random path segment + secret token header for the Telegram webhook.
    telegram_webhook_secret: SecretStr = SecretStr("")
    telegram_webhook_url: str | None = None  # e.g. https://shop.example.com/telegram/webhook
    telegram_api_server: str | None = None  # optional local Bot API server

    # ── Payments ─────────────────────────────────────────────────────────────
    payment_webhook_base_url: str | None = None  # defaults to public_url

    # ── Storage ──────────────────────────────────────────────────────────────
    media_root: str = "./storage/media"
    max_upload_mb: int = 50
    backup_dir: str = "./storage/backups"

    # ── Email (password reset / notifications) ───────────────────────────────
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: str = "Nexa Commerce <no-reply@example.com>"
    smtp_starttls: bool = True

    @field_validator("cors_origins", "trusted_proxies", mode="before")
    @classmethod
    def _split_csv(cls, v: object) -> object:
        if isinstance(v, str) and not v.strip().startswith("["):
            return [s.strip() for s in v.split(",") if s.strip()]
        return v

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def webhook_base(self) -> str:
        return (self.payment_webhook_base_url or self.public_url).rstrip("/")

    def validate_production(self) -> list[str]:
        """Return a list of configuration problems that must be fixed before running in production."""
        problems: list[str] = []
        if self.is_production:
            if "insecure" in self.secret_key.get_secret_value() or len(self.secret_key.get_secret_value()) < 32:
                problems.append("SECRET_KEY must be a random string of at least 32 characters")
            if not self.encryption_key.get_secret_value():
                problems.append("ENCRYPTION_KEY must be set (generate with `python -m app.cli gen-keys`)")
            if not self.cookie_secure:
                problems.append("COOKIE_SECURE must be true behind HTTPS")
            if self.bot_mode == "webhook" and not self.telegram_webhook_secret.get_secret_value():
                problems.append("TELEGRAM_WEBHOOK_SECRET is required in webhook mode")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
