import { FaqList } from "~/components/store/faq-list";
import { PageHeader } from "~/components/store/section-heading";
import { SupportCta } from "~/components/store/support-cta";
import { useT } from "~/i18n/react";
import { pickText } from "~/lib/localized";
import { metaT, rootData, seo } from "~/lib/seo";
import { getRequestContext } from "~/server/context";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/faq";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  return {
    items: settings.faq.items
      .map((item) => ({ question: pickText(item.question, locale), answer: pickText(item.answer, locale) }))
      .filter((item) => item.question && item.answer),
  };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  return seo(root, {
    title: metaT(root, "faq.title"),
    description: metaT(root, "faq.description"),
    path: "/faq",
    jsonLd: loaderData?.items.length
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: loaderData.items.map((item) => ({ "@type": "Question", name: item.question, acceptedAnswer: { "@type": "Answer", text: item.answer } })),
        }
      : undefined,
  });
};

export default function Faq({ loaderData }: Route.ComponentProps) {
  const t = useT();
  return (
    <>
      <PageHeader eyebrow={t("faq.eyebrow")} title={t("faq.title")} description={t("faq.description")} />
      <div className="page-container">
        <div className="mx-auto max-w-3xl">
          <FaqList items={loaderData.items} />
        </div>
        <div className="mt-16">
          <SupportCta />
        </div>
      </div>
    </>
  );
}
