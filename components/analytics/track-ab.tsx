"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

/**
 * Logt één ab_exposure per sessie per experiment (dedupe via localStorage,
 * zelfde patroon als TrackPurchase). De handle "<experiment>:<variant>" is de
 * sleutel waar de resultaten-query op groepeert.
 *
 * Exposure wordt pas gelogd als de bezoeker de geteste pagina écht te zien
 * krijgt — dit component staat op de homepage, niet in de layout. Wie de test
 * nooit zag hoort niet in de noemer van de conversie.
 */
export function TrackAb({ assignments }: { assignments: { id: string; variant: string }[] }) {
  useEffect(() => {
    for (const a of assignments) {
      const key = `gents-ab-${a.id}`;
      try {
        if (localStorage.getItem(key) === a.variant) continue;
        localStorage.setItem(key, a.variant);
      } catch {
        /* private mode: dan hooguit een dubbele exposure; distinct-telling vangt dat op */
      }
      track("ab_exposure", { handle: `${a.id}:${a.variant}` });
    }
  }, [assignments]);
  return null;
}
