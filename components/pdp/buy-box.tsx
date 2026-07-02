"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { colorSwatch } from "@/lib/colors";
import { formatEuro } from "@/lib/pricing";
import { sizeRowLabel } from "@/lib/size-taxonomy";
import { usePdpSize } from "@/components/pdp/pdp-size-context";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { SizeChartButton } from "@/components/pdp/size-chart-modal";
import { ColorSiblings, type SiblingItem } from "@/components/pdp/color-siblings";
import { DeliveryPromise } from "@/components/pdp/delivery-promise";
import { ClickAndCollect } from "@/components/pdp/click-collect";
import { StockNotify } from "@/components/pdp/stock-notify";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { RatingStars } from "@/components/rating-stars";
import type { ProductRating } from "@/lib/reviews";
import { useCart } from "@/components/cart/cart-context";
import { useT } from "@/components/i18n/locale-provider";

/** Klein statusbolletje (SVG i.p.v. tekst-glyph "●"). */
function Dot() {
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
    </svg>
  );
}

/** Belletje — signaleert de terug-op-voorraad-tip. */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** Vrachtwagen — bezorging/verzending. */
function TruckIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 6.5h11v9H3zM14 9.5h3.6L21 13v2.5h-7z" />
      <circle cx="7" cy="17.5" r="1.6" />
      <circle cx="17.5" cy="17.5" r="1.6" />
    </svg>
  );
}

/** Winkelpui — omnichannel-voorraad (19 winkels). */
function StoreIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 20v-6h6v6" />
    </svg>
  );
}

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
  /** Pasvorm-noot (bv. "Modern fit") — getoond onder de maatkiezer. */
  fitNote?: string | null;
  /** Drempel gratis verzending (cents) uit de settings-store. */
  freeShipThresholdCents?: number;
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
  fitNote,
  freeShipThresholdCents,
}: Props) {
  const cart = useCart();
  const t = useT();
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

  // Precies één maat → meteen voorselecteren (scheelt een klik). Is die ene maat
  // uitverkocht, dan wordt 'ie óók geselecteerd: de klant ziet de maat en krijgt
  // meteen de terug-op-voorraad-tip (add-to-cart blijft geblokkeerd).
  const singleSize = Boolean(active && active.sizes.length === 1);
  // ECHTE one-size (accessoires: "One"/"OS") → maatkiezer verbergen. Eén NORMALE
  // restmaat (bv. laatste pak in maat 50) blijft de maat tonen (klant moet 'm zien).
  const oneSize = singleSize && /^(one|one\s?size|os|onesize|é{0,2}n maat)$/i.test(String(active?.sizes[0]?.size ?? "").trim());
  useEffect(() => {
    if (singleSize && active && !size) setSize(active.sizes[0].size);
  }, [singleSize, active, size]);

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
  // Omnichannel-USP: aantal winkels met voorraad — voor de gekozen maat als er
  // een gekozen is, anders over alle maten van deze kleur ("kies je maat om te
  // zien welke"). Zichtbaar vanaf de eerste scroll, niet pas na een maatklik.
  const storeCount = useMemo(() => {
    const set = new Set<string>();
    const src = selectedSize ? [selectedSize] : active?.sizes ?? [];
    for (const s of src) for (const b of s.branches ?? []) if (b.qty > 0) set.add(b.store);
    return set.size;
  }, [active, selectedSize]);
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
        <a href="#reviews" className="mt-2 inline-flex items-center gap-1.5 hover:opacity-80">
          <RatingStars rating={rating} size="sm" />
          <span className="font-sans text-xs text-muted underline underline-offset-2">
            {rating.count > 0 ? t("pdp.rating.readReviews") : t("pdp.rating.beFirst")}
          </span>
        </a>
      ) : null}

      <div className="mt-4 flex items-baseline gap-3">
        {referenceCents ? (
          <span className="font-sans text-lg text-muted line-through">{formatEuro(referenceCents)}</span>
        ) : null}
        <span className="font-display text-2xl">{priceLabel}</span>
        {referenceCents && referenceCents > priceCents ? (
          <span className="rounded bg-danger/10 px-1.5 py-0.5 font-sans text-xs font-medium text-danger">
            −{Math.round((1 - priceCents / referenceCents) * 100)}%
          </span>
        ) : null}
        <span className="font-sans text-xs text-muted">{t("common.vat")}</span>
      </div>
      {referenceCents ? (
        <p className="mt-1 font-sans text-xs text-muted">
          {t("pdp.price.reference")}
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
            <span className="text-muted">{t("pdp.color.prefix")} </span>
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
                  aria-label={`Kleur ${c.color}`}
                  title={c.color}
                  // Selectie ook via een ring (niet alléén randkleur) → duidelijk voor
                  // kleurenblinde gebruikers.
                  className={`h-8 w-8 rounded-card border-2 ${on ? "border-ink ring-2 ring-ink ring-offset-1" : "border-line"}`}
                  style={{ background: sw.gradient ?? sw.hex }}
                />
              );
            })}
          </div>
        </div>
      ) : active && active.color !== "Standaard" && !title.toLowerCase().includes(active.color.toLowerCase()) ? (
        // Alleen tonen als de kleur NIET al in de titel staat (geen dubbeling).
        <p className="mt-7 font-sans text-sm">
          <span className="text-muted">{t("pdp.color.prefix")} </span>
          <span className="font-medium">{active.color}</span>
        </p>
      ) : null}

      {/* Omnichannel-USP: winkelvoorraad zichtbaar vanaf de eerste scroll. */}
      {hasStock && !oneSize && storeCount > 0 ? (
        <div className="mt-6 flex items-start gap-2.5 rounded-card border border-line px-3 py-2.5">
          <StoreIcon className="mt-0.5 h-5 w-5 shrink-0 text-ink" />
          <p className="font-sans text-sm">
            <span className="font-medium text-ink">
              {selectedSize
                ? t(storeCount === 1 ? "pdp.storeStock.mineOne" : "pdp.storeStock.mine", { count: storeCount })
                : t(storeCount === 1 ? "pdp.storeStock.anyOne" : "pdp.storeStock.any", { count: storeCount })}
            </span>
            {!selectedSize ? <span className="block text-xs text-muted">{t("pdp.storeStock.hint")}</span> : null}
          </p>
        </div>
      ) : null}

      {/* Maat — verborgen bij one-size (niets te kiezen). */}
      <div className="mt-6">
        {!oneSize ? (
          <>
            <div className="flex items-center justify-between">
              <p className="font-sans text-sm font-medium">{t("pdp.size.label")}</p>
              <div className="flex items-center gap-3 font-sans text-xs">
                <SizeChartButton hoofdgroep={hoofdgroep} pageHandle={sizeChartHandle} />
                <Link href="/maatadvies" className="text-ink underline underline-offset-4">
                  {t("pdp.size.finder")}
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
            <span><span className="font-medium text-ink">{t("pdp.size.my")}</span> — {t("pdp.size.autoSelected")}</span>
          </p>
        ) : null}
        {hasStock && selectedSize ? (
          <p className="mt-3 font-sans text-xs">
            {selectedSize.qty > 0 ? (
              selectedSize.qty <= 5 ? (
                <span className="inline-flex items-center gap-1.5 text-danger"><Dot />{t("pdp.stock.lowDynamic", { count: selectedSize.qty })}</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-success"><Dot />{t("pdp.stock.inStock")}</span>
              )
            ) : (
              <span className="text-muted">{t("pdp.stock.sizeSoldOut", { size: selectedSize.size })}</span>
            )}
          </p>
        ) : null}
        {/* Uitverkochte-maat-hint: maakt de terug-op-voorraad-tip vindbaar. */}
        {hasStock && !oneSize && !soldOut && active && active.sizes.some((s) => s.known && s.qty <= 0) ? (
          <p className="mt-2 flex items-center gap-1.5 font-sans text-xs text-muted">
            <BellIcon className="h-3 w-3 shrink-0" />
            {t("pdp.size.soldoutRowHint")}
          </p>
        ) : null}
        {/* Pasvorm-noot — pal onder de maatkiezer, op het beslismoment. */}
        {fitNote ? (
          <p className="mt-2 rounded-card bg-surface px-3 py-2 font-sans text-xs text-ink-soft">
            <span className="font-medium text-ink">{t("pdp.fit.prefix")} {fitNote}.</span> {t("pdp.fit.tip")}
          </p>
        ) : null}
        {/* Mail-me zodra een uitverkochte maat is gekozen — ook als het hele
            product op is (dan vervangt de per-maat-vorm de generieke block-vorm). */}
        {soldOut ? (
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

      {!allSoldOut ? (
        <>
          <DeliveryPromise promise={deliveryPromise} note={deliveryNote} cutoffHour={cutoffHour} />
          {freeShipThresholdCents ? (
            <p className="mt-2 flex items-center gap-1.5 font-sans text-xs text-ink-soft">
              <TruckIcon className="h-3.5 w-3.5 shrink-0 text-ink" />
              {priceCents >= freeShipThresholdCents
                ? t("pdp.freeShip.now")
                : t("pdp.freeShip.from", { amount: formatEuro(freeShipThresholdCents) })}
            </p>
          ) : null}
        </>
      ) : null}

      {/* Bestelknop + bewaren — of, als alles uitverkocht is, de mail-me-blok. */}
      {allSoldOut ? (
        <div className="mt-7">
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <button type="button" disabled className="btn-primary w-full opacity-60">
              {t("pdp.button.sold")}
            </button>
            <WishlistButton handle={productHandle} variant="pdp" />
          </div>
          {/* Generieke mail-me — alleen zolang de klant nog geen specifieke
              (uitverkochte) maat koos; dan toont de per-maat-vorm hierboven. */}
          {!soldOut ? (
            <StockNotify
              productHandle={productHandle}
              productTitle={title}
              color={active?.color}
              variant="block"
            />
          ) : null}
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
              {!size ? t("pdp.cta.chooseSize") : soldOut ? t("pdp.button.sold") : oneSize ? t("pdp.cta.addToCart") : t("pdp.cta.addToCartWithSize", { size })}
            </button>
            <WishlistButton handle={productHandle} variant="pdp" />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[0.7rem] text-muted">
            <span>{t("pdp.payment.label")}</span>
            {["iDEAL", "Visa", "Mastercard", "Bancontact", "Apple Pay"].map((m) => (
              <span key={m} className="rounded border border-line px-1.5 py-0.5 text-ink-soft">{m}</span>
            ))}
          </div>
        </>
      )}

      {/* Ophalen in de winkel — secundaire optie, ónder de bestelknop */}
      {selectedSize && selectedSize.branches && selectedSize.branches.length ? (
        <ClickAndCollect branches={selectedSize.branches} />
      ) : null}

      {/* Sticky mobiele bestelbalk — alleen zodra de hoofd-knop uit beeld is. */}
      {stickyOn && !allSoldOut ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-page items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-xs text-muted">{title}</p>
              <p className="flex items-baseline gap-2 font-display text-base">
                {priceLabel}
                {size && !oneSize ? (
                  <span className="rounded-full bg-surface px-2 py-0.5 font-sans text-xs font-medium text-ink">{t("pdp.size.label")} {size}</span>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={addToCart}
              disabled={!size || soldOut}
              className="btn-primary !px-5"
            >
              {!size ? t("pdp.sticky.choosesize") : soldOut ? t("pdp.button.sold") : t("pdp.cta.addToCart")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
