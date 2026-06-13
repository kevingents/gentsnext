"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { colorSwatch } from "@/lib/colors";
import { formatEuro } from "@/lib/pricing";
import { sizeRowLabel } from "@/lib/size-taxonomy";
import { usePdpSize } from "@/components/pdp/pdp-size-context";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { DeliveryPromise } from "@/components/pdp/delivery-promise";
import { ClickAndCollect } from "@/components/pdp/click-collect";
import { StockNotify } from "@/components/pdp/stock-notify";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { RatingStars } from "@/components/rating-stars";
import type { ProductRating } from "@/lib/reviews";
import { useCart } from "@/components/cart/cart-context";

export type BuyColor = { color: string; sizes: BuySize[] };
export type BuySize = {
  size: string;
  sku: string;
  priceCents: number;
  qty: number;
  known: boolean;
  branches?: { store: string; qty: number; openNow?: boolean; openLabel?: string }[];
};

type Props = {
  title: string;
  vendor: string;
  rating?: ProductRating | null;
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
  rating,
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
  const { setSizeLabel } = usePdpSize();
  const [colorIdx, setColorIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const active = colors[Math.min(colorIdx, colors.length - 1)];

  // Deel de gekozen maat-bucket met de galerij (foto aanpassen bij grote maten).
  useEffect(() => {
    setSizeLabel(size ? sizeRowLabel(size) : null);
  }, [size, setSizeLabel]);

  const selectedSize = useMemo(
    () => active?.sizes.find((s) => s.size === size) ?? null,
    [active, size]
  );
  const priceCents = selectedSize?.priceCents ?? minPriceCents;
  const priceLabel = (minPriceCents !== maxPriceCents && !selectedSize ? "vanaf " : "") + formatEuro(priceCents);
  const soldOut = Boolean(selectedSize && selectedSize.known && selectedSize.qty <= 0);
  // Hele kleur/product uitverkocht: geen enkele bekende maat heeft voorraad.
  const allSoldOut = Boolean(
    hasStock && active && active.sizes.length > 0 && active.sizes.every((s) => !s.known || s.qty <= 0)
  );

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
      {rating ? (
        <div className="mt-2">
          <RatingStars rating={rating} size="sm" />
        </div>
      ) : null}

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
                  className={`h-8 w-8 rounded-card border-2 ${on ? "border-ink" : "border-line"}`}
                  style={{ background: sw.gradient ?? sw.hex }}
                />
              );
            })}
          </div>
        </div>
      ) : active && active.color !== "Standaard" && !title.toLowerCase().includes(active.color.toLowerCase()) ? (
        // Alleen tonen als de kleur NIET al in de titel staat (geen dubbeling).
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
              selectedSize.qty <= 5 ? (
                <span className="text-danger">● Nog maar {selectedSize.qty} op voorraad — wees er snel bij</span>
              ) : (
                <span className="text-success">● Op voorraad — maat {selectedSize.size}</span>
              )
            ) : (
              <span className="text-muted">Maat {selectedSize.size} tijdelijk uitverkocht</span>
            )}
          </p>
        ) : null}
        {/* Mail-me bij een uitverkochte gekozen maat (niet als het hele product op is). */}
        {soldOut && !allSoldOut ? (
          <StockNotify
            productHandle={productHandle}
            productTitle={title}
            sku={selectedSize?.sku}
            size={selectedSize?.size}
            color={active?.color}
            variant="compact"
          />
        ) : null}
        {selectedSize && selectedSize.branches && selectedSize.branches.length ? (
          <ClickAndCollect branches={selectedSize.branches} />
        ) : null}
        {active && active.sizes.length >= 2 ? (
          <p className="mt-3 rounded-card bg-surface px-3 py-2 font-sans text-xs text-ink-soft">
            <span className="font-medium text-ink">Twijfel je tussen twee maten?</span> Bestel ze allebei en
            retourneer <strong>gratis</strong> wat niet past — binnen 14 dagen.
          </p>
        ) : null}
      </div>

      <DeliveryPromise />

      {/* Bestelknop + bewaren — of, als alles uitverkocht is, de mail-me-blok. */}
      {allSoldOut ? (
        <div className="mt-7">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" disabled className="btn-primary w-full opacity-60">
              Uitverkocht
            </button>
            <WishlistButton handle={productHandle} variant="pdp" />
          </div>
          <StockNotify
            productHandle={productHandle}
            productTitle={title}
            color={active?.color}
            variant="block"
          />
        </div>
      ) : (
        <>
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
        </>
      )}

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
