import { CheckCircle2, CircleAlert, Plus, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useFetcher, useSearchParams } from "react-router";
import { LocalizedField } from "~/components/admin/localized-input";
import { MediaPicker } from "~/components/admin/media-picker";
import { AdminPageHeader, Panel } from "~/components/admin/page";
import { Button } from "~/components/ui/button";
import { CopyButton } from "~/components/ui/copy-button";
import { SwitchField } from "~/components/ui/field";
import { useFeedbackToast, type ActionFeedback } from "~/components/ui/toast";
import { useT } from "~/i18n/react";
import type { AdminMessageKey } from "~/i18n/messages";
import { LOCALE_META, LOCALES, type Locale } from "~/i18n/config";
import { cn } from "~/lib/format";
import { SUPPORTED_CURRENCIES } from "~/lib/money";
import { SETTINGS_SECTIONS, type SettingsSection, type StoreSettings } from "~/lib/settings";
import { auditStatement } from "~/server/audit.server";
import { adminContext, fail, ok } from "~/server/admin/context.server";
import { newId } from "~/server/crypto.server";
import { isEmailConfigured } from "~/server/notify/email.server";
import { notifyAdminTelegram } from "~/server/notify/telegram.server";
import { getSettings, saveSettingsSection } from "~/server/settings.server";
import type { Route } from "./+types/settings";

export async function loader({ request, context }: Route.LoaderArgs) {
  const { db, env } = await adminContext(context, request, "owner");
  const settings = await getSettings(db);
  return {
    settings,
    integrations: {
      cryptobot: Boolean(env.CRYPTOBOT_API_TOKEN),
      cryptobotNetwork: env.CRYPTOBOT_NETWORK === "testnet" ? "testnet" : "mainnet",
      telegram: Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
      email: isEmailConfigured(env),
      storage: Boolean(env.MEDIA),
      webhookUrl: `${env.SITE_URL.replace(/\/$/, "")}/api/webhooks/cryptobot`,
    },
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const { db, env, admin, t } = await adminContext(context, request, "owner");
  const form = await request.formData();
  const intent = String(form.get("intent"));
  if (intent === "test_telegram") {
    const sent = await notifyAdminTelegram(env, `<b>${t("admin.settings.telegramTestMessage")}</b>`);
    return sent ? ok(t("admin.settings.telegramSent")) : fail(t("admin.settings.telegramFailed"));
  }
  const section = String(form.get("section")) as SettingsSection;
  if (!SETTINGS_SECTIONS.includes(section)) return fail(t("error.generic"));
  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get("payload") ?? "{}"));
  } catch {
    return fail(t("admin.error.invalid"));
  }
  if (section === "payments" && payload && typeof payload === "object") {
    const wallets = (payload as { manualWallets?: { id?: string }[] }).manualWallets ?? [];
    for (const wallet of wallets) if (!wallet.id) wallet.id = newId();
  }
  await saveSettingsSection(db, section, payload as StoreSettings[typeof section]);
  await auditStatement(db, request, admin, { action: "settings.update", entityType: "settings", entityId: section }).run();
  return ok(t("admin.saved"));
}

const TABS: { id: SettingsSection; label: AdminMessageKey }[] = [
  { id: "general", label: "admin.settings.tab.general" },
  { id: "homepage", label: "admin.settings.tab.homepage" },
  { id: "contact", label: "admin.settings.tab.contact" },
  { id: "social", label: "admin.settings.tab.social" },
  { id: "footer", label: "admin.settings.tab.footer" },
  { id: "faq", label: "admin.settings.tab.faq" },
  { id: "payments", label: "admin.settings.tab.payments" },
  { id: "notifications", label: "admin.settings.tab.notifications" },
];

function Status({ ok: good, label }: { ok: boolean; label: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px]", good ? "text-success" : "text-warning")}>
      {good ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
      {label}
    </span>
  );
}

function TextInput({ label, value, onChange, hint, placeholder, mono }: { label: string; value: string; onChange: (value: string) => void; hint?: string; placeholder?: string; mono?: boolean }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      <input className={cn("input", mono && "font-mono text-[13px]")} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {hint ? <span className="field-hint block">{hint}</span> : null}
    </label>
  );
}

function SectionForm<K extends SettingsSection>({ section, initial, children }: { section: K; initial: StoreSettings[K]; children: (value: StoreSettings[K], set: (patch: Partial<StoreSettings[K]>) => void) => ReactNode }) {
  const t = useT();
  const fetcher = useFetcher<ActionFeedback>();
  const [value, setValue] = useState(initial);
  useFeedbackToast(fetcher.data);
  useEffect(() => setValue(initial), [initial]);
  return (
    <div className="space-y-6">
      {children(value, (patch) => setValue((current) => ({ ...current, ...patch })))}
      <div className="flex justify-end">
        <Button variant="primary" loading={fetcher.state !== "idle"} onClick={() => fetcher.submit({ intent: "save", section, payload: JSON.stringify(value) }, { method: "post" })}>
          <Save className="size-4" />
          {t("admin.save")}
        </Button>
      </div>
    </div>
  );
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((item) => item.id === params.get("tab"))?.id ?? "general") as SettingsSection;
  const { settings, integrations } = loaderData;
  const testFetcher = useFetcher<ActionFeedback>();
  useFeedbackToast(testFetcher.data);

  return (
    <>
      <AdminPageHeader title={t("admin.settings.title")} description={t("admin.settings.description")} />
      <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
        <nav className="-mx-4 flex gap-1 overflow-x-auto px-4 scrollbar-none lg:mx-0 lg:flex-col lg:px-0" aria-label={t("admin.settings.title")}>
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setParams({ tab: item.id }, { replace: true, preventScrollReset: true })}
              className={cn("shrink-0 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors", tab === item.id ? "bg-white/[0.06] text-fg" : "text-fg-muted hover:bg-white/[0.03] hover:text-fg")}
            >
              {t(item.label)}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {tab === "general" ? (
            <SectionForm section="general" initial={settings.general}>
              {(value, set) => (
                <>
                  <Panel title={t("admin.settings.brand")}>
                    <div className="grid gap-5">
                      <TextInput label={t("admin.settings.storeName")} value={value.storeName} onChange={(storeName) => set({ storeName })} />
                      <LocalizedField label={t("admin.settings.tagline")} value={value.tagline} onChange={(tagline) => set({ tagline })} />
                      <div className="grid gap-5 sm:grid-cols-2">
                        <MediaPicker label={t("admin.settings.logo")} value={value.logoUrl} onChange={(logoUrl) => set({ logoUrl })} aspect="aspect-square max-w-[140px]" />
                        <MediaPicker label={t("admin.settings.favicon")} value={value.faviconUrl} onChange={(faviconUrl) => set({ faviconUrl })} aspect="aspect-square max-w-[140px]" />
                      </div>
                    </div>
                  </Panel>
                  <Panel title={t("admin.settings.regional")}>
                    <div className="grid gap-5 sm:grid-cols-3">
                      <label className="block">
                        <span className="field-label">{t("admin.product.currency")}</span>
                        <select className="input" value={value.currency} onChange={(event) => set({ currency: event.target.value as typeof value.currency })}>
                          {SUPPORTED_CURRENCIES.map((currency) => (
                            <option key={currency}>{currency}</option>
                          ))}
                        </select>
                      </label>
                      <TextInput label={t("admin.settings.timezone")} value={value.timezone} onChange={(timezone) => set({ timezone })} placeholder="Asia/Bishkek" mono />
                      <label className="block">
                        <span className="field-label">{t("admin.settings.defaultLocale")}</span>
                        <select className="input" value={value.defaultLocale} onChange={(event) => set({ defaultLocale: event.target.value as Locale })}>
                          {LOCALES.map((code) => (
                            <option key={code} value={code}>
                              {LOCALE_META[code].name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <fieldset className="mt-5">
                      <legend className="field-label">{t("admin.settings.languages")}</legend>
                      <div className="flex flex-wrap gap-2">
                        {LOCALES.map((code) => (
                          <label key={code} className="flex items-center gap-2 rounded-lg border border-line bg-panel-2/50 px-3 py-2 text-sm">
                            <input
                              type="checkbox"
                              className="checkbox"
                              checked={value.enabledLocales.includes(code)}
                              onChange={(event) => {
                                const next = event.target.checked ? [...value.enabledLocales, code] : value.enabledLocales.filter((item) => item !== code);
                                if (next.length > 0) set({ enabledLocales: LOCALES.filter((item) => next.includes(item)) });
                              }}
                            />
                            {LOCALE_META[code].name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </Panel>
                  <Panel title={t("admin.settings.maintenance")}>
                    <div className="grid gap-5">
                      <SwitchField label={t("admin.settings.maintenanceMode")} description={t("admin.settings.maintenanceHint")} checked={value.maintenanceMode} onChange={(event) => set({ maintenanceMode: event.target.checked })} />
                      <LocalizedField label={t("admin.settings.maintenanceMessage")} value={value.maintenanceMessage} onChange={(maintenanceMessage) => set({ maintenanceMessage })} multiline rows={2} />
                    </div>
                  </Panel>
                </>
              )}
            </SectionForm>
          ) : null}

          {tab === "homepage" ? (
            <SectionForm section="homepage" initial={settings.homepage}>
              {(value, set) => (
                <Panel title={t("admin.settings.tab.homepage")}>
                  <div className="grid gap-5">
                    <LocalizedField label={t("admin.settings.heroEyebrow")} value={value.heroEyebrow} onChange={(heroEyebrow) => set({ heroEyebrow })} />
                    <LocalizedField label={t("admin.settings.heroTitle")} value={value.heroTitle} onChange={(heroTitle) => set({ heroTitle })} multiline rows={2} />
                    <LocalizedField label={t("admin.settings.heroSubtitle")} value={value.heroSubtitle} onChange={(heroSubtitle) => set({ heroSubtitle })} multiline rows={3} />
                    <LocalizedField label={t("admin.settings.announcement")} value={value.announcement} onChange={(announcement) => set({ announcement })} hint={t("admin.settings.announcementHint")} />
                  </div>
                </Panel>
              )}
            </SectionForm>
          ) : null}

          {tab === "contact" ? (
            <SectionForm section="contact" initial={settings.contact}>
              {(value, set) => (
                <Panel title={t("admin.settings.tab.contact")}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <TextInput label={t("admin.settings.telegram")} value={value.telegram} onChange={(telegram) => set({ telegram: telegram.replace(/^@/, "") })} placeholder="support_username" />
                    <TextInput label={t("admin.settings.supportEmail")} value={value.supportEmail} onChange={(supportEmail) => set({ supportEmail })} placeholder="support@zhihe.cyou" />
                    <div className="sm:col-span-2">
                      <LocalizedField label={t("admin.settings.supportHours")} value={value.supportHours} onChange={(supportHours) => set({ supportHours })} />
                    </div>
                  </div>
                </Panel>
              )}
            </SectionForm>
          ) : null}

          {tab === "social" ? (
            <SectionForm section="social" initial={settings.social}>
              {(value, set) => (
                <Panel title={t("admin.settings.tab.social")} description={t("admin.settings.socialHint")}>
                  <div className="grid gap-5 sm:grid-cols-2">
                    {(["telegramChannel", "x", "instagram", "youtube", "vk"] as const).map((key) => (
                      <TextInput key={key} label={t(`admin.settings.social.${key}`)} value={value[key]} onChange={(text) => set({ [key]: text } as Partial<typeof value>)} placeholder="https://" />
                    ))}
                  </div>
                </Panel>
              )}
            </SectionForm>
          ) : null}

          {tab === "footer" ? (
            <SectionForm section="footer" initial={settings.footer}>
              {(value, set) => (
                <Panel title={t("admin.settings.tab.footer")}>
                  <div className="grid gap-5">
                    <LocalizedField label={t("admin.settings.footerAbout")} value={value.about} onChange={(about) => set({ about })} multiline rows={3} />
                    <LocalizedField label={t("admin.settings.footerLegal")} value={value.legal} onChange={(legal) => set({ legal })} />
                  </div>
                </Panel>
              )}
            </SectionForm>
          ) : null}

          {tab === "faq" ? (
            <SectionForm section="faq" initial={settings.faq}>
              {(value, set) => (
                <Panel
                  title={t("admin.settings.tab.faq")}
                  description={t("admin.settings.faqHint")}
                  actions={
                    <Button size="sm" onClick={() => set({ items: [...value.items, { question: {}, answer: {} }] })}>
                      <Plus className="size-3.5" />
                      {t("admin.add")}
                    </Button>
                  }
                >
                  <div className="space-y-3">
                    {value.items.map((item, index) => (
                      <div key={index} className="rounded-xl border border-line bg-panel-2/40 p-4">
                        <div className="grid gap-4">
                          <LocalizedField label={t("admin.faq.question")} value={item.question} onChange={(question) => set({ items: value.items.map((entry, i) => (i === index ? { ...entry, question } : entry)) })} />
                          <LocalizedField label={t("admin.faq.answer")} value={item.answer} multiline rows={3} onChange={(answer) => set({ items: value.items.map((entry, i) => (i === index ? { ...entry, answer } : entry)) })} />
                        </div>
                        <div className="mt-3 flex justify-end">
                          <Button size="sm" variant="ghost" onClick={() => set({ items: value.items.filter((_, i) => i !== index) })}>
                            <Trash2 className="size-3.5" />
                            {t("common.remove")}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </Panel>
              )}
            </SectionForm>
          ) : null}

          {tab === "payments" ? (
            <SectionForm section="payments" initial={settings.payments}>
              {(value, set) => (
                <>
                  <Panel title="CryptoBot · Crypto Pay">
                    <div className="grid gap-5">
                      <div className="flex flex-wrap items-center gap-4">
                        <Status ok={integrations.cryptobot} label={integrations.cryptobot ? t("admin.settings.tokenConfigured", { network: integrations.cryptobotNetwork }) : t("admin.settings.tokenMissing", { name: "CRYPTOBOT_API_TOKEN" })} />
                      </div>
                      <div>
                        <span className="field-label">{t("admin.settings.webhookUrl")}</span>
                        <div className="flex gap-2">
                          <code className="input flex items-center truncate font-mono text-[13px]">{integrations.webhookUrl}</code>
                          <CopyButton value={integrations.webhookUrl} />
                        </div>
                        <p className="field-hint">{t("admin.settings.webhookHint")}</p>
                      </div>
                      <SwitchField label={t("admin.settings.cryptobotEnabled")} checked={value.cryptobotEnabled} onChange={(event) => set({ cryptobotEnabled: event.target.checked })} />
                      <TextInput label={t("admin.settings.cryptobotAssets")} value={value.cryptobotAssets.join(", ")} onChange={(text) => set({ cryptobotAssets: text.split(",").map((asset) => asset.trim().toUpperCase()).filter(Boolean) })} hint={t("admin.settings.cryptobotAssetsHint")} mono />
                    </div>
                  </Panel>
                  <Panel
                    title={t("admin.settings.manualCrypto")}
                    actions={
                      <Button size="sm" onClick={() => set({ manualWallets: [...value.manualWallets, { id: "", label: "", network: "TRC20", asset: "USDT", address: "", memo: "" }] })}>
                        <Plus className="size-3.5" />
                        {t("admin.settings.addWallet")}
                      </Button>
                    }
                  >
                    <div className="grid gap-5">
                      <SwitchField label={t("admin.settings.manualEnabled")} description={t("admin.settings.manualHint")} checked={value.manualEnabled} onChange={(event) => set({ manualEnabled: event.target.checked })} />
                      {value.manualWallets.map((wallet, index) => {
                        const update = (patch: Partial<typeof wallet>) => set({ manualWallets: value.manualWallets.map((item, i) => (i === index ? { ...item, ...patch } : item)) });
                        return (
                          <div key={wallet.id || index} className="grid gap-3 rounded-xl border border-line bg-panel-2/40 p-4 sm:grid-cols-3">
                            <TextInput label={t("admin.settings.walletLabel")} value={wallet.label} onChange={(label) => update({ label })} placeholder="USDT TRC20" />
                            <TextInput label={t("admin.settings.walletAsset")} value={wallet.asset} onChange={(asset) => update({ asset: asset.toUpperCase() })} mono />
                            <TextInput label={t("admin.settings.walletNetwork")} value={wallet.network} onChange={(network) => update({ network })} mono />
                            <div className="sm:col-span-2">
                              <TextInput label={t("admin.settings.walletAddress")} value={wallet.address} onChange={(address) => update({ address: address.trim() })} mono />
                            </div>
                            <TextInput label={t("admin.settings.walletMemo")} value={wallet.memo} onChange={(memo) => update({ memo })} mono />
                            <div className="flex justify-end sm:col-span-3">
                              <Button size="sm" variant="ghost" onClick={() => set({ manualWallets: value.manualWallets.filter((_, i) => i !== index) })}>
                                <Trash2 className="size-3.5" />
                                {t("common.remove")}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      <LocalizedField label={t("admin.settings.manualInstructions")} value={value.manualInstructions} onChange={(manualInstructions) => set({ manualInstructions })} multiline rows={3} />
                    </div>
                  </Panel>
                  <Panel title={t("admin.settings.cards")}>
                    <p className="text-sm text-fg-muted">{t("admin.settings.cardsHint")}</p>
                  </Panel>
                </>
              )}
            </SectionForm>
          ) : null}

          {tab === "notifications" ? (
            <SectionForm section="notifications" initial={settings.notifications}>
              {(value, set) => (
                <>
                  <Panel title="Telegram">
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Status ok={integrations.telegram} label={integrations.telegram ? t("admin.settings.telegramReady") : t("admin.settings.tokenMissing", { name: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID" })} />
                        <testFetcher.Form method="post">
                          <input type="hidden" name="intent" value="test_telegram" />
                          <Button type="submit" size="sm" disabled={!integrations.telegram} loading={testFetcher.state !== "idle"}>
                            <Send className="size-3.5" />
                            {t("admin.settings.sendTest")}
                          </Button>
                        </testFetcher.Form>
                      </div>
                      <SwitchField label={t("admin.settings.notifyPaid")} checked={value.telegramPaidOrder} onChange={(event) => set({ telegramPaidOrder: event.target.checked })} />
                      <SwitchField label={t("admin.settings.notifyNew")} checked={value.telegramNewOrder} onChange={(event) => set({ telegramNewOrder: event.target.checked })} />
                      <SwitchField label={t("admin.settings.notifyLowStock")} checked={value.telegramLowStock} onChange={(event) => set({ telegramLowStock: event.target.checked })} />
                      <label className="block max-w-xs">
                        <span className="field-label">{t("admin.settings.lowStockThreshold")}</span>
                        <input type="number" min={0} className="input tabular" value={value.lowStockThreshold} onChange={(event) => set({ lowStockThreshold: Math.max(0, Number(event.target.value) || 0) })} />
                      </label>
                    </div>
                  </Panel>
                  <Panel title="Email">
                    <div className="grid gap-3">
                      <Status ok={integrations.email} label={integrations.email ? t("admin.settings.emailReady") : t("admin.settings.tokenMissing", { name: "RESEND_API_KEY / EMAIL_FROM" })} />
                      <SwitchField label={t("admin.settings.emailCustomers")} description={t("admin.settings.emailCustomersHint")} checked={value.emailCustomers} onChange={(event) => set({ emailCustomers: event.target.checked })} />
                    </div>
                  </Panel>
                </>
              )}
            </SectionForm>
          ) : null}
        </div>
      </div>
    </>
  );
}
