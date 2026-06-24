"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { t as translate, interpolate } from "@/lib/messages";

type Messages = Record<string, string>;
type Ctx = { locale: Locale; messages: Messages | null };

const LocaleCtx = createContext<Ctx>({ locale: DEFAULT_LOCALE, messages: null });

/**
 * Locale + (optioneel) de volledige, op de server samengestelde UI-dictionary
 * doorgeven aan client components. De dictionary bevat de cron-vertalingen uit
 * de store; ontbreekt die, dan valt useT terug op de statische dict.
 */
export function LocaleProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages?: Messages;
  children: React.ReactNode;
}) {
  return <LocaleCtx.Provider value={{ locale, messages: messages ?? null }}>{children}</LocaleCtx.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleCtx).locale;
}

/** Vertaalhelper voor client components. Tweede arg = params voor {placeholders}. */
export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const { locale, messages } = useContext(LocaleCtx);
  return (key: string, params?: Record<string, string | number>) => {
    const raw = messages?.[key];
    return raw != null ? interpolate(raw, params) : translate(key, locale, params);
  };
}
