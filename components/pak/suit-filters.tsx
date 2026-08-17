"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { SuitCard } from "@/lib/suit-pairing";
import { formatEuro } from "@/lib/pricing";

/**
 * Filterbalk + grid voor /pak-samenstellen. De PLP-filters (components/plp/filters)
 * draaien op een server-query met facetten; hier gaat het om ~46 pakken die al
 * volledig geladen zijn, dus filteren we in de client — geen extra rondje naar de DB.
 *
 * Let op de kleurdekking: een deel van de colberts heeft een lege
 * variant_color_label. Die vallen niet stilzwijgend weg — ze horen bij "Alle
 * kleuren" en het aantal zonder kleur staat onder de balk.
 */

type Props = {
  suits: SuitCard[];
  labels: {
    twoPiece: string;
    twoOrThreePiece: string;
    from: string;
    allFits: string;
    allColors: string;
    threePieceOnly: string;
    results: string;
    reset: string;
    noMatch: string;
  };
};

const SELECT =
  "border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none";

export function SuitFilters({ suits, labels }: Props) {
  const [fit, setFit] = useState("");
  const [color, setColor] = useState("");
  const [threeOnly, setThreeOnly] = useState(false);

  const fits = useMemo(
    () => [...new Set(suits.map((s) => s.fit).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [suits]
  );
  const colors = useMemo(
    () => [...new Set(suits.map((s) => s.color).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [suits]
  );
  const zonderKleur = useMemo(() => suits.filter((s) => !s.color).length, [suits]);

  const zichtbaar = useMemo(
    () =>
      suits.filter(
        (s) => (!fit || s.fit === fit) && (!color || s.color === color) && (!threeOnly || s.threePiece)
      ),
    [suits, fit, color, threeOnly]
  );

  const actief = Boolean(fit || color || threeOnly);

  return (
    <>
      <div className="mt-10 flex flex-wrap items-center gap-3">
        {fits.length > 1 ? (
          <select value={fit} onChange={(e) => setFit(e.target.value)} aria-label={labels.allFits} className={SELECT}>
            <option value="">{labels.allFits}</option>
            {fits.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : null}

        {colors.length > 1 ? (
          <select value={color} onChange={(e) => setColor(e.target.value)} aria-label={labels.allColors} className={SELECT}>
            <option value="">{labels.allColors}</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}

        <label className="flex items-center gap-2 font-sans text-sm text-ink">
          <input type="checkbox" checked={threeOnly} onChange={(e) => setThreeOnly(e.target.checked)} />
          {labels.threePieceOnly}
        </label>

        <span className="font-sans text-sm text-muted">
          {zichtbaar.length} {labels.results}
        </span>

        {actief ? (
          <button
            type="button"
            onClick={() => {
              setFit("");
              setColor("");
              setThreeOnly(false);
            }}
            className="font-sans text-sm text-ink underline"
          >
            {labels.reset}
          </button>
        ) : null}
      </div>

      {color && zonderKleur ? (
        <p className="mt-2 font-sans text-xs text-muted">
          {zonderKleur} {zonderKleur === 1 ? "pak heeft" : "pakken hebben"} geen kleur vastgelegd en valt buiten dit
          filter.
        </p>
      ) : null}

      {zichtbaar.length === 0 ? (
        <p className="mt-10 font-sans text-ink-soft">{labels.noMatch}</p>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {zichtbaar.map((s) => (
            <Link key={s.code} href={`/pak-samenstellen/${s.colbertHandle}`} className="group flex flex-col gap-3">
              <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-surface">
                {s.tileImage ? (
                  <Image
                    src={s.tileImage}
                    alt={s.title}
                    fill
                    sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                    className="object-cover transition duration-500 ease-brand group-hover:scale-[1.04]"
                  />
                ) : null}
                <span className="absolute left-2 top-2 bg-canvas/90 px-2 py-0.5 font-sans text-[0.65rem] uppercase tracking-wide">
                  {s.threePiece ? labels.twoOrThreePiece : labels.twoPiece}
                </span>
              </div>
              <div>
                <h2 className="font-sans text-sm text-ink">{s.title}</h2>
                <p className="font-sans text-sm text-ink-soft">
                  {labels.from} {formatEuro(s.fromCents)}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
