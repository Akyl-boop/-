import {
  Activity, BarChart3, Bell, Bot, Boxes, CreditCard, FileText, FolderTree, Gift, Globe2, Image, LayoutDashboard,
  LifeBuoy, Megaphone, Package, Plug, ScrollText, Settings, ShieldCheck, ShoppingBag, Tag, Users,
  type LucideIcon,
} from "lucide-react";

export interface NavItem { href: string; label: string; icon: LucideIcon; perm?: string; keywords?: string }
export interface NavGroup { label: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { label: "Overview", items: [
    { href: "/", label: "Dashboard", icon: LayoutDashboard, perm: "dashboard.view" },
    { href: "/analytics", label: "Analytics", icon: BarChart3, perm: "analytics.view", keywords: "reports revenue" },
  ] },
  { label: "Commerce", items: [
    { href: "/orders", label: "Orders", icon: ShoppingBag, perm: "orders.view" },
    { href: "/products", label: "Products", icon: Package, perm: "products.view" },
    { href: "/categories", label: "Categories", icon: FolderTree, perm: "products.view" },
    { href: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory.view", keywords: "stock keys codes" },
    { href: "/customers", label: "Customers", icon: Users, perm: "customers.view", keywords: "crm users" },
    { href: "/payments", label: "Payments", icon: CreditCard, perm: "payments.view", keywords: "crypto methods transactions" },
  ] },
  { label: "Growth", items: [
    { href: "/promo-codes", label: "Promo Codes", icon: Tag, perm: "promo.manage", keywords: "discounts coupons" },
    { href: "/marketing", label: "Marketing", icon: Megaphone, perm: "broadcasts.send", keywords: "broadcasts reviews campaigns" },
    { href: "/referrals", label: "Referrals", icon: Gift, perm: "referrals.manage" },
    { href: "/notifications", label: "Notifications", icon: Bell, keywords: "alerts" },
  ] },
  { label: "Content", items: [
    { href: "/bot-editor", label: "Bot Editor", icon: Bot, perm: "content.edit", keywords: "texts menu buttons banners emoji" },
    { href: "/pages", label: "Pages", icon: FileText, perm: "content.edit", keywords: "faq terms help" },
    { href: "/languages", label: "Languages", icon: Globe2, perm: "dashboard.view", keywords: "translations" },
    { href: "/media", label: "Media Library", icon: Image, perm: "media.manage", keywords: "banners images files" },
  ] },
  { label: "Operations", items: [
    { href: "/support", label: "Support", icon: LifeBuoy, perm: "support.view", keywords: "tickets" },
    { href: "/audit-logs", label: "Audit Logs", icon: ScrollText, perm: "audit.view" },
    { href: "/administrators", label: "Administrators", icon: ShieldCheck, perm: "admins.manage", keywords: "roles permissions team" },
    { href: "/settings", label: "Settings", icon: Settings, keywords: "store checkout features maintenance branding" },
    { href: "/integrations", label: "Integrations", icon: Plug, perm: "integrations.manage", keywords: "webhooks api keys" },
    { href: "/system", label: "System", icon: Activity, perm: "system.view", keywords: "health status backups" },
  ] },
];
