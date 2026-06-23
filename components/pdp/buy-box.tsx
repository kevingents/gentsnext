"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorSwatch } from "@/lib/colors";
import { formatEuro } from "@/lib/pricing";
import { sizeRowLabel } from "@/lib/size-taxonomy";
import { usePdpSize } from "@/components/pdp/pdp-size-context";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { ColorSiblings, type SiblingItem } from "@/components/pdp/color-siblings";
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
  colorSiblings?: SiblingItem[];
  /** Server-belofte uit de allocatie-engine (estimateDelivery). */
  deliveryPromise?: string | null;
  deliveryNote?: string | null;
  cutoffHour?: number;
  /** Opgeslagen maat van de ingelogde klant voor deze categorie (Shop in jouw maat). */
  mySize?: string | null;
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
  colorSiblings,
  deliveryPromise,
  deliveryNote,
  cutoffHour,
  mySize,
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

  // Shop in jouw maat: selecteer de opgeslagen maat van de klant automatisch
  // voor (alleen leverbare maten), exact eerst, anders dezelfde lettermaat-bucket.
  const myBucket = mySize ? sizeRowLabel(mySize) : null;
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || size || !mySize || !active) return;
    const available = active.sizes.filter((s) => !s.known || s.qty > 0);
    const pick =
      available.find((s) => s.size === mySize) ??
      available.find((s) => sizeRowLabel(s.size) === myBucket);
    if (pick) {
      setSize(pick.size);
      autoPicked.current = true;
    }
  }, [active, mySize, myBucket, size]);
  const isMySize = Boolean(size && myBucket && sizeRowLabel(size) === myBucket);

  // One-size (bv. accessoires met maat "One"): meteen selecteren — geen maatkeuze nodig.
  const oneSize = Boolean(active && active.sizes.length === 1);
  useEffect(() => {
    if (oneSize && active && !size) setSize(active.sizes[0].size);
  }, [oneSize, active, size]);

  // Sticky mobiele bestelbalk pas tonen als de hoofd-bestelknop uit beeld is gescrolld.
  const mainCtaRef = useRef<HTMLDivElement>(null);
  const [stickyOn, setStickyOn] = useState(false);
  useEffect(() => {
    const el = mainCtaRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStickyOn(!e.isIntersecting), { rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        <span className="font-sans text-xs text-muted">incl. btw</span>
      </div>
      {referenceCents ? (
        <p className="mt-1 font-sans text-xs text-muted">
          Doorgestreepte prijs: laagste prijs in de 30 dagen vóór de korting.
        </p>
      ) : null}

      {/* Kleur — kleurvarianten (aparte producten) als balk; anders in-product-swatches; anders één regel. */}
      {colorSiblings && colorSiblings.length > 1 ? (
        <div className="mt-7">
          <ColorSiblings siblings={colorSiblings} />
        </div>
      ) : colors.length > 1 ? (
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

      {/* Maat — verborgen bij one-size (niets te kiezen). */}
      <div className="mt-6">
        {!oneSize ? (
          <>
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
          </>
        ) : null}
        {isMySize ? (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-card bg-surface px-2.5 py-1 font-sans text-xs text-ink-soft">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-success" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
            <span><span className="font-medium text-ink">Jouw maat</span> — automatisch geselecteerd</span>
          </p>
        ) : null}
        {hasStock && selectedSize ? (
          <p className="mt-3 font-sans text-xs">
            {selectedSize.qty > 0 ? (
              selectedSize.qty <= 5 ? (
                <span className="text-danger">● Nog maar {selectedSize.qty} op voorraad — wees er snel bij</span>
              ) : (
                <span className="text-success">● Op voorraad</span>
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
      </div>

      {!allSoldOut ? <DeliveryPromise promise={deliveryPromise} note={deliveryNote} cutoffHour={cutoffHour} /> : null}

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
          <div ref={mainCtaRef} className="mt-7 grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={addToCart}
              disabled={!size || soldOut}
              className="btn-primary w-full"
            >
              {!size ? "Kies een maat" : soldOut ? "Uitverkocht" : oneSize ? "In winkelwagen" : `In winkelwagen — maat ${size}`}
            </button>
            <WishlistButton handle={productHandle} variant="pdp" />
          </div>
          <p className="mt-3 font-sans text-xs text-muted">
            Gratis retour binnen 14 dagen. Veilig afrekenen met o.a. iDEAL.
          </p>
        </>
      )}

      {/* Ophalen in de winkel — secundaire optie, ónder de bestelknop */}
      {selectedSize && selectedSize.branches && selectedSize.branches.length ? (
        <ClickAndCollect branches={selectedSize.branches} />
      ) : null}

      {/* Sticky mobiele bestelbalk — alleen zodra de hoofd-knop uit beeld is. */}
      {stickyOn && !allSoldOut ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-page items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-xs text-muted">{title}</p>
              <p className="flex items-baseline gap-2 font-display text-base">
                {priceLabel}
                {size && !oneSize ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 font-sans text-xs font-medium text-ink">Maat {size}</span>
                ) : null}
              </p>
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
      ) : null}
    </div>
  );
}
