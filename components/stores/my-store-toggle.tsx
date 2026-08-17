"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";
import { track } from "@/lib/track-client";

/**
 * "Maak dit mijn winkel" — één knop, overal dezelfde.
 *
 * Stond eerst alleen als kále ster in de afhaal-lade op de PDP: geen tekst, dus
 * niemand die 'm vond of begreep wat 'ie deed. Deze knop draagt altijd een
 * zichtbaar label (de ster is versiering, geen betekenisdrager) en zegt in de
 * uit-stand wát je krijgt, niet alleen wát het is.
 */

/** Zoals /api/mijn-winkel 'm teruggeeft — genoeg voor elke plek die 'm toont. */
export type MyStore = { pageHandle: string; title: string; city: string };

export function StarIcon({ filled, className = "h-4 w-4" }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8-4.2-4.1 5.9-.9z" strokeLinejoin="round" />
    </svg>
  );
}

export function MyStoreToggle({
  value,
  active,
  onChange,
  variant = "button",
  className = "",
  bron = "onbekend",
}: {
  /** pageHandle óf winkelnaam — /api/mijn-winkel accepteert allebei. */
  value: string;
  active: boolean;
  /** Lokale echo voor de aanroeper: de serverprop komt pas na de refresh mee. */
  onChange?: (stores: MyStore[]) => void;
  /** "button" = omrande knop, "inline" = tekstknop in een rij. */
  variant?: "button" | "inline";
  /** Waar stond de knop? Zo zien we wélke plek de winkelkeuze oplevert. */
  bron?: string;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();

  async function toggle() {
    if (busy) return;
    setBusy(true);
    try {
      // Erbij of eraf; de server houdt de lijst bij (max MAX_MY_STORES) en
      // stuurt 'm terug, zodat de knop nooit een eigen waarheid verzint.
      const r = await fetch("/api/mijn-winkel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toggle: value }),
      });
      const d = (await r.json().catch(() => null)) as { stores?: MyStore[] } | null;
      if (d?.stores) onChange?.(d.stores);
      // Meten wélke plek winkels oplevert — anders weet je alleen dát er
      // gekozen wordt, niet waar de knop werkt.
      track("mijn_winkel", { props: { winkel: value, aan: !active, aantal: d?.stores?.length ?? 0, bron } });
      // Alles wat "mijn winkels" toont (kop, PDP-regel, PLP-filter) leest de
      // cookie op de server — pas na een refresh klopt het overal.
      startTransition(() => router.refresh());
    } catch {
      /* een voorkeur is comfort, geen blocker */
    } finally {
      setBusy(false);
    }
  }

  const label = active ? t("myStore.isMine") : t("myStore.set");
  const base =
    variant === "inline"
      ? `inline-flex min-h-11 items-center gap-1.5 font-sans text-sm underline underline-offset-4 lg:min-h-0 ${active ? "text-ink" : "text-ink-soft hover:text-ink"}`
      : `inline-flex min-h-11 items-center gap-2 border px-3 py-2 font-sans text-sm transition-colors ${
          active ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink"
        }`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={active}
      title={active ? t("myStore.unset") : t("myStore.set")}
      className={`${base} ${busy ? "opacity-60" : ""} ${className}`}
    >
      <StarIcon filled={active} className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
