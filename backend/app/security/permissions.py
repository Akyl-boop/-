"""Fine-grained permission catalog and default roles (RBAC)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PermissionDef:
    code: str
    name: str
    group: str


PERMISSIONS: list[PermissionDef] = [
    PermissionDef("dashboard.view", "View dashboard", "Analytics"),
    PermissionDef("revenue.view", "View revenue & financial data", "Analytics"),
    PermissionDef("analytics.view", "View analytics", "Analytics"),
    PermissionDef("analytics.export", "Export analytics", "Analytics"),
    PermissionDef("orders.view", "View orders", "Orders"),
    PermissionDef("orders.manage", "Manage orders (notes, resend, cancel)", "Orders"),
    PermissionDef("orders.mark_paid", "Mark orders as paid manually", "Orders"),
    PermissionDef("orders.refund", "Process refunds", "Orders"),
    PermissionDef("products.view", "View products", "Catalog"),
    PermissionDef("products.edit", "Create & edit products", "Catalog"),
    PermissionDef("products.delete", "Delete products", "Catalog"),
    PermissionDef("categories.edit", "Manage categories", "Catalog"),
    PermissionDef("inventory.view", "View inventory", "Inventory"),
    PermissionDef("inventory.manage", "Manage inventory", "Inventory"),
    PermissionDef("inventory.reveal", "Reveal inventory secrets", "Inventory"),
    PermissionDef("customers.view", "View customers", "Customers"),
    PermissionDef("customers.edit", "Edit customers (notes, tags, message)", "Customers"),
    PermissionDef("customers.ban", "Ban customers", "Customers"),
    PermissionDef("customers.balance", "Adjust customer balance", "Customers"),
    PermissionDef("payments.view", "View payments", "Payments"),
    PermissionDef("payments.edit", "Edit payment configuration", "Payments"),
    PermissionDef("promo.manage", "Manage promo codes", "Marketing"),
    PermissionDef("referrals.manage", "Manage referral program", "Marketing"),
    PermissionDef("broadcasts.send", "Create & send broadcasts", "Marketing"),
    PermissionDef("reviews.manage", "Moderate reviews", "Marketing"),
    PermissionDef("support.view", "View support tickets", "Support"),
    PermissionDef("support.reply", "Reply to tickets", "Support"),
    PermissionDef("content.edit", "Edit bot content, menus, pages", "Content"),
    PermissionDef("media.manage", "Manage media library", "Content"),
    PermissionDef("languages.manage", "Manage languages & translations", "Content"),
    PermissionDef("settings.edit", "Edit settings", "System"),
    PermissionDef("integrations.manage", "Manage integrations & webhooks", "System"),
    PermissionDef("notifications.manage", "Configure notifications", "System"),
    PermissionDef("audit.view", "View audit logs", "System"),
    PermissionDef("system.view", "View system health", "System"),
    PermissionDef("admins.manage", "Manage administrators & roles", "System"),
]

ALL_CODES = [p.code for p in PERMISSIONS]

_VIEW = [c for c in ALL_CODES if c.endswith(".view")]

DEFAULT_ROLES: dict[str, dict] = {
    "owner": {"name": "Owner", "color": "#f59e0b", "permissions": ALL_CODES,
              "description": "Full control of the store"},
    "administrator": {
        "name": "Administrator", "color": "#8b5cf6",
        "permissions": [c for c in ALL_CODES if c not in ("admins.manage",)],
        "description": "Everything except managing administrators",
    },
    "manager": {
        "name": "Manager", "color": "#3b82f6",
        "permissions": [
            "dashboard.view", "revenue.view", "analytics.view", "orders.view", "orders.manage", "orders.mark_paid",
            "products.view", "products.edit", "categories.edit", "inventory.view", "inventory.manage",
            "customers.view", "customers.edit", "customers.ban", "payments.view", "promo.manage",
            "referrals.manage", "broadcasts.send", "reviews.manage", "support.view", "support.reply",
            "media.manage",
        ],
        "description": "Runs day-to-day store operations",
    },
    "support": {
        "name": "Support", "color": "#10b981",
        "permissions": ["dashboard.view", "orders.view", "orders.manage", "customers.view", "customers.edit",
                        "support.view", "support.reply", "products.view"],
        "description": "Handles customer conversations and orders",
    },
    "content_manager": {
        "name": "Content Manager", "color": "#ec4899",
        "permissions": ["dashboard.view", "products.view", "products.edit", "categories.edit", "content.edit",
                        "media.manage", "languages.manage", "broadcasts.send", "reviews.manage"],
        "description": "Edits bot texts, menus, media and catalog content",
    },
    "analyst": {
        "name": "Analyst", "color": "#06b6d4",
        "permissions": [*_VIEW, "analytics.export"],
        "description": "Read-only access to data and analytics",
    },
}
