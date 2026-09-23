import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import type { MessageKey } from "./messages";
import { translate, type Messages, type TranslateVars } from "./translate";

interface I18nValue {
  locale: Locale;
  messages: Messages;
}

const I18nContext = createContext<I18nValue>({ locale: "en", messages: {} });

export function I18nProvider({ locale, messages, children }: I18nValue & { children: ReactNode }) {
  const parent = useContext(I18nContext);
  const value = useMemo(
    () => ({ locale, messages: parent.locale === locale ? { ...parent.messages, ...messages } : messages }),
    [locale, messages, parent],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}

export function useT() {
  const { messages } = useContext(I18nContext);
  return useCallback((key: MessageKey, vars?: TranslateVars) => translate(messages, key, vars), [messages]);
}
