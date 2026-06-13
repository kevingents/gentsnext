"use client";

import { useEffect, useState } from "react";

/**
 * Slimme levertijd-indicatie: vóór 16:00 op werkdagen = morgen in huis, anders
 * de eerstvolgende werkdag. Client-side zodat de tekst klopt met de
 * bezoekerstijd (en niet vastpint op de servertijd).
 */
function nextDeliveryLabel(now: Date): string {
  const day = now.getDay(); // 0=zo,1=ma,...
  const hour = now.getHours();
  const beforeCutoff = hour < 16;
  // Aantal dagen vooruit voor verzending: 0 = vandaag, 1 = morgen
  let shipDayOffset = beforeCutoff ? 0 : 1;
  let ship = new Date(now);
  ship.setDate(ship.getDate() + shipDayOffset);
  // Verzending alleen op werkdagen (1–5); schuif naar maandag.
  while (ship.getDay() === 0 || ship.getDay() === 6) ship.setDate(ship.getDate() + 1);
  // Bezorging = volgende werkdag na verzending.
  let deliver = new Date(ship);
  deliver.setDate(deliver.getDate() + 1);
  while (deliver.getDay() === 0 || deliver.getDay() === 6) deliver.setDate(deliver.getDate() + 1);

  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dCmp = new Date(deliver); dCmp.setHours(0, 0, 0, 0);
  const days = Math.round((dCmp.getTime() - today.getTime()) / 86400000);

  const fmt = new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" }).format(deliver);
  if (days === 1) return `Morgen in huis (${fmt})`;
  if (days === 2) return `Overmorgen in huis (${fmt})`;
  return `In huis op ${fmt}`;
}

function cutoffSuffix(now: Date): string {
  if (now.getDay() === 0 || now.getDay() === 6) return "Bestellingen op zaterdag en zondag verzenden we maandag.";
  return now.getHours() < 16
    ? "Voor 16:00 besteld, vandaag nog verzonden."
    : "Voor 16:00 besteld, morgen verzonden.";
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

export function DeliveryPromise({ cutoffHour = 16 }: { cutoffHour?: number }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(id);
  }, []);
  if (!now) return null;
  const countdown = countdownLabel(now, cutoffHour);
  return (
    <div className="mt-6 border-y border-line py-3">
      <p className="font-sans text-sm">
        <span className="text-success">●</span>{" "}
        <span className="font-medium">{nextDeliveryLabel(now)}</span>
      </p>
      {countdown ? (
        <p className="mt-1 font-sans text-xs font-medium text-danger">⏱ {countdown}</p>
      ) : (
        <p className="mt-1 font-sans text-xs text-muted">{cutoffSuffix(now)}</p>
      )}
    </div>
  );
}
