"use client";

import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as React from "react";
import { Toaster, toast } from "sonner";
import { ConfirmProvider } from "@/components/ui/confirm";
import { TooltipProvider } from "@/components/ui/misc";
import { ApiError, errorMessage } from "@/lib/api";
import { SessionProvider } from "@/lib/session";
import { ThemeProvider, useTheme } from "@/lib/theme";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster theme={theme} position="bottom-right" closeButton
      toastOptions={{ classNames: { toast: "!bg-[var(--bg-elevated)] !border-[var(--border-strong)] !text-[var(--text)] !rounded-[12px] !shadow-[var(--shadow-lg)]", description: "!text-[var(--text-3)]" } }} />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000, refetchOnWindowFocus: false,
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
    mutationCache: new MutationCache({
      onError: (err, _vars, _ctx, mutation) => {
        if (mutation.options.meta?.silent) return;
        toast.error(errorMessage(err));
      },
    }),
  }));
  return (
    <ThemeProvider>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <ConfirmProvider>
            <SessionProvider>{children}</SessionProvider>
            <ThemedToaster />
          </ConfirmProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
