import { ArrowRight, Mail, Send } from "lucide-react";
import { ButtonLink } from "~/components/ui/button";
import { useT } from "~/i18n/react";
import { useRootData } from "~/lib/root-data";

export function SupportCta() {
  const t = useT();
  const { settings } = useRootData();
  return (
    <div className="surface relative overflow-hidden px-6 py-10 sm:px-10 sm:py-12">
      <div className="absolute inset-0 bg-[radial-gradient(60%_120%_at_100%_0%,rgba(124,108,255,0.18),transparent_60%)]" aria-hidden="true" />
      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-xl">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{t("cta.support.title")}</h2>
          <p className="mt-2.5 text-[15px] leading-7 text-fg-muted">{t("cta.support.text")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          {settings.telegram ? (
            <a href={`https://t.me/${settings.telegram}`} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-lg">
              <Send className="size-4" />
              {t("cta.support.telegram")}
            </a>
          ) : null}
          {settings.supportEmail ? (
            <a href={`mailto:${settings.supportEmail}`} className="btn btn-secondary btn-lg">
              <Mail className="size-4" />
              {t("cta.support.email")}
            </a>
          ) : (
            <ButtonLink to="/support" variant="secondary" size="lg">
              {t("nav.support")}
              <ArrowRight className="size-4" />
            </ButtonLink>
          )}
        </div>
      </div>
    </div>
  );
}
