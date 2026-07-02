"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

type TFn = (key: string, params?: Record<string, string | number>) => string;

/**
 * Levertijd-indicatie op de PDP. De headline komt bij voorkeur server-side uit
 * de echte allocatie-engine (estimateDelivery: voorraad-locatie, split, NL-
 * feestdagen, instelbare cutoff) en wordt als `promise` doorgegeven. Zonder
 * server-belofte valt 'ie terug op een client-schatting. De aftelteller is
 * altijd client-side, zodat hij klopt met de tijd van de bezoeker.
 */
function nextDeliveryLabel(now: Date, t: TFn): string {
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

  const fmt = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" }).format(deliver);
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

/** Live aftel-tekst tot de cutoff, voor urgentie ("bestel binnen 2u 14m"). */
function countdownLabel(now: Date, cutoffHour: number, t: TFn): string | null {
  const day = now.getDay();
  if (day === 0 || day === 6) return null; // weekend → geen vandaag-verzending
  const cutoff = new Date(now);
  cutoff.setHours(cutoffHour, 0, 0, 0);
  const ms = cutoff.getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const remaining = h > 0 ? t("delivery.countdown.hoursMinutes", { hours: h, minutes: m }) : t("delivery.countdown.minutes", { minutes: m });
  return t("delivery.countdownLabel", { remaining });
}

export function DeliveryPromise({
  promise,
  note,
  cutoffHour = 16,
}: {
  promise?: string | null;
  note?: string | null;
  cutoffHour?: number;
}) {
  const t = useT();
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Eerste render (SSR/hydration): toon in elk geval de server-belofte.
  const headline = promise || (now ? nextDeliveryLabel(now, t) : null);
  if (!headline) return null;

  const countdown = now ? countdownLabel(now, cutoffHour, t) : null;

  return (
    <div className="mt-6 border-y border-line py-3">
      <p className="flex items-center gap-1.5 font-sans text-sm">
        <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0 text-success"><circle cx="4" cy="4" r="4" fill="currentColor" /></svg>
        <span className="font-medium">{headline}</span>
      </p>
      {note ? <p className="mt-1 font-sans text-xs text-muted">{note}</p> : null}
      {countdown ? (
        <p className="mt-1 flex items-center gap-1.5 font-sans text-xs font-medium text-danger">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <circle cx="12" cy="13" r="8" />
            <path d="M12 9v4l2.5 2.5M9 2h6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {countdown}
        </p>
      ) : !promise && now ? (
        <p className="mt-1 font-sans text-xs text-muted">{cutoffSuffix(now, cutoffHour, t)}</p>
      ) : null}
    </div>
  );
}
