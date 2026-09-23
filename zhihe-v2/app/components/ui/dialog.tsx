import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { useT } from "~/i18n/react";
import { cn } from "~/lib/format";

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
}

export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useT();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] rounded-2xl border border-line-strong bg-panel p-0 text-fg backdrop:bg-black/65 backdrop:backdrop-blur-sm open:animate-pop",
        size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : "max-w-xl",
      )}
      style={{ boxShadow: "var(--shadow-pop)" }}
    >
      {open ? (
        <div className="flex max-h-[85dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{title}</h2>
              {description ? <p className="mt-1 text-sm text-fg-muted">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} className="btn btn-ghost btn-icon btn-sm -mr-2 shrink-0" aria-label={t("common.close")}>
              <X className="size-4" />
            </button>
          </div>
          {children ? <div className="overflow-y-auto px-5 py-5 sm:px-6">{children}</div> : null}
          {footer ? <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}
