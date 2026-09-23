import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "~/lib/format";

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

const ToastContext = createContext<(toast: Omit<ToastItem, "id">) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  const push = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = ++counter.current;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      window.setTimeout(() => dismiss(id), toast.tone === "error" ? 7000 : 4500);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end">
        {toasts.map((toast) => {
          const Icon = toast.tone === "success" ? CircleCheck : toast.tone === "error" ? CircleAlert : Info;
          return (
            <div
              key={toast.id}
              role="status"
              className="pointer-events-auto flex w-full max-w-sm animate-pop items-start gap-3 rounded-xl border border-line-strong bg-panel-2/95 px-4 py-3 backdrop-blur-xl"
              style={{ boxShadow: "var(--shadow-pop)" }}
            >
              <Icon className={cn("mt-0.5 size-[18px] shrink-0", toast.tone === "success" ? "text-success" : toast.tone === "error" ? "text-danger" : "text-info")} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{toast.title}</p>
                {toast.description ? <p className="mt-0.5 text-[13px] text-fg-muted">{toast.description}</p> : null}
              </div>
              <button type="button" onClick={() => dismiss(toast.id)} className="-mr-1 rounded-md p-1 text-fg-subtle transition-colors hover:text-fg" aria-label="Dismiss">
                <X className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

export interface ActionFeedback {
  ok?: boolean;
  message?: string;
  error?: string;
}

/** Shows a toast whenever a fetcher/action returns a fresh { ok, message | error } payload. */
export function useFeedbackToast(data: ActionFeedback | undefined | null) {
  const toast = useToast();
  const last = useRef<ActionFeedback | null>(null);
  useEffect(() => {
    if (!data || data === last.current) return;
    last.current = data;
    if (data.error) toast({ tone: "error", title: data.error });
    else if (data.message) toast({ tone: "success", title: data.message });
  }, [data, toast]);
}
