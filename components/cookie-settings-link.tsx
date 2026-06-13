"use client";

import { openConsent } from "@/lib/consent";

/** Heropent de cookie-voorkeuren (voor in de footer) — keuze altijd te wijzigen. */
export function CookieSettingsLink({ className }: { className?: string }) {
  return (
    <button type="button" onClick={openConsent} className={className}>
      Cookie-instellingen
    </button>
  );
}
