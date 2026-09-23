import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { Button, type ButtonSize, type ButtonVariant } from "~/components/ui/button";
import { Dialog } from "~/components/ui/dialog";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useT } from "~/i18n/react";

interface ConfirmActionProps {
  intent: string;
  fields?: Record<string, string>;
  action?: string;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: boolean;
  className?: string;
  children: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  extra?: ReactNode;
  ariaLabel?: string;
}

/** A button that opens a confirmation dialog and then posts `intent` via a fetcher. */
export function ConfirmAction({ intent, fields, action, title, description, confirmLabel, variant = "secondary", size = "md", icon, className, children, danger, disabled, extra, ariaLabel }: ConfirmActionProps) {
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<ActionFeedback>();
  const t = useT();
  useFeedbackToast(fetcher.data);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <>
      <Button variant={variant} size={size} icon={icon} className={className} onClick={() => setOpen(true)} disabled={disabled} aria-label={ariaLabel}>
        {children}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        description={description}
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>{t("common.cancel")}</Button>
            <fetcher.Form method="post" action={action}>
              <input type="hidden" name="intent" value={intent} />
              {Object.entries(fields ?? {}).map(([name, value]) => (
                <input key={name} type="hidden" name={name} value={value} />
              ))}
              {extra}
              <Button type="submit" variant={danger ? "danger" : "primary"} loading={fetcher.state !== "idle"} className="w-full sm:w-auto">
                {confirmLabel}
              </Button>
            </fetcher.Form>
          </>
        }
      />
    </>
  );
}
