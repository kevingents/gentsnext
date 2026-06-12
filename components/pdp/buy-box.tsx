"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { colorSwatch } from "@/lib/colors";
import { formatEuro } from "@/lib/pricing";

export type BuyColor = { color: string; sizes: BuySize[] };
export type BuySize = { size: string; priceCents: number; qty: number; known: boolean };

type Props = {
  title: string;
  vendor: string;
  colors: BuyColor[];
  minPriceCents: number;
  maxPriceCents: number;
  referenceCents?: number;
  hasStock: boolean;
};

export function BuyBox({
  title,
  vendor,
  colors,
  minPriceCents,
  maxPriceCents,
  referenceCents,
  hasStock,
}: Props) {
  const [colorIdx, setColorIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const active = colors[Math.min(colorIdx, colors.length - 1)];

  const selectedSize = useMemo(
    () => active?.sizes.find((s) => s.size === size) ?? null,
    [active, size]
  );
  const priceCents = selectedSize?.priceCents ?? minPriceCents;
  const priceLabel = (minPriceCents !== maxPriceCents && !selectedSize ? "vanaf " : "") + formatEuro(priceCents);

  return (
    <div>
      {vendor ? <p className="label-brand">{vendor}</p> : null}
      <h1 className="mt-2 text-display-md">{title}</h1>

      <div className="mt-4 flex items-baseline gap-3">
        {referenceCents ? (
          <span className="font-sans text-lg text-muted line-through">{formatEuro(referenceCents)}</span>
        ) : null}
        <span className="font-display text-2xl">{priceLabel}</span>
      </div>
      {referenceCents ? (
        <p className="mt-1 font-sans text-xs text-muted">
          Doorgestreepte prijs: laagste prijs in de 30 dagen vóór de korting.
        </p>
      ) : null}

      {/* Kleur */}
      {colors.length > 1 ? (
        <div className="mt-7">
          <p className="font-sans text-sm">
            <span className="text-muted">Kleur: </span>
            <span className="font-medium">{active?.color}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {colors.map((c, i) => {
              const sw = colorSwatch(c.color);
              const on = i === colorIdx;
              return (
                <button
                  key={c.color + i}
                  type="button"
                  onClick={() => {
                    setColorIdx(i);
                    setSize(null);
                  }}
                  aria-pressed={on}
                  title={c.color}
                  className={`h-8 w-8 rounded-full border-2 ${on ? "border-ink" : "border-line"}`}
                  style={{ background: sw.gradient ?? sw.hex }}
                />
              );
            })}
          </div>
        </div>
      ) : active && active.color !== "Standaard" ? (
        <p className="mt-7 font-sans text-sm">
          <span className="text-muted">Kleur: </span>
          <span className="font-medium">{active.color}</span>
        </p>
      ) : null}

      {/* Maat */}
      <div className="mt-6">
        <div className="flex items-center justify-between">
          <p className="font-sans text-sm font-medium">Maat</p>
          <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-4">
            Vind mijn maat
          </Link>
        </div>
        <ul className="mt-2 flex flex-wrap gap-2">
          {active?.sizes.map((s) => {
            const out = s.known && s.qty <= 0;
            const low = s.known && s.qty > 0 && s.qty <= 3;
            const on = size === s.size;
            return (
              <li key={s.size}>
                <button
                  type="button"
                  disabled={out}
                  onClick={() => setSize(s.size)}
                  aria-pressed={on}
                  title={out ? "Niet op voorraad" : low ? `Nog ${s.qty} op voorraad` : undefined}
                  className={`flex min-w-[3rem] flex-col items-center border px-3 py-2 text-center font-sans text-sm transition-colors ${
                    out
                      ? "cursor-not-allowed border-line text-muted line-through decoration-muted"
                      : on
                        ? "border-ink bg-ink text-canvas"
                        : "border-line text-ink hover:border-ink"
                  }`}
                >
                  {s.size}
                  {low ? <span className="mt-0.5 text-[0.6rem] text-danger no-underline">nog {s.qty}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
        {hasStock && selectedSize ? (
          <p className="mt-3 font-sans text-xs">
            {selectedSize.qty > 0 ? (
              <span className="text-success">● Op voorraad — maat {selectedSize.size}</span>
            ) : (
              <span className="text-muted">Maat {selectedSize.size} tijdelijk uitverkocht</span>
            )}
          </p>
        ) : null}
      </div>

      {/* Bestelknop (winkelwagen volgt in fase 3) */}
      <button type="button" disabled className="btn-primary mt-7 w-full">
        {size ? `In winkelwagen — maat ${size}` : "Kies een maat"}
      </button>
      <p className="mt-3 font-sans text-xs text-muted">
        Online bestellen en afrekenen met iDEAL volgt binnenkort. Gratis retour
        binnen 14 dagen.
      </p>

      {/* Sticky mobiele bestelbalk */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-page items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-sans text-xs text-muted">{title}</p>
            <p className="font-display text-base">{priceLabel}</p>
          </div>
          <button type="button" disabled className="btn-primary !px-5">
            {size ? "In winkelwagen" : "Kies maat"}
          </button>
        </div>
      </div>
    </div>
  );
}
