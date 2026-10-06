"""ORM models. Importing this package registers every table on Base.metadata."""

from app.models.admin import Admin, AdminSession, PasswordResetToken, Permission, Role, role_permissions
from app.models.base import Base
from app.models.catalog import Banner, Category, Media, Product, ProductVariant, Review
from app.models.commerce import (
    Cart,
    CartItem,
    CryptoAddress,
    InventoryEvent,
    InventoryItem,
    Order,
    OrderEvent,
    OrderItem,
    Payment,
    PaymentMethod,
    PromoCode,
    PromoUsage,
    Refund,
)
from app.models.customer import (
    BalanceTransaction,
    CustomerEvent,
    CustomerNote,
    CustomerTag,
    Favorite,
    ProductView,
    Referral,
    ReferralReward,
    RestockSubscription,
    User,
    user_tags,
)
from app.models.system import (
    AuditLog,
    Broadcast,
    BroadcastRecipient,
    FaqItem,
    Language,
    MenuButton,
    Notification,
    NotificationRead,
    Page,
    Setting,
    Ticket,
    TicketMessage,
    Translation,
    WebhookDelivery,
    WebhookEndpoint,
    WebhookEvent,
)

__all__ = [
    "Admin", "AdminSession", "AuditLog", "BalanceTransaction", "Banner", "Base", "Broadcast",
    "BroadcastRecipient", "Cart", "CartItem", "Category", "CryptoAddress", "CustomerEvent", "CustomerNote",
    "CustomerTag", "FaqItem", "Favorite", "InventoryEvent", "InventoryItem", "Language", "Media", "MenuButton",
    "Notification", "NotificationRead", "Order", "OrderEvent", "OrderItem", "Page", "PasswordResetToken",
    "Payment", "PaymentMethod", "Permission", "Product", "ProductVariant", "ProductView", "PromoCode",
    "PromoUsage", "Referral", "ReferralReward", "Refund", "RestockSubscription", "Review", "Role", "Setting",
    "Ticket", "TicketMessage", "Translation", "User", "WebhookDelivery", "WebhookEndpoint", "WebhookEvent",
    "role_permissions", "user_tags",
]
