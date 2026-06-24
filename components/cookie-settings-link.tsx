"use client";

import { openConsent } from "@/lib/consent";
import { useT } from "@/components/i18n/locale-provider";

/** Heropent de cookie-voorkeuren (voor in de footer) — keuze altijd te wijzigen. */
export function CookieSettingsLink({ className }: { className?: string }) {
  const t = useT();
  return (
    <button type="button" onClick={openConsent} className={className}>
      {t("cookies.settingsLink")}
    </button>
  );
}
