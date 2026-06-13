"use client";

import { useEffect, useState } from "react";

/**
 * Levertijd-indicatie op de PDP. De headline komt bij voorkeur server-side uit
 * de echte allocatie-engine (estimateDelivery: voorraad-locatie, split, NL-
 * feestdagen, instelbare cutoff) en wordt als `promise` doorgegeven. Zonder
 * server-belofte valt 'ie terug op een client-schatting. De aftelteller is
 * altijd client-side, zodat hij klopt met de tijd van de bezoeker.
 */
function nextDeliveryLabel(now: Date): string {
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
  if (days === 1) return `Morgen in huis (${fmt})`;
  if (days === 2) return `Overmorgen in huis (${fmt})`;
  return `In huis op ${fmt}`;
}

function cutoffSuffix(now: Date, cutoffHour: number): string {
  if (now.getDay() === 0 || now.getDay() === 6) return "Bestellingen op zaterdag en zondag verzenden we maandag.";
  return now.getHours() < cutoffHour
    ? `Voor ${cutoffHour}:00 besteld, vandaag nog verzonden.`
    : `Voor ${cutoffHour}:00 besteld, morgen verzonden.`;
}

/** Live aftel-tekst tot de cutoff, voor urgentie ("bestel binnen 2u 14m"). */
function countdownLabel(now: Date, cutoffHour: number): string | null {
  const day = now.getDay();
  if (day === 0 || day === 6) return null; // weekend → geen vandaag-verzending
  const cutoff = new Date(now);
  cutoff.setHours(cutoffHour, 0, 0, 0);
  const ms = cutoff.getTime() - now.getTime();
  if (ms <= 0) return null;
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const t = h > 0 ? `${h} uur en ${m} min` : `${m} min`;
  return `Bestel binnen ${t} en wij versturen het vandaag nog`;
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
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  // Eerste render (SSR/hydration): toon in elk geval de server-belofte.
  const headline = promise || (now ? nextDeliveryLabel(now) : null);
  if (!headline) return null;

  const countdown = now ? countdownLabel(now, cutoffHour) : null;

  return (
    <div className="mt-6 border-y border-line py-3">
      <p className="font-sans text-sm">
        <span className="text-success">●</span> <span className="font-medium">{headline}</span>
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
        <p className="mt-1 font-sans text-xs text-muted">{cutoffSuffix(now, cutoffHour)}</p>
      ) : null}
    </div>
  );
}
