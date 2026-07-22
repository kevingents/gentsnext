"use client";

import { useEffect, useState } from "react";
import { useLocale, useT } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n";

type TFn = (key: string, params?: Record<string, string | number>) => string;

// Zelfde locale→Intl-tag-mapping als DELIVERY_STRINGS.intl in lib/fulfillment.ts
// (dat bestand is server-side; hier de client-kopie voor de fallback-datum).
const INTL_TAG: Record<Locale, string> = { nl: "nl-NL", en: "en-GB", de: "de-DE", fr: "fr-FR", es: "es-ES" };

/**
 * Levertijd-indicatie op de PDP. De headline komt bij voorkeur server-side uit
 * de echte allocatie-engine (estimateDelivery: voorraad-locatie, split, NL-
 * feestdagen, instelbare cutoff) en wordt als `promise` doorgegeven. Zonder
 * server-belofte valt 'ie terug op een client-schatting. De aftelteller is
 * altijd client-side, zodat hij klopt met de tijd van de bezoeker.
 */
function nextDeliveryLabel(now: Date, t: TFn, intlTag: string): string {
  const beforeCutoff = now.getHours() < 16;
  const shipDayOffset = beforeCutoff ? 0 : 1;
  const ship = new Date(now);
  ship.setDate(ship.getDate() + shipDayOffset);
  while (ship.getDay() === 0 || ship.getDay() === 6) ship.setDate(ship.getDate() + 1);
  const deliver = new Date(ship);
  deliver.setDate(deliver.getDate() + 1);
  while (deliver.getDay() === 0 || deliver.getDay() === 6) deliver.setDate(deliver.getDate() + 1);

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const dCmp = new Date(deliver);
  dCmp.setHours(0, 0, 0, 0);
  const days = Math.round((dCmp.getTime() - today.getTime()) / 86400000);

  const fmt = new Intl.DateTimeFormat(intlTag, { weekday: "long", day: "numeric", month: "long" }).format(deliver);
  if (days === 1) return t("delivery.tomorrowDated", { date: fmt });
  if (days === 2) return t("delivery.dayAfterDated", { date: fmt });
  return t("delivery.onDateDated", { date: fmt });
}

function cutoffSuffix(now: Date, cutoffHour: number, t: TFn): string {
  if (now.getDay() === 0 || now.getDay() === 6) return t("delivery.weekendNote");
  return now.getHours() < cutoffHour
    ? t("delivery.cutoffToday", { hour: cutoffHour })
    : t("delivery.cutoffTomorrow", { hour: cutoffHour });
}

export function DeliveryPromise({
  promise,
  note,
  cutoffHour = 16,
  extra,
}: {
  promise?: string | null;
  note?: string | null;
  cutoffHour?: number;
  /** Extra rustige regel in hetzelfde blok (bv. "Gratis verzending") — voorkomt
   *  losse info-regels onder elkaar op mobiel. */
  extra?: string | null;
}) {
  const t = useT();
  const locale = useLocale();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Eerste render (SSR/hydration): toon in elk geval de server-belofte.
  const headline = promise || (now ? nextDeliveryLabel(now, t, INTL_TAG[locale]) : null);
  // Zonder headline maar mét extra ("Gratis verzending") tóch renderen — anders
  // staat die regel zonder JS/zonder server-belofte nergens in de HTML.
  if (!headline && !extra) return null;

  // Bewust GEEN rode aftelteller meer: die herhaalde de headline ("voor 16:00
  // besteld…") in schreeuwerig rood en maakte de PDP druk. Eén kalme belofte.
  const sub = [note, !promise && now ? cutoffSuffix(now, cutoffHour, t) : null, extra]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mt-6 border-y border-line py-3">
      {headline ? (
        <p className="flex items-center gap-1.5 font-sans text-sm">
          <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0 text-success"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>
          <span className="font-medium">{headline}</span>
        </p>
      ) : null}
      {sub ? <p className={`${headline ? "mt-1 " : ""}font-sans text-xs text-muted`}>{sub}</p> : null}
    </div>
  );
}
