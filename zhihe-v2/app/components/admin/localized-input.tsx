import { useState } from "react";
import { LOCALE_META, LOCALES, type Locale } from "~/i18n/config";
import { cn } from "~/lib/format";
import type { LocalizedText } from "~/lib/localized";

interface LocalizedFieldProps {
  label: string;
  value: LocalizedText;
  onChange: (value: LocalizedText) => void;
  multiline?: boolean;
  rows?: number;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  error?: string | null;
  mono?: boolean;
}

/** One field, three languages. Tabs mark which translations are filled in. */
export function LocalizedField({ label, value, onChange, multiline, rows = 4, placeholder, hint, required, error, mono }: LocalizedFieldProps) {
  const [locale, setLocale] = useState<Locale>("en");
  const current = value[locale] ?? "";
  const set = (text: string) => onChange({ ...value, [locale]: text });
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-[13px] font-medium text-fg-muted">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </span>
        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-panel-2/60 p-0.5" role="tablist">
          {LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="tab"
              aria-selected={locale === code}
              onClick={() => setLocale(code)}
              className={cn("relative rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors", locale === code ? "bg-panel-3 text-fg" : "text-fg-subtle hover:text-fg")}
            >
              {LOCALE_META[code].label}
              {value[code]?.trim() ? <span className="absolute top-0.5 right-0.5 size-1 rounded-full bg-success" aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      </div>
      {multiline ? (
        <textarea
          className={cn("input", mono && "font-mono text-[13px]")}
          rows={rows}
          value={current}
          placeholder={placeholder}
          lang={LOCALE_META[locale].htmlLang}
          onChange={(event) => set(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-label={`${label} (${LOCALE_META[locale].name})`}
        />
      ) : (
        <input
          className="input"
          value={current}
          placeholder={placeholder}
          lang={LOCALE_META[locale].htmlLang}
          onChange={(event) => set(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-label={`${label} (${LOCALE_META[locale].name})`}
        />
      )}
      {error ? <p className="field-error">{error}</p> : hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}

/** Uncontrolled variant for plain HTML forms: emits `${name}.en|ru|zh` inputs. */
export function LocalizedFormField({ name, defaultValue, ...props }: Omit<LocalizedFieldProps, "value" | "onChange"> & { name: string; defaultValue?: LocalizedText }) {
  const [value, setValue] = useState<LocalizedText>(defaultValue ?? {});
  return (
    <>
      <LocalizedField {...props} value={value} onChange={setValue} />
      {LOCALES.map((code) => (
        <input key={code} type="hidden" name={`${name}.${code}`} value={value[code] ?? ""} />
      ))}
    </>
  );
}
