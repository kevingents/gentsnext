"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { colorSwatch } from "@/lib/colors";
import { formatEuro } from "@/lib/pricing";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { DeliveryPromise } from "@/components/pdp/delivery-promise";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { useCart } from "@/components/cart/cart-context";

export type BuyColor = { color: string; sizes: BuySize[] };
export type BuySize = { size: string; sku: string; priceCents: number; qty: number; known: boolean };

type Props = {
  title: string;
  vendor: string;
  hoofdgroep: string;
  sizeChartHandle: string | null;
  productHandle: string;
  image: string;
  colors: BuyColor[];
  minPriceCents: number;
  maxPriceCents: number;
  referenceCents?: number;
  hasStock: boolean;
};

export function BuyBox({
  title,
  vendor,
  hoofdgroep,
  sizeChartHandle,
  productHandle,
  image,
  colors,
  minPriceCents,
  maxPriceCents,
  referenceCents,
  hasStock,
}: Props) {
  const cart = useCart();
  const [colorIdx, setColorIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const active = colors[Math.min(colorIdx, colors.length - 1)];

  const selectedSize = useMemo(
    () => active?.sizes.find((s) => s.size === size) ?? null,
    [active, size]
  );
  const priceCents = selectedSize?.priceCents ?? minPriceCents;
  const priceLabel = (minPriceCents !== maxPriceCents && !selectedSize ? "vanaf " : "") + formatEuro(priceCents);
  const soldOut = Boolean(selectedSize && selectedSize.known && selectedSize.qty <= 0);

  function addToCart() {
    if (!selectedSize || !active || soldOut) return;
    cart.add({
      sku: selectedSize.sku,
      productHandle,
      title,
      size: selectedSize.size,
      color: active.color === "Standaard" ? "" : active.color,
      priceCents: selectedSize.priceCents,
      imageUrl: image,
      qty: 1,
      hoofdgroep,
    });
  }

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
          <div className="flex items-center gap-3 font-sans text-xs">
            {sizeChartHandle ? (
              <Link href={`/pages/${sizeChartHandle}`} className="text-ink-soft underline underline-offset-4 hover:text-ink">
                Maattabel
              </Link>
            ) : null}
            <Link href="/maatadvies" className="text-ink underline underline-offset-4">
              Vind mijn maat
            </Link>
          </div>
        </div>
        {active ? (
          <SizeMatrix
            sizes={active.sizes}
            hoofdgroep={hoofdgroep}
            selected={size}
            onSelect={setSize}
          />
        ) : null}
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

      <DeliveryPromise />

      {/* Bestelknop + bewaren */}
      <div className="mt-7 grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={addToCart}
          disabled={!size || soldOut}
          className="btn-primary w-full"
        >
          {!size ? "Kies een maat" : soldOut ? "Uitverkocht" : `In winkelwagen — maat ${size}`}
        </button>
        <WishlistButton handle={productHandle} variant="pdp" />
      </div>
      <p className="mt-3 font-sans text-xs text-muted">
        Gratis retour binnen 14 dagen. Afrekenen met iDEAL volgt binnenkort.
      </p>

      {/* Sticky mobiele bestelbalk */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-page items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-sans text-xs text-muted">{title}</p>
            <p className="font-display text-base">{priceLabel}</p>
          </div>
          <button
            type="button"
            onClick={addToCart}
            disabled={!size || soldOut}
            className="btn-primary !px-5"
          >
            {!size ? "Kies maat" : soldOut ? "Uitverkocht" : "In winkelwagen"}
          </button>
        </div>
      </div>
    </div>
  );
}
