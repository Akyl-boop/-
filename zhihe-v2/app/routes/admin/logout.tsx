import { redirect } from "react-router";
import { logout } from "~/server/auth.server";
import { getRequestContext } from "~/server/context";
import type { Route } from "./+types/logout";

export async function action({ request, context }: Route.ActionArgs) {
  const { env } = getRequestContext(context);
  const cookie = await logout(env.DB, request);
  throw redirect("/admin/login", { headers: { "Set-Cookie": cookie } });
}

export function loader() {
  throw redirect("/admin");
}
