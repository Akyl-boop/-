import { createRequestHandler, RouterContextProvider } from "react-router";
import { requestContext } from "~/server/context";
import { isSafeMethod, isSameOriginRequest } from "~/server/http.server";
import { runMaintenance } from "~/server/maintenance.server";
import { serveMedia } from "~/server/media.server";

const handleRequest = createRequestHandler(() => import("virtual:react-router/server-build"), import.meta.env.MODE);

const CSRF_EXEMPT_PREFIXES = ["/api/webhooks/"];

function securityHeaders(response: Response, nonce: string, url: URL): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  const contentType = headers.get("content-type") ?? "";
  if (import.meta.env.PROD && contentType.includes("text/html")) {
    headers.set(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self' https://t.me https://*.crypt.bot",
        "object-src 'none'",
      ].join("; "),
    );
  }
  if (url.pathname.startsWith("/admin") || url.pathname.startsWith("/order/")) {
    headers.set("Cache-Control", "no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (!isSafeMethod(request.method) && !CSRF_EXEMPT_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) && !isSameOriginRequest(request)) {
      return new Response("Cross-site request rejected", { status: 403 });
    }

    if (url.pathname.startsWith("/media/") && (request.method === "GET" || request.method === "HEAD")) {
      return serveMedia(env, request, url.pathname.slice("/media/".length));
    }

    const nonce = crypto.randomUUID().replace(/-/g, "");
    const context = new RouterContextProvider();
    context.set(requestContext, { env, ctx, nonce });
    const response = await handleRequest(request, context);
    return securityHeaders(response, nonce, url);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runMaintenance(env, ctx));
  },
} satisfies ExportedHandler<Env>;
