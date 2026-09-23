import { ArrowRight } from "lucide-react";
import { data } from "react-router";
import { ButtonLink } from "~/components/ui/button";
import { useT } from "~/i18n/react";
import { metaT, rootData, seo } from "~/lib/seo";
import type { Route } from "./+types/not-found";

export function loader() {
  return data(null, { status: 404 });
}

export const meta: Route.MetaFunction = ({ matches }) => {
  const root = rootData(matches);
  return seo(root, { title: metaT(root, "notFound.title"), path: "/404", noindex: true });
};

export default function NotFound() {
  const t = useT();
  return (
    <div className="page-container grid min-h-[60dvh] place-items-center py-20 text-center">
      <div>
        <p className="font-mono text-sm text-accent-strong">404</p>
        <h1 className="text-gradient mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">{t("notFound.title")}</h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] text-fg-muted">{t("notFound.text")}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink to="/catalog" variant="primary">
            {t("home.cta.catalog")}
            <ArrowRight className="size-4" />
          </ButtonLink>
          <ButtonLink to="/">{t("nav.home")}</ButtonLink>
        </div>
      </div>
    </div>
  );
}
