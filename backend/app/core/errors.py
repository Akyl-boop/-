"""Domain errors and their HTTP mapping."""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    status_code = 400
    code = "bad_request"

    def __init__(self, message: str = "", *, code: str | None = None, details: Any = None) -> None:
        super().__init__(message or self.__class__.__name__)
        self.message = message or self.code.replace("_", " ").capitalize()
        if code:
            self.code = code
        self.details = details


class NotFound(AppError):
    status_code = 404
    code = "not_found"


class Conflict(AppError):
    status_code = 409
    code = "conflict"


class Forbidden(AppError):
    status_code = 403
    code = "forbidden"


class Unauthorized(AppError):
    status_code = 401
    code = "unauthorized"


class ValidationFailed(AppError):
    status_code = 422
    code = "validation_failed"


class RateLimited(AppError):
    status_code = 429
    code = "rate_limited"


class ServiceUnavailable(AppError):
    status_code = 503
    code = "service_unavailable"


class PaymentError(AppError):
    code = "payment_error"


class OutOfStock(AppError):
    status_code = 409
    code = "out_of_stock"


class PromoError(AppError):
    code = "promo_invalid"
