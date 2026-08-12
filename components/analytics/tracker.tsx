"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { track, bindFlushHandlers, bindScrollDiepte, vangAttributieOp } from "@/lib/track-client";

/**
 * Mount in de layout: pageviews, scrolldiepte, attributie-opvang en de
 * flush-handlers.
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

  return null;
}

export function Tracker() {
  return (
    <Suspense fallback={null}>
      <TrackerBinnen />
    </Suspense>
  );
}
