import { data } from "react-router";

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
}

export function userAgent(request: Request): string {
  return (request.headers.get("user-agent") ?? "").slice(0, 300);
}

export function notFound(): never {
  throw data(null, { status: 404, statusText: "Not Found" });
}

export function badRequest<T>(payload: T) {
  return data(payload, { status: 400 });
}

export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/**
 * Rejects cross-site state-changing requests. Browsers always send Origin on
 * POST/PUT/PATCH/DELETE, and Sec-Fetch-Site on modern engines.
 */
export function isSameOriginRequest(request: Request): boolean {
  const url = new URL(request.url);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return false;
  const origin = request.headers.get("origin");
  if (!origin) return site === "same-origin";
  return origin === url.origin;
}
