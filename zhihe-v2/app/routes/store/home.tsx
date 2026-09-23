import { ArrowRight, BadgeCheck, CheckCircle2, CreditCard, Headphones, KeyRound, Lock, PackageCheck, ShieldCheck, Wallet, Zap } from "lucide-react";
import { Link } from "react-router";
import { FaqList } from "~/components/store/faq-list";
import { CategoryIcon } from "~/components/store/category-icon";
import { ProductCard } from "~/components/store/product-card";
import { ProductCover } from "~/components/store/product-cover";
import { SectionHeading } from "~/components/store/section-heading";
import { SupportCta } from "~/components/store/support-cta";
import { ButtonLink } from "~/components/ui/button";
import { useLocale, useT } from "~/i18n/react";
import { pickText } from "~/lib/localized";
import { formatMoney } from "~/lib/money";
import { useRootData } from "~/lib/root-data";
import { rootData, seo } from "~/lib/seo";
import { listCategories, listProducts } from "~/server/catalog.server";
import { getRequestContext } from "~/server/context";
import { resolveLocale } from "~/server/locale.server";
import { getSettings } from "~/server/settings.server";
import type { Route } from "./+types/home";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { env } = getRequestContext(context);
  const settings = await getSettings(env.DB);
  const locale = resolveLocale(request, settings);
  const [featured, popular, categories] = await Promise.all([
    listProducts(env.DB, locale, { featured: true, limit: 8 }),
    listProducts(env.DB, locale, { popular: true, limit: 8 }),
    listCategories(env.DB, locale),
  ]);
  const showcase = featured.length > 0 ? featured : popular;
  return {
    hero: {
      eyebrow: pickText(settings.homepage.heroEyebrow, locale),
      title: pickText(settings.homepage.heroTitle, locale),
      subtitle: pickText(settings.homepage.heroSubtitle, locale),
    },
    featured: showcase.slice(0, 8),
    categories: categories.filter((category) => category.productCount > 0),
    faq: settings.faq.items.slice(0, 4).map((item) => ({ question: pickText(item.question, locale), answer: pickText(item.answer, locale) })),
  };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const root = rootData(matches);
  return seo(root, {
    title: root?.settings.storeName ?? "ZHIHE AI",
    description: loaderData?.hero.subtitle,
    path: "/",
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: root?.settings.storeName,
      url: root?.siteUrl,
      logo: `${root?.siteUrl}/favicon.svg`,
      contactPoint: root?.settings.supportEmail ? [{ "@type": "ContactPoint", email: root.settings.supportEmail, contactType: "customer support" }] : undefined,
    },
  });
};

function HeroShowcase({ products }: { products: Route.ComponentProps["loaderData"]["featured"] }) {
  const t = useT();
  const locale = useLocale();
  const lead = products[0];
  if (!lead) return null;
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-hidden="true">
      <div className="absolute -inset-6 rounded-[32px] bg-[radial-gradient(closest-side,rgba(124,108,255,0.22),transparent)] blur-2xl" />
      <div className="surface relative overflow-hidden rounded-2xl" style={{ boxShadow: "var(--shadow-pop)" }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-success" />
            <span className="text-xs font-medium text-fg-muted">{t("home.showcase.order")}</span>
          </div>
          <span className="font-mono text-[11px] text-fg-subtle">ZH-2026-7KQ4MX</span>
        </div>
        <div className="flex items-center gap-4 px-5 py-5">
          <ProductCover name={lead.name} imageUrl={lead.thumbnailUrl} accent={lead.accent} size="thumb" className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-fg">{lead.name}</p>
            <p className="mt-0.5 text-xs text-fg-subtle">{lead.categoryName}</p>
          </div>
          <span className="text-sm font-semibold tabular text-fg">{formatMoney(lead.price, lead.currency, locale)}</span>
        </div>
        <div className="mx-5 rounded-xl border border-line bg-canvas/60 p-4">
          <p className="eyebrow">{t("home.showcase.delivery")}</p>
          <div className="mt-2.5 flex items-center justify-between gap-3">
            <code className="truncate font-mono text-[13px] text-fg">
              AX7P-<span className="text-fg-subtle">••••</span>-<span className="text-fg-subtle">••••</span>-Q2LD
            </code>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-success-soft px-2 py-1 text-[11px] font-medium text-success">
              <CheckCircle2 className="size-3" />
              {t("status.completed")}
            </span>
          </div>
        </div>
        <ol className="space-y-3 px-5 pt-5 pb-5 xl:pb-12">
          {(["home.showcase.step1", "home.showcase.step2", "home.showcase.step3"] as const).map((key, index) => (
            <li key={key} className="flex items-center gap-3 text-[13px]">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-strong">{index + 1}</span>
              <span className="text-fg-muted">{t(key)}</span>
            </li>
          ))}
        </ol>
      </div>
      {products[1] ? (
        <div className="surface absolute -bottom-6 -left-10 hidden w-60 items-center gap-3 rounded-xl p-3 xl:flex" style={{ boxShadow: "var(--shadow-pop)" }}>
          <ProductCover name={products[1].name} imageUrl={products[1].thumbnailUrl} accent={products[1].accent} size="thumb" className="size-10 shrink-0 rounded-lg" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-fg">{products[1].name}</p>
            <p className="text-[11px] text-success">{t("delivery.instant")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { settings } = useRootData();
  const { hero, featured, categories, faq } = loaderData;

  const steps = [
    { icon: PackageCheck, title: t("how.step1.title"), text: t("how.step1.text") },
    { icon: Wallet, title: t("how.step2.title"), text: t("how.step2.text") },
    { icon: Zap, title: t("how.step3.title"), text: t("how.step3.text") },
    { icon: KeyRound, title: t("how.step4.title"), text: t("how.step4.text") },
  ];
  const advantages = [
    { icon: Zap, title: t("home.adv.instant.title"), text: t("home.adv.instant.text") },
    { icon: BadgeCheck, title: t("home.adv.warranty.title"), text: t("home.adv.warranty.text") },
    { icon: CreditCard, title: t("home.adv.noAccount.title"), text: t("home.adv.noAccount.text") },
    { icon: Headphones, title: t("home.adv.support.title"), text: t("home.adv.support.text") },
  ];

  return (
    <>
      <section className="page-container grid items-center gap-14 pt-12 pb-20 sm:pt-20 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:pt-24 lg:pb-28">
        <div className="animate-rise">
          {hero.eyebrow ? (
            <p className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-panel-2/70 py-1 pr-3 pl-1 text-xs text-fg-muted backdrop-blur">
              <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-strong">{settings.storeName}</span>
              {hero.eyebrow}
            </p>
          ) : null}
          <h1 className="text-gradient mt-6 text-[34px] leading-[1.08] font-semibold tracking-[-0.035em] sm:text-5xl lg:text-[56px]">{hero.title}</h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-fg-muted sm:text-lg sm:leading-8">{hero.subtitle}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/catalog" variant="primary" size="lg">
              {t("home.cta.catalog")}
              <ArrowRight className="size-4" />
            </ButtonLink>
            <ButtonLink to="/how-it-works" variant="secondary" size="lg">
              {t("home.cta.how")}
            </ButtonLink>
          </div>
          <ul className="mt-10 grid grid-cols-1 gap-3 text-[13px] text-fg-muted sm:grid-cols-3">
            {[
              { icon: Zap, label: t("home.trust.instant") },
              { icon: Lock, label: t("home.trust.secure") },
              { icon: ShieldCheck, label: t("home.trust.warranty") },
            ].map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2">
                <Icon className="size-4 text-accent-strong" />
                {label}
              </li>
            ))}
          </ul>
        </div>
        <div className="animate-rise [animation-delay:120ms]">
          <HeroShowcase products={featured} />
        </div>
      </section>

      {featured.length > 0 ? (
        <section className="page-container py-12 sm:py-16">
          <SectionHeading
            eyebrow={t("home.featured.eyebrow")}
            title={t("home.featured.title")}
            description={t("home.featured.text")}
            action={
              <Link to="/catalog" className="group inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
                {t("home.viewAll")}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
              </Link>
            }
          />
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.slice(0, 8).map((product, index) => (
              <ProductCard key={product.id} product={product} priority={index < 2} />
            ))}
          </div>
        </section>
      ) : null}

      {categories.length > 0 ? (
        <section className="page-container py-12 sm:py-16">
          <SectionHeading eyebrow={t("home.categories.eyebrow")} title={t("home.categories.title")} />
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <Link key={category.id} to={`/catalog/${category.slug}`} prefetch="intent" className="group surface surface-hover flex items-center gap-4 p-5">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-line-strong bg-panel-3 text-fg-muted transition-colors group-hover:border-accent/40 group-hover:text-accent-strong">
                  <CategoryIcon name={category.icon} className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-fg">{category.name}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-fg-subtle">{category.description || t("home.categories.count", { count: category.productCount })}</span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-fg-subtle transition-all group-hover:translate-x-0.5 group-hover:text-fg" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="page-container py-12 sm:py-16">
        <SectionHeading eyebrow={t("home.how.eyebrow")} title={t("home.how.title")} description={t("home.how.text")} />
        <ol className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((step, index) => (
            <li key={step.title} className="surface relative p-6">
              <div className="flex items-center justify-between">
                <span className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-strong">
                  <step.icon className="size-[18px]" />
                </span>
                <span className="font-mono text-xs text-fg-subtle">0{index + 1}</span>
              </div>
              <h3 className="mt-5 text-[15px] font-semibold text-fg">{step.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-6 text-fg-muted">{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="page-container py-12 sm:py-16">
        <div className="grid gap-4 lg:grid-cols-[1fr_1.15fr]">
          <div className="surface relative overflow-hidden p-7 sm:p-9">
            <div className="bg-grid absolute inset-0 [mask-image:radial-gradient(70%_60%_at_0%_0%,black,transparent)]" aria-hidden="true" />
            <div className="relative">
              <p className="eyebrow text-accent-strong">{t("home.security.eyebrow")}</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight">{t("home.security.title")}</h2>
              <p className="mt-3 text-[15px] leading-7 text-fg-muted">{t("home.security.text")}</p>
              <ul className="mt-6 space-y-3">
                {(["home.security.point1", "home.security.point2", "home.security.point3", "home.security.point4"] as const).map((key) => (
                  <li key={key} className="flex gap-3 text-sm text-fg-muted">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                    {t(key)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {advantages.map((item) => (
              <div key={item.title} className="surface p-6">
                <item.icon className="size-5 text-accent-strong" />
                <h3 className="mt-4 text-[15px] font-semibold text-fg">{item.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-6 text-fg-muted">{item.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {faq.length > 0 ? (
        <section className="page-container py-12 sm:py-16">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
            <SectionHeading
              eyebrow={t("home.faq.eyebrow")}
              title={t("home.faq.title")}
              description={t("home.faq.text")}
              action={
                <Link to="/faq" className="group mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-fg-muted transition-colors hover:text-fg sm:hidden lg:inline-flex">
                  {t("home.faq.all")}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              }
              className="lg:flex-col lg:items-start lg:justify-start"
            />
            <FaqList items={faq} />
          </div>
        </section>
      ) : null}

      <section className="page-container pt-12 sm:pt-16">
        <SupportCta />
      </section>
    </>
  );
}
