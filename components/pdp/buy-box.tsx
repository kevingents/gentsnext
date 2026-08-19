"use client";

import { Link } from "@/components/i18n/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { colorSwatch } from "@/lib/colors";
import { formatEuro, isRealDiscount } from "@/lib/pricing";
import { sizeRowLabel } from "@/lib/size-taxonomy";
import { usePdpSize } from "@/components/pdp/pdp-size-context";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { SizeChartButton } from "@/components/pdp/size-chart-modal";
import { SizeFinderButton } from "@/components/pdp/size-finder-modal";
import { ColorSiblings, type SiblingItem } from "@/components/pdp/color-siblings";
import { DeliveryPromise } from "@/components/pdp/delivery-promise";
import { ClickAndCollect } from "@/components/pdp/click-collect";
import { StoreChooser } from "@/components/stores/store-chooser";
import { StockNotify } from "@/components/pdp/stock-notify";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { RatingStars } from "@/components/rating-stars";
import type { ProductRating } from "@/lib/reviews";
import { useCart } from "@/components/cart/cart-context";
import { useT } from "@/components/i18n/locale-provider";
import { track } from "@/lib/track-client";

/** Klein statusbolletje (SVG i.p.v. tekst-glyph "●"). */
function Dot() {
  return (
    <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0">
      <circle cx="4" cy="4" r="4" fill="currentColor" />
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
  /** "Mijn winkels" (winkelnamen) — server-side uit cookie/profiel. */
  myStores?: string[];
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
  /** Opgeslagen maat van de ingelogde klant voor deze categorie (Shop in jouw maat). */
  mySize?: string | null;
  /** Pasvorm-noot (bv. "Modern fit") — getoond onder de maatkiezer. */
  fitNote?: string | null;
  /** Drempel gratis verzending (cents) uit de settings-store. */
  freeShipThresholdCents?: number;
  /**
   * A/B: eigen knoptekst ("Nu bestellen" i.p.v. "In winkelwagen"). Losse tekst
   * uit het experiment, dus NL — zelfde taalregel als de aankondigingsbalk.
   */
  ctaLabel?: string | null;
  /** A/B: mobiele meelopende koopbalk aan/uit. */
  sticky?: boolean;
  /** A/B: "−30%"-label naast de prijs. De van-prijs zelf blijft altijd staan. */
  kortingLabel?: boolean;
  /** A/B: het rijtje betaalmerken onder de koopknop. */
  betaaliconen?: boolean;
};

export function BuyBox({
  title,
  vendor,
  rating,
  hoofdgroep,
  sizeChartHandle,
  productHandle,
  myStores = [],
  image,
  colors,
  minPriceCents,
  maxPriceCents,
  referenceCents,
  hasStock,
  colorSiblings,
  deliveryPromise,
  deliveryNote,
  mySize,
  fitNote,
  freeShipThresholdCents,
  ctaLabel = null,
  sticky = true,
  kortingLabel = true,
  betaaliconen = true,
}: Props) {
  const cart = useCart();
  const t = useT();
  const { setSizeLabel } = usePdpSize();
  const [colorIdx, setColorIdx] = useState(0);
  const [size, setSize] = useState<string | null>(null);
  const active = colors[Math.min(colorIdx, colors.length - 1)];

  // Deel de gekozen maat-bucket met de galerij (foto aanpassen bij grote maten).
  useEffect(() => {
    setSizeLabel(size ? sizeRowLabel(size, hoofdgroep) : null);
  }, [size, hoofdgroep, setSizeLabel]);

  // Shop in jouw maat: selecteer de opgeslagen maat van de klant automatisch
  // voor (alleen leverbare maten), exact eerst, anders dezelfde lettermaat-bucket.
  const myBucket = mySize ? sizeRowLabel(mySize, hoofdgroep) : null;
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || size || !mySize || !active) return;
    const available = active.sizes.filter((s) => !s.known || s.qty > 0);
    const pick =
      available.find((s) => s.size === mySize) ??
      available.find((s) => sizeRowLabel(s.size, hoofdgroep) === myBucket);
    if (pick) {
      setSize(pick.size);
      autoPicked.current = true;
    }
  }, [active, mySize, myBucket, size]);
  const isMySize = Boolean(size && myBucket && sizeRowLabel(size, hoofdgroep) === myBucket);

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
  // Callback-ref i.p.v. useEffect([]): de bestelknop-div (de)mount bij het wisselen
  // tussen een uitverkochte en een leverbare kleur (hij staat in de !allSoldOut-tak).
  // Een eenmalige effect-observer hangt maar één keer op en mist die remount — de
  // balk blijft dan weg als de eerste kleur uitverkocht was. Een callback-ref hangt de
  // observer telkens opnieuw aan de actuele node.
  const [stickyOn, setStickyOn] = useState(false);
  const stickyIoRef = useRef<IntersectionObserver | null>(null);
  const mainCtaRef = useCallback((el: HTMLDivElement | null) => {
    stickyIoRef.current?.disconnect();
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStickyOn(!e.isIntersecting), { rootMargin: "0px 0px -40px 0px" });
    io.observe(el);
    stickyIoRef.current = io;
  }, []);
  // …maar weer verbergen zodra de footer in beeld komt: de vaste balk dekt anders
  // permanent de onderste ~90px van elke PDP af (juridische links, betaaliconen).
  const [footerVisible, setFooterVisible] = useState(false);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setFooterVisible(e.isIntersecting));
    io.observe(footer);
    return () => io.disconnect();
  }, []);

  const selectedSize = useMemo(
    () => active?.sizes.find((s) => s.size === size) ?? null,
    [active, size]
  );
  // Aantal winkels met voorraad over ALLE maten van deze kleur. Alleen nog nodig
  // om te weten óf de omnichannel-boodschap überhaupt geldt: "Passen & afhalen"
  // onder de bestelknop vertelt het verhaal per gekozen maat.
  const storeCount = useMemo(() => {
    const set = new Set<string>();
    for (const s of active?.sizes ?? []) for (const b of s.branches ?? []) if (b.qty > 0) set.add(b.store);
    return set.size;
  }, [active]);
  const priceCents = selectedSize?.priceCents ?? minPriceCents;
  const priceLabel = (minPriceCents !== maxPriceCents && !selectedSize ? `${t("product.from")} ` : "") + formatEuro(priceCents);
  // Alleen een korting tonen (doorgestreepte prijs + badge + Omnibus-noot) als de
  // referentieprijs écht hoger is dan de getoonde prijs — anders zou bij een
  // duurdere maat een doorgestreepte lagere prijs een prijsVERHOGING suggereren.
  // isRealDiscount: minstens 5% én € 1 (geen sale-badge bij 5 cent afronding).
  const hasDiscount = isRealDiscount(priceCents, referenceCents);
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

  // Ophalen in de winkel. Staat pal ónder de bestelknop: het is de tweede
  // koopkeuze ("nu online, of vandaag passen?"), niet een voetnoot onder de
  // betaaliconen. Als variabele omdat de uitverkocht-tak 'm op een andere plek
  // zet.
  const winkelBlok = (
    <>
      {/* Nog geen winkel gekozen? Dan hoort hier de uitnodiging in plaats van de
          afhaal-regel — allebei beantwoorden ze "kan ik 'm ergens passen?", en
          die vraag komt ná de bestelknop, niet naast de maatkiezer. */}
      {myStores.length === 0 && storeCount > 0 ? <StoreChooser bron="pdp" /> : null}
      {selectedSize && selectedSize.branches && selectedSize.branches.length ? (
        <ClickAndCollect
          // key per sku: maatwissel = verse component-staat (geen oude
          // bevestiging/fout van een andere maat).
          key={selectedSize.sku || selectedSize.size}
          // Bij écht one-size geen maat meesturen — "Maat One ligt in 5 winkels"
          // is onzin voor een accessoire; de generieke regel volstaat dan.
          size={oneSize ? undefined : selectedSize.size}
          branches={selectedSize.branches}
          myStores={myStores}
          reserve={selectedSize.sku ? { handle: productHandle, sku: selectedSize.sku } : undefined}
        />
      ) : null}
      {/* De gekozen maat ligt in geen enkele winkel terwijl andere maten dat wél
          doen: dan rendert ClickAndCollect niets en lost de omnichannel-boodschap
          stil op. Zeg het dan gewoon. */}
      {selectedSize && !oneSize && !soldOut && storeCount > 0 && !(selectedSize.branches ?? []).some((b) => b.qty > 0) ? (
        <p className="mt-3 flex items-start gap-2 font-sans text-xs text-muted">
          <StoreIcon className="mt-0.5 h-4 w-4 shrink-0" />
          {t("pdp.storeStock.sizeNone", { size: selectedSize.size })}
        </p>
      ) : null}
    </>
  );

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
        {hasDiscount ? (
          <span className="font-sans text-lg text-muted line-through">{formatEuro(referenceCents!)}</span>
        ) : null}
        <span className="font-display text-2xl">{priceLabel}</span>
        {/* Alleen het PERCENTAGE is testbaar. De doorgestreepte referentieprijs
            en de toelichting eronder blijven staan: die zijn bij een korting
            wettelijk verplicht (Omnibus), en dat is geen A/B-vraag. */}
        {hasDiscount && kortingLabel ? (
          <span className="rounded bg-danger/10 px-1.5 py-0.5 font-sans text-xs font-medium text-danger">
            −{Math.round((1 - priceCents / referenceCents!) * 100)}%
          </span>
        ) : null}
        <span className="font-sans text-xs text-muted">{t("common.vat")}</span>
      </div>
      {hasDiscount ? (
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

      {/* Pasvorm boven de maatkiezer: het is de vraag die je jezelf stelt vóór je
          een maat aanwijst ("valt dit klein?"), niet erna. */}
      {fitNote ? (
        <p className="mt-6 rounded-card bg-surface px-3 py-2 font-sans text-xs text-ink-soft">
          <span className="font-medium text-ink">{t("pdp.fit.prefix")} {fitNote}.</span> {t("pdp.fit.tip")}
        </p>
      ) : null}

      {/* Maat — verborgen bij one-size (niets te kiezen). */}
      <div className="mt-6">
        {!oneSize ? (
          <>
            <div className="flex items-center justify-between">
              <p className="font-sans text-sm font-medium">{t("pdp.size.label")}</p>
              <div className="flex items-center gap-3 font-sans text-xs">
                <SizeChartButton hoofdgroep={hoofdgroep} pageHandle={sizeChartHandle} />
                {/* Overlay i.p.v. wegnavigeren — de klant blijft op het product. */}
                <SizeFinderButton />
              </div>
            </div>
            {active ? (
              <SizeMatrix
                sizes={active.sizes}
                hoofdgroep={hoofdgroep}
                selected={size}
                onSelect={(s) => {
                  // Klik op een uitverkochte maat = direct inkoopsignaal: de
                  // klant wilde 'm, wij hadden 'm niet.
                  const gekozen = active.sizes.find((x) => x.size === s);
                  if (gekozen && gekozen.known && gekozen.qty <= 0) {
                    track("size_click", { handle: productHandle, props: { size: s, inStock: false } });
                  }
                  setSize(s);
                }}
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
        {/* Mijn winkel: direct antwoord op "ligt dit in mijn winkel?" — de
            winkelvoorraad per maat hebben we hier al, dus dit kost niets extra. */}
        {myStores.length > 0 && selectedSize ? (() => {
          const branches = selectedSize.branches ?? [];
          // Eigen winkels mét de maat eerst: het antwoord dat je zoekt ("waar
          // kan ik 'm passen?") staat dan bovenaan, niet ergens in een rijtje.
          const mijn = myStores
            .map((naam) => ({ naam, hit: branches.find((b) => b.store === naam) }))
            .sort((a, b) => Number((b.hit?.qty ?? 0) > 0) - Number((a.hit?.qty ?? 0) > 0));
          const elders = branches.filter((b) => b.qty > 0 && !myStores.includes(b.store)).length;
          const geen = mijn.every((m) => !m.hit || m.hit.qty <= 0);
          return (
            <div className="mt-3 space-y-1">
              {mijn.map(({ naam, hit }) =>
                hit && hit.qty > 0 ? (
                  <p key={naam} className="flex flex-wrap items-center gap-x-2 font-sans text-xs text-success">
                    <StoreIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {/* "Vandaag ophalen" alleen als de winkel nu open is — anders
                          beloofde de regel iets wat vandaag niet kan. */}
                      <span className="font-medium">
                        {hit.openNow ? t("myStore.inStock", { store: naam }) : t("myStore.inStockClosed", { store: naam })}
                      </span>
                      {hit.openLabel ? <span className="text-muted"> · {hit.openLabel}</span> : null}
                    </span>
                  </p>
                ) : (
                  <p key={naam} className="flex flex-wrap items-center gap-x-2 font-sans text-xs text-muted">
                    <StoreIcon className="h-3.5 w-3.5 shrink-0" />
                    <span>{t("myStore.notInStock", { store: naam })}</span>
                  </p>
                )
              )}
              {/* Ligt 'ie in géén van je winkels? Zeg dan meteen of het elders wél
                  kan — anders is de regel een doodlopende mededeling. */}
              <p className="flex flex-wrap items-center gap-x-2 font-sans text-xs text-muted">
                {geen && elders > 0 ? <span>{t("myStore.elsewhereFull", { count: elders })}</span> : null}
                {/* Zichtbaar kunnen wisselen: zonder deze knop is "mijn winkel"
                    een instelling die je alleen terugvindt waar je 'm ooit zette. */}
                <StoreChooser myStores={myStores} variant="link" bron="pdp" />
              </p>
            </div>
          );
        })() : null}
        {/* Nog géén winkel gekozen? Dan stond er tot nu toe niets — de hele
            functie bestond alleen voor wie 'm al gevonden had. Deze regel vraagt
            het gewoon, op de plek waar de vraag speelt (onder je maat). */}
        {/* Alleen melden wat de klant moet wéten. Een groene "Op voorraad" bij
            elke gekozen maat is ruis: dat je kunt bestellen blijkt al uit de
            bestelknop. Bijna-op en uitverkocht blijven — dat zijn de twee
            gevallen waarin de stand z'n keuze verandert. */}
        {hasStock && selectedSize && (selectedSize.qty <= 0 || selectedSize.qty <= 5) ? (
          <p className="mt-3 font-sans text-xs">
            {selectedSize.qty > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-danger"><Dot />{t("pdp.stock.lowDynamic", { count: selectedSize.qty })}</span>
            ) : (
              <span className="text-muted">{t("pdp.stock.sizeSoldOut", { size: selectedSize.size })}</span>
            )}
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
          {winkelBlok}
        </div>
      ) : (
        <>
          <div ref={mainCtaRef} className="mt-7 grid grid-cols-[1fr_auto] gap-2">
            <button
              type="button"
              onClick={addToCart}
              disabled={!size || soldOut}
              className="btn-primary w-full !px-4 sm:!px-6"
            >
              {!size ? (
                t("pdp.cta.chooseSize")
              ) : soldOut ? (
                t("pdp.button.sold")
              ) : oneSize || ctaLabel ? (
                // Eigen knoptekst uit een A/B-variant krijgt géén maat-
                // achtervoegsel: "Nu bestellen — maat 52" is niet wat er
                // getest wordt, en de maat staat vlak erboven al opgelicht.
                ctaLabel || t("pdp.cta.addToCart")
              ) : (
                <>
                  {/* Op smalle schermen zonder maat-achtervoegsel: "In winkelwagen
                      — maat XL7 43/44" paste niet op één regel. De gekozen maat
                      licht vlak hierboven al op in de maatkiezer. */}
                  <span className="sm:hidden">{t("pdp.cta.addToCart")}</span>
                  <span className="hidden sm:inline">{t("pdp.cta.addToCartWithSize", { size })}</span>
                </>
              )}
            </button>
            <WishlistButton handle={productHandle} variant="pdp" />
          </div>
          {/* Bezorgbelofte hoort bij "wat gebeurt er als ik nu bestel", en dus
              onder de knop — niet ertussen. */}
          <DeliveryPromise
            promise={deliveryPromise}
            note={deliveryNote}
            extra={
              freeShipThresholdCents
                ? priceCents >= freeShipThresholdCents
                  ? t("pdp.freeShip.now")
                  : t("pdp.freeShip.from", { amount: formatEuro(freeShipThresholdCents) })
                : null
            }
          />
          {winkelBlok}
          <div className={`mt-3 flex-wrap items-center gap-x-2 gap-y-1 font-sans text-[0.7rem] text-muted ${betaaliconen ? "flex" : "hidden"}`}>
            <span>{t("pdp.payment.label")}</span>
            {["iDEAL", "Visa", "Mastercard", "Bancontact", "Apple Pay"].map((m) => (
              <span key={m} className="rounded border border-line px-1.5 py-0.5 text-ink-soft">{m}</span>
            ))}
          </div>
        </>
      )}

      {/* Sticky mobiele bestelbalk — alleen zodra de hoofd-knop uit beeld is
          én de footer nog niet in beeld is (anders blijft de onderkant bedekt). */}
      {sticky && stickyOn && !footerVisible && !allSoldOut ? (
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
              {!size ? t("pdp.sticky.choosesize") : soldOut ? t("pdp.button.sold") : ctaLabel || t("pdp.cta.addToCart")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
