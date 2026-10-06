"""Domain enumerations (stored as strings)."""

from app.models.base import StrEnum


class ProductStatus(StrEnum):
    ACTIVE = "active"
    DRAFT = "draft"
    HIDDEN = "hidden"
    OUT_OF_STOCK = "out_of_stock"
    ARCHIVED = "archived"


class StockMode(StrEnum):
    INVENTORY = "inventory"  # count of available inventory items
    UNLIMITED = "unlimited"
    MANUAL = "manual"  # manually maintained counter


class DeliveryMode(StrEnum):
    INVENTORY = "inventory"  # automatic delivery of inventory items
    MANUAL = "manual"  # admin delivers manually
    API = "api"  # call external API to obtain the goods
    WEBHOOK = "webhook"  # notify external system; it calls back with the goods
    FILE = "file"  # deliver a static file from the media library
    TEXT = "text"  # deliver a static text / link / code


class InventoryStatus(StrEnum):
    AVAILABLE = "available"
    RESERVED = "reserved"
    DELIVERED = "delivered"
    INVALID = "invalid"
    DISABLED = "disabled"


class InventoryKind(StrEnum):
    CODE = "code"
    LICENSE_KEY = "license_key"
    CREDENTIALS = "credentials"
    TEXT = "text"
    LINK = "link"
    FILE = "file"
    CUSTOM = "custom"


class OrderStatus(StrEnum):
    PENDING = "pending"  # created, payment not yet started
    AWAITING_PAYMENT = "awaiting_payment"
    AWAITING_CONFIRMATION = "awaiting_confirmation"  # payment detected / manual check
    PAID = "paid"
    PROCESSING = "processing"  # fulfillment in progress / awaiting manual delivery
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    FAILED = "failed"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"


PAID_ORDER_STATUSES = (
    OrderStatus.PAID,
    OrderStatus.PROCESSING,
    OrderStatus.COMPLETED,
    OrderStatus.PARTIALLY_REFUNDED,
)
OPEN_ORDER_STATUSES = (OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT, OrderStatus.AWAITING_CONFIRMATION)


class DeliveryStatus(StrEnum):
    PENDING = "pending"
    PARTIAL = "partial"
    DELIVERED = "delivered"
    MANUAL = "manual"  # waiting for admin
    FAILED = "failed"


class PaymentStatus(StrEnum):
    PENDING = "pending"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    PAID = "paid"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    FAILED = "failed"
    REFUNDED = "refunded"
    PARTIALLY_REFUNDED = "partially_refunded"


FINAL_PAYMENT_STATUSES = (
    PaymentStatus.PAID,
    PaymentStatus.EXPIRED,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
    PaymentStatus.REFUNDED,
    PaymentStatus.PARTIALLY_REFUNDED,
)


class PromoType(StrEnum):
    PERCENT = "percent"
    FIXED = "fixed"


class TicketStatus(StrEnum):
    OPEN = "open"
    WAITING_CUSTOMER = "waiting_customer"
    WAITING_ADMIN = "waiting_admin"
    RESOLVED = "resolved"
    CLOSED = "closed"


class TicketPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class BroadcastStatus(StrEnum):
    DRAFT = "draft"
    SCHEDULED = "scheduled"
    SENDING = "sending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


class RecipientStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    BLOCKED = "blocked"


class MediaKind(StrEnum):
    IMAGE = "image"
    ANIMATION = "animation"
    VIDEO = "video"
    STICKER = "sticker"
    DOCUMENT = "document"


class BalanceTxType(StrEnum):
    DEPOSIT = "deposit"
    PURCHASE = "purchase"
    REFUND = "refund"
    REFERRAL = "referral"
    ADJUSTMENT = "adjustment"


class ReviewStatus(StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    HIDDEN = "hidden"
