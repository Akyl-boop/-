import { ArrowRight, BookOpen, KeyRound, Link2, PackageCheck, ShieldCheck, Wallet, Zap } from "lucide-react";
import { PageHeader } from "~/components/store/section-heading";
import { SupportCta } from "~/components/store/support-cta";
import { ButtonLink } from "~/components/ui/button";
import { useT } from "~/i18n/react";
import { metaT, rootData, seo } from "~/lib/seo";
import type { Route } from "./+types/how-it-works";

export const meta: Route.MetaFunction = ({ matches }) => {
  const root = rootData(matches);
  return seo(root, { title: metaT(root, "how.title"), description: metaT(root, "how.description"), path: "/how-it-works" });
};

export default function HowItWorks() {
  const t = useT();
  const steps = [
    { icon: PackageCheck, title: t("how.step1.title"), text: t("how.step1.long") },
    { icon: Wallet, title: t("how.step2.title"), text: t("how.step2.long") },
    { icon: Zap, title: t("how.step3.title"), text: t("how.step3.long") },
    { icon: KeyRound, title: t("how.step4.title"), text: t("how.step4.long") },
  ];
  const facts = [
    { icon: Link2, title: t("how.fact.link.title"), text: t("how.fact.link.text") },
    { icon: ShieldCheck, title: t("how.fact.secure.title"), text: t("how.fact.secure.text") },
    { icon: BookOpen, title: t("how.fact.guides.title"), text: t("how.fact.guides.text") },
  ];
  return (
    <>
      <PageHeader eyebrow={t("how.eyebrow")} title={t("how.title")} description={t("how.description")} />
      <div className="page-container">
        <ol className="grid gap-4 md:grid-cols-2">
          {steps.map((step, index) => (
            <li key={step.title} className="surface relative overflow-hidden p-7">
              <span className="pointer-events-none absolute -top-6 -right-2 font-mono text-[120px] leading-none font-semibold text-white/[0.03]" aria-hidden="true">
                {index + 1}
              </span>
              <span className="grid size-11 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                <step.icon className="size-5" />
              </span>
              <p className="mt-6 font-mono text-xs text-fg-subtle">{t("how.stepLabel", { n: index + 1 })}</p>
              <h2 className="mt-1.5 text-lg font-semibold">{step.title}</h2>
              <p className="mt-2 text-[14.5px] leading-7 text-fg-muted">{step.text}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.title} className="surface p-6">
              <fact.icon className="size-5 text-accent-strong" />
              <h3 className="mt-4 font-semibold">{fact.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-fg-muted">{fact.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex justify-center">
          <ButtonLink to="/catalog" variant="primary" size="lg">
            {t("home.cta.catalog")}
            <ArrowRight className="size-4" />
          </ButtonLink>
        </div>
        <div className="mt-16">
          <SupportCta />
        </div>
      </div>
    </>
  );
}
