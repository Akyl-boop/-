import { ArrowRight, Clock, Mail, Receipt, Send } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "~/components/store/section-heading";
import { useT } from "~/i18n/react";
import { useRootData } from "~/lib/root-data";
import { metaT, rootData, seo } from "~/lib/seo";
import type { Route } from "./+types/support";

export const meta: Route.MetaFunction = ({ matches }) => {
  const root = rootData(matches);
  return seo(root, { title: metaT(root, "support.title"), description: metaT(root, "support.description"), path: "/support" });
};

export default function Support() {
  const t = useT();
  const { settings } = useRootData();
  return (
    <>
      <PageHeader eyebrow={t("support.eyebrow")} title={t("support.title")} description={t("support.description")} />
      <div className="page-container">
        <div className="grid gap-4 md:grid-cols-2">
          {settings.telegram ? (
            <a href={`https://t.me/${settings.telegram}`} target="_blank" rel="noopener noreferrer" className="group surface surface-hover relative overflow-hidden p-7">
              <div className="absolute inset-0 bg-[radial-gradient(70%_100%_at_100%_0%,rgba(124,108,255,0.14),transparent)]" aria-hidden="true" />
              <div className="relative">
                <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                  <Send className="size-5" />
                </span>
                <h2 className="mt-6 text-lg font-semibold">Telegram</h2>
                <p className="mt-1 text-sm text-fg-muted">{t("support.telegram.text")}</p>
                <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                  @{settings.telegram}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </p>
              </div>
            </a>
          ) : null}
          {settings.supportEmail ? (
            <a href={`mailto:${settings.supportEmail}`} className="group surface surface-hover p-7">
              <span className="grid size-11 place-items-center rounded-xl border border-line-strong bg-panel-3 text-fg-muted">
                <Mail className="size-5" />
              </span>
              <h2 className="mt-6 text-lg font-semibold">Email</h2>
              <p className="mt-1 text-sm text-fg-muted">{t("support.email.text")}</p>
              <p className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-fg">
                {settings.supportEmail}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </p>
            </a>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="surface flex items-start gap-4 p-6">
            <Clock className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
            <div>
              <h3 className="font-semibold">{t("support.hours")}</h3>
              <p className="mt-1 text-sm text-fg-muted">{settings.supportHours}</p>
            </div>
          </div>
          <div className="surface flex items-start gap-4 p-6">
            <Receipt className="mt-0.5 size-5 shrink-0 text-fg-subtle" />
            <div>
              <h3 className="font-semibold">{t("support.tip.title")}</h3>
              <p className="mt-1 text-sm text-fg-muted">{t("support.tip.text")}</p>
              <Link to="/orders" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent-strong hover:text-fg">
                {t("nav.myOrders")}
                <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
