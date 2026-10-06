"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

export interface AdminEvent { type: string; data: Record<string, unknown>; ts: string }

type Listener = (e: AdminEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe to realtime admin events (one EventSource per tab, shared). */
export function useAdminEvent(listener: Listener) {
  React.useEffect(() => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, [listener]);
}

/** Mounted once in the app shell: connects to /api/events and invalidates queries. */
export function useEventStream(enabled: boolean) {
  const qc = useQueryClient();
  const [connected, setConnected] = React.useState(false);
  React.useEffect(() => {
    if (!enabled) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/events", { withCredentials: true });
      es.onopen = () => setConnected(true);
      es.onerror = () => {
        setConnected(false);
        es?.close();
        if (!closed) retry = setTimeout(connect, 5000);
      };
      const handle = (raw: MessageEvent) => {
        let evt: AdminEvent;
        try { evt = JSON.parse(raw.data); } catch { return; }
        listeners.forEach((l) => l(evt));
        const t = evt.type;
        if (t.startsWith("order.")) {
          qc.invalidateQueries({ queryKey: ["orders"] });
          qc.invalidateQueries({ queryKey: ["dashboard"] });
          if (evt.data.id) qc.invalidateQueries({ queryKey: ["order", Number(evt.data.id)] });
        }
        if (t.startsWith("payment.")) qc.invalidateQueries({ queryKey: ["payments"] });
        if (t.startsWith("ticket.")) {
          qc.invalidateQueries({ queryKey: ["tickets"] });
          if (evt.data.id) qc.invalidateQueries({ queryKey: ["ticket", Number(evt.data.id)] });
        }
        if (t === "inventory.changed") qc.invalidateQueries({ queryKey: ["inventory"] });
        if (t === "broadcast.progress") qc.invalidateQueries({ queryKey: ["broadcasts"] });
        if (t === "notification") {
          qc.invalidateQueries({ queryKey: ["notifications"] });
          const sev = String(evt.data.severity ?? "info");
          const fn = sev === "critical" ? toast.error : sev === "warning" ? toast.warning : sev === "success" ? toast.success : toast.info;
          fn(String(evt.data.title ?? "Notification"), { description: evt.data.body ? String(evt.data.body).slice(0, 140) : undefined });
        }
      };
      for (const name of ["message", "notification", "order.created", "order.updated", "payment.updated", "ticket.created",
        "ticket.message", "ticket.updated", "inventory.changed", "broadcast.progress"]) {
        es.addEventListener(name, handle as EventListener);
      }
    };
    connect();
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      es?.close();
    };
  }, [enabled, qc]);
  return connected;
}
