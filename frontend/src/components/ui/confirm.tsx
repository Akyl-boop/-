"use client";

import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { AlertTriangle } from "lucide-react";
import * as React from "react";
import { Button } from "./button";
import { Input, Textarea } from "./input";

interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** Require the user to type this text to confirm (for critical actions). */
  typeToConfirm?: string;
  /** Ask for an optional reason (returned from the promise). */
  withReason?: boolean;
  reasonLabel?: string;
}

type Resolver = (value: { ok: boolean; reason?: string }) => void;
const Ctx = React.createContext<(o: ConfirmOptions) => Promise<{ ok: boolean; reason?: string }>>(async () => ({ ok: false }));

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = React.useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const resolver = React.useRef<Resolver | null>(null);

  const confirm = React.useCallback((o: ConfirmOptions) => {
    setOpts(o);
    setTyped("");
    setReason("");
    return new Promise<{ ok: boolean; reason?: string }>((res) => { resolver.current = res; });
  }, []);

  const close = (ok: boolean) => {
    resolver.current?.({ ok, reason: reason || undefined });
    resolver.current = null;
    setOpts(null);
  };
  const blocked = !!opts?.typeToConfirm && typed.trim() !== opts.typeToConfirm;

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <AlertDialog.Root open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[90] animate-fade-in bg-black/55 backdrop-blur-[2px]" />
          <AlertDialog.Content className="fixed left-1/2 top-[18vh] z-[91] w-[calc(100vw-24px)] max-w-[440px] -translate-x-1/2 animate-pop-in rounded-[16px] border border-border bg-elevated p-5 shadow-[var(--shadow-lg)]">
            <div className="flex gap-3.5">
              {opts?.danger ? (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-danger-bg text-danger"><AlertTriangle className="size-[18px]" /></div>
              ) : null}
              <div className="min-w-0 flex-1">
                <AlertDialog.Title className="text-[15px] font-semibold">{opts?.title}</AlertDialog.Title>
                <AlertDialog.Description asChild>
                  <div className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{opts?.description}</div>
                </AlertDialog.Description>
                {opts?.withReason ? (
                  <Textarea className="mt-3 min-h-[64px]" placeholder={opts.reasonLabel ?? "Reason (optional)"} value={reason} onChange={(e) => setReason(e.target.value)} />
                ) : null}
                {opts?.typeToConfirm ? (
                  <div className="mt-3 space-y-1.5">
                    <p className="text-xs text-fg-3">Type <span className="font-mono text-fg">{opts.typeToConfirm}</span> to confirm</p>
                    <Input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel asChild><Button variant="ghost">Cancel</Button></AlertDialog.Cancel>
              <Button variant={opts?.danger ? "danger" : "primary"} disabled={blocked} onClick={() => close(true)} autoFocus={!opts?.typeToConfirm}>
                {opts?.confirmLabel ?? "Confirm"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </Ctx.Provider>
  );
}

export function useConfirm() {
  return React.useContext(Ctx);
}
