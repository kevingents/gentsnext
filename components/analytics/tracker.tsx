"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { track, bindFlushHandlers, bindScrollDiepte, vangAttributieOp } from "@/lib/track-client";
import { bindHeatmap } from "@/lib/heatmap-client";

/**
 * Mount in de layout: pageviews, scrolldiepte, attributie-opvang, de
 * klik-heatmap en de flush-handlers.
 *
 * `useSearchParams` zit in een Suspense-grens omdat het anders de hele
 * storefront naar client-side rendering trekt. We hebben de querystring nodig
 * voor de attributie (utm's en klik-id's staan daarin) — een campagnelink kan
 * ook midden in een bezoek binnenkomen, bijvoorbeeld uit een mail.
 */
function TrackerBinnen() {
  const pathname = usePathname();
  const params = useSearchParams();

  useEffect(() => {
    bindFlushHandlers();
  }, []);

  useEffect(() => {
    vangAttributieOp();
    track("pageview", { path: pathname });
  }, [pathname, params]);

  useEffect(() => bindScrollDiepte(pathname), [pathname]);

  // Klik-heatmap. Per paginaweergave opnieuw gebonden, en de opruimfunctie
  // schrijft de laatste kliks van díé pagina nog weg — bij client-side
  // navigatie is er geen pagehide, dus zonder dat verdween alles wat er na de
  // laatste flush nog gebeurde. Meet alleen de pagina's uit de allowlist in
  // lib/heatmap-paginas; op de rest doet dit niets.
  useEffect(() => bindHeatmap(pathname), [pathname]);

  return null;
}

export function Tracker() {
  return (
    <Suspense fallback={null}>
      <TrackerBinnen />
    </Suspense>
  );
}
