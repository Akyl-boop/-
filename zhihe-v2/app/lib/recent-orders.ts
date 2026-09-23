const STORAGE_KEY = "zh_orders";
const MAX_ENTRIES = 30;

export interface RecentOrder {
  number: string;
  key: string;
  product: string;
  total: string;
  status: string;
  createdAt: number;
}

export function readRecentOrders(): RecentOrder[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as RecentOrder[]) : [];
    return Array.isArray(list) ? list.filter((entry) => entry && typeof entry.number === "string" && typeof entry.key === "string") : [];
  } catch {
    return [];
  }
}

export function rememberOrder(entry: RecentOrder): void {
  try {
    const list = readRecentOrders().filter((item) => item.number !== entry.number);
    list.unshift(entry);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    // Storage unavailable (private mode) — the order link itself still works.
  }
}

export function forgetOrder(number: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(readRecentOrders().filter((item) => item.number !== number)));
  } catch {
    // ignore
  }
}
