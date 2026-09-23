import { useFetcher, useLocation, useNavigate } from "react-router";
import { LOCALE_META, LOCALES, type Locale } from "~/i18n/config";
import { useLocale } from "~/i18n/react";
import { cn } from "~/lib/format";

export function LanguageSwitcher({ enabled, className }: { enabled: string[]; className?: string }) {
  const locale = useLocale();
  const fetcher = useFetcher();
  const location = useLocation();
  const navigate = useNavigate();
  const pending = fetcher.formData?.get("locale") as Locale | undefined;
  const current = pending ?? locale;
  const options = LOCALES.filter((option) => enabled.includes(option));
  if (options.length < 2) return null;

  return (
    <div role="group" aria-label="Language" className={cn("inline-flex items-center rounded-lg border border-line bg-panel-2/60 p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          lang={LOCALE_META[option].htmlLang}
          aria-pressed={current === option}
          onClick={() => {
            if (option === locale) return;
            const params = new URLSearchParams(location.search);
            if (params.has("lang")) {
              params.delete("lang");
              navigate({ pathname: location.pathname, search: params.toString() }, { replace: true, preventScrollReset: true });
            }
            fetcher.submit({ locale: option }, { method: "post", action: "/api/locale" });
          }}
          className={cn(
            "h-7 min-w-9 rounded-md px-2 text-xs font-medium transition-colors duration-200",
            current === option ? "bg-panel-3 text-fg shadow-[0_1px_0_0_rgb(255_255_255/0.06)_inset]" : "text-fg-subtle hover:text-fg",
          )}
        >
          {LOCALE_META[option].label}
        </button>
      ))}
    </div>
  );
}
