import { getRequestContext } from "~/server/context";
import { handleCryptoBotWebhook } from "~/server/payments/confirm.server";
import type { Route } from "./+types/webhook-cryptobot";

export async function action({ request, context }: Route.ActionArgs) {
  const { env, ctx } = getRequestContext(context);
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  try {
    const outcome = await handleCryptoBotWebhook(env, ctx, request);
    return new Response(outcome.body, { status: outcome.status, headers: { "Content-Type": "text/plain" } });
  } catch (error) {
    console.error("cryptobot webhook failed", error);
    // Non-2xx makes CryptoBot retry; processing is idempotent.
    return new Response("error", { status: 500 });
  }
}

export function loader() {
  return new Response("Method not allowed", { status: 405 });
}
