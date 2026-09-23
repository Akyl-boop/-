import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "~/lib/format";

interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
  optional?: ReactNode;
}

export function Field({ label, hint, error, className, children, optional }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      {label ? (
        <label htmlFor={id} className="field-label flex items-baseline justify-between gap-2">
          <span>{label}</span>
          {optional ? <span className="text-xs font-normal text-fg-subtle">{optional}</span> : null}
        </label>
      ) : null}
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label?: ReactNode; hint?: ReactNode; error?: string | null; wrapperClassName?: string; optional?: ReactNode };

export function TextField({ label, hint, error, wrapperClassName, className, optional, ...rest }: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName} optional={optional}>
      {(props) => <input className={cn("input", className)} {...props} {...rest} />}
    </Field>
  );
}

export function TextAreaField({ label, hint, error, wrapperClassName, className, optional, ...rest }: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName} optional={optional}>
      {(props) => <textarea className={cn("input", className)} {...props} {...rest} />}
    </Field>
  );
}

export function SelectField({ label, hint, error, wrapperClassName, className, children, optional, ...rest }: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapperClassName} optional={optional}>
      {(props) => (
        <select className={cn("input", className)} {...props} {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export function SwitchField({ label, description, className, ...rest }: { label: ReactNode; description?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start justify-between gap-4 rounded-xl border border-line bg-panel-2/50 px-4 py-3 transition-colors hover:border-line-strong", className)}>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-fg-subtle">{description}</span> : null}
      </span>
      <input id={id} type="checkbox" className="switch mt-0.5" {...rest} />
    </label>
  );
}
