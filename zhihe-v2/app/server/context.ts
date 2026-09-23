import { createContext, type RouterContextProvider } from "react-router";

export interface RequestContext {
  env: Env;
  ctx: ExecutionContext;
  nonce: string;
}

export const requestContext = createContext<RequestContext>();

export function getRequestContext(context: Readonly<RouterContextProvider>): RequestContext {
  return context.get(requestContext);
}
