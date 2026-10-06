/** Thin fetch wrapper: same-origin cookies, CSRF header on mutations, typed errors. */

export class ApiError extends Error {
  status: number;
  code: string;
  details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/(?:^|;\s*)nexa_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : undefined;
}

type Query = Record<string, string | number | boolean | null | undefined>;

export function qs(params?: Query): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

async function request<T>(method: string, path: string, body?: unknown, opts: { query?: Query; raw?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") {
    const token = csrfToken();
    if (token) headers["X-CSRF-Token"] = token;
  }
  const res = await fetch(`/api${path}${qs(opts.query)}`, { method, headers, body: payload, credentials: "same-origin" });
  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/")) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login?next=${next}`;
  }
  if (!res.ok) {
    let code = "http_error";
    let message = res.statusText || "Request failed";
    let details: unknown;
    try {
      const data = await res.json();
      code = data?.error?.code ?? code;
      message = data?.error?.message ?? message;
      details = data?.error?.details;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(res.status, code, message, details);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, { query }),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>("POST", path, body ?? {}, { query }),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
  del: <T>(path: string, query?: Query) => request<T>("DELETE", path, undefined, { query }),
  upload: <T>(path: string, form: FormData) => request<T>("POST", path, form),
};

/** Trigger a file download for an authenticated GET endpoint (CSV exports, backups). */
export function download(path: string, query?: Query) {
  const a = document.createElement("a");
  a.href = `/api${path}${qs(query)}`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong";
}
