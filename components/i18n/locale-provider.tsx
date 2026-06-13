"use client";

import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { t as translate } from "@/lib/messages";

const Ctx = createContext<Locale>(DEFAULT_LOCALE);

/** Locale vanaf de server doorgeven aan client components (geen hydration-mismatch). */
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}

export function useLocale(): Locale {
  return useContext(Ctx);
}

/** Vertaalhelper voor client components. */
export function useT(): (key: string) => string {
  const locale = useContext(Ctx);
  return (key: string) => translate(key, locale);
}
