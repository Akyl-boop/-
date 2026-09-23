import { useEffect, useState } from "react";
import { cn } from "~/lib/format";
import { minorToInput, parseMoneyInput } from "~/lib/money";

/** Edits an integer minor-unit amount as a decimal string. */
export function MoneyInput({ value, onChange, currency, nullable, placeholder, className, id, ariaLabel }: { value: number | null; onChange: (value: number | null) => void; currency: string; nullable?: boolean; placeholder?: string; className?: string; id?: string; ariaLabel?: string }) {
  const [text, setText] = useState(minorToInput(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    if (parseMoneyInput(text) !== value) setText(minorToInput(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <input
        id={id}
        inputMode="decimal"
        className="input pr-14 tabular"
        value={text}
        placeholder={placeholder ?? "0.00"}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          if (!next.trim() && nullable) {
            setInvalid(false);
            onChange(null);
            return;
          }
          const parsed = parseMoneyInput(next);
          setInvalid(parsed === null);
          if (parsed !== null) onChange(parsed);
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-fg-subtle">{currency}</span>
    </div>
  );
}
