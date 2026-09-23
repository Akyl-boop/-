import { getRequestContext } from "~/server/context";
import { queryValue } from "~/server/db.server";
import { getOrderByAccessKey } from "~/server/orders.server";
import type { Route } from "./+types/order-status";

export async function loader({ request, params, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const order = await getOrderByAccessKey(env, params.number, new URL(request.url).searchParams.get("key"));
  if (!order) return Response.json({ error: "not_found" }, { status: 404 });
  const delivered = (await queryValue<number>(env.DB, "SELECT COALESCE(SUM(delivered_quantity), 0) FROM order_items WHERE order_id = ?", order.id)) ?? 0;
  return Response.json({ status: order.status, delivered }, { headers: { "Cache-Control": "no-store" } });
}
