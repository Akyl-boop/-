import { useRouteLoaderData } from "react-router";
import type { loader } from "~/root";

export type RootData = Awaited<ReturnType<typeof loader>>;

export function useRootData(): RootData {
  return useRouteLoaderData("root") as RootData;
}
