import { getRequestContext } from "~/server/context";
import type { Route } from "./+types/robots";

export function loader({ context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const site = env.SITE_URL.replace(/\/$/, "");
  const body = ["User-agent: *", "Allow: /", "Disallow: /admin", "Disallow: /api/", "Disallow: /checkout/", "Disallow: /order/", "Disallow: /orders", "", `Sitemap: ${site}/sitemap.xml`, ""].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
