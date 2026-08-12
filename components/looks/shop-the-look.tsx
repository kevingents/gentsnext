"use client";

import Image from "next/image";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/pricing";
import type { ResolvedLook, LookBuyData } from "@/lib/looks";
import { useCart } from "@/components/cart/cart-context";
import { track } from "@/lib/track-client";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { useT } from "@/components/i18n/locale-provider";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";

/**
 * Interactieve modelfoto met GENUMMERDE hotspots → elk cijfer wijst het artikel
 * op het model aan én springt naar de bijbehorende koop-kaart. Per artikel kiest
 * de klant direct een maat en legt 'm in de winkelwagen — zonder de pagina te
 * verlaten. Met "buy" (look-pagina) tonen we de inline koop-UI; zonder (PDP)
 * vallen we terug op links naar de productpagina.
 */
export function ShopTheLook({
  look,
  aspectClass = "aspect-[4/5]",
  buy,
  soldOutHandles,
}: {
  look: ResolvedLook;
  aspectClass?: string;
  buy?: Record<string, LookBuyData>;
  /** Handles die de buy-box al als uitverkocht beschouwt ("Dit item" op de PDP) —
   *  die krijgen in de look geen "Kies maat"-knop maar dezelfde Uitverkocht-stijl. */
  soldOutHandles?: string[];
}) {
  const cart = useCart();
  const t = useT();
  const [active, setActive] = useState<number | null>(null);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, boolean>>({});

  // MixMatch is een USP maar was onmeetbaar: we zagen alleen wat er in de wagen
  // belandde, niet hoe vaak de combinatie überhaupt getoond werd. Zonder die
  // noemer is elk percentage over MixMatch een gok.
  useEffect(() => {
    track("mixmatch_bekeken", { handle: look.slug, props: { artikelen: look.hotspots?.length ?? 0 } });
  }, [look.slug, look.hotspots?.length]);
  const [sizeDrawer, setSizeDrawer] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);
  // Modal-a11y voor de maat-drawer (scroll-lock, focus-trap, Esc, focus-terugkeer);
  // geen inertMain want de drawer rendert bínnen #main (geen portal).
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  useModalA11y(drawerPanelRef, { onClose: () => setSizeDrawer(null), active: sizeDrawer !== null });

  const items = look.products.filter((h) => h.product);
  // Alleen artikelen die écht op de foto staan krijgen een cijfer in het beeld.
  // Op een productpagina is dat alleen het product zelf; de bijpassende broek,
  // schoenen en riem zijn styling-advies en staan ernaast als "past hierbij".
  // Bij de gecureerde looks is alles in beeld (inBeeld leeg = ja), dus daar
  // verandert er niets.
  const inBeeld = items.filter((h) => h.inBeeld !== false);
  const erbij = items.filter((h) => h.inBeeld === false);
  const nummerVan = (h: (typeof items)[number]) => inBeeld.indexOf(h) + 1;

  function focusItem(i: number) {
    setActive(i);
    cardRefs.current[i]?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function addItem(i: number) {
    const h = look.products[i];
    if (!h.product) return;
    const data = buy?.[h.handle];
    const size = picked[i];
    if (!data || !size) return;
    const s = data.sizes.find((x) => x.size === size);
    if (!s || s.qty <= 0) return;
    cart.add({
      sku: s.sku,
      productHandle: h.handle,
      title: h.product.title,
      size: s.size,
      color: data.color === "Standaard" ? "" : data.color,
      priceCents: s.priceCents,
      imageUrl: h.product.imageUrl,
      qty: 1,
      hoofdgroep: data.hoofdgroep,
    });
    setAdded((p) => ({ ...p, [i]: true }));
    // Zie look-detail: cart.add() vuurt add_to_cart al. Dit event stond er
    // dubbelop en telde elke look-toevoeging twee keer.
    setTimeout(() => setAdded((p) => ({ ...p, [i]: false })), 1800);
  }

  const shoppable = Boolean(buy);

  // Uitverkocht per look-item: expliciet aangeleverd (het buy-box-oordeel voor
  // "Dit item") óf alle bekende maten netto op. Dan geen "Kies maat" — dat was
  // een dood pad naar een drawer vol doorgestreepte maten.
  function isSoldOut(handle: string): boolean {
    if (soldOutHandles?.includes(handle)) return true;
    const d = buy?.[handle];
    return Boolean(d && d.sizes.length > 0 && d.sizes.every((s) => s.known && s.qty <= 0));
  }

  // Geopende maat-drawer (één tegelijk) — voorkomt een lange pagina vol matrices.
  const dh = sizeDrawer !== null ? look.products[sizeDrawer] : null;
  const dData = dh ? buy?.[dh.handle] : undefined;
  const dSel = sizeDrawer !== null ? picked[sizeDrawer] : undefined;
  const dSelSize = dData?.sizes.find((s) => s.size === dSel);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
      {/* Modelfoto (met hotspots) + sfeerbeelden */}
      <div className="space-y-3">
      <div className={`relative ${aspectClass} overflow-hidden rounded-card bg-surface`}>
        <Image src={look.image} alt={look.title} fill priority sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
        {inBeeld.map((h) => {
          const i = look.products.indexOf(h);
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive((cur) => (cur === i ? null : cur))}
              onClick={() => focusItem(i)}
              aria-label={`${h.label || h.product!.title} — bekijk en kies maat`}
              className="group absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${h.x}%`, top: `${h.y}%` }}
            >
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full border-2 border-canvas font-sans text-xs font-medium text-canvas shadow-pop ring-1 ring-ink/20 transition-transform ${
                  active === i ? "scale-125 bg-ink" : "bg-ink/80 group-hover:scale-110"
                }`}
              >
                {nummerVan(h)}
              </span>
              <span className="pointer-events-none absolute left-1/2 top-9 hidden -translate-x-1/2 whitespace-nowrap rounded-card bg-ink px-2 py-1 font-sans text-[0.65rem] text-canvas group-hover:block">
                {h.label || h.product!.title}
              </span>
            </button>
          );
        })}
        {/* Bij één enkel cijfer is "tik op een cijfer" meer verwarrend dan nuttig. */}
        {inBeeld.length > 1 ? (
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-canvas/85 px-3 py-1 font-sans text-[0.7rem] text-ink-soft shadow-pop">
            {t("looks.shopTheLook.instruction")}
          </span>
        ) : null}
      </div>

      {/* Sfeerbeelden onder de hoofdfoto */}
      {look.images && look.images.length ? (
        <div className="grid grid-cols-2 gap-3">
          {look.images.map((img, idx) => (
            <div key={idx} className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
              <Image src={img} alt={`${look.title} — sfeerbeeld ${idx + 1}`} fill sizes="(max-width:1024px) 50vw, 25vw" className="object-cover transition-transform duration-500 hover:scale-[1.03]" />
            </div>
          ))}
        </div>
      ) : null}
      </div>

      {/* Koop-paneel */}
      <div className="flex flex-col">
        <p className="label-brand">{look.occasion}</p>
        <h2 className="mt-1 text-display-md">{look.title}</h2>
        {look.subtitle ? <p className="mt-1 font-sans text-sm text-ink-soft">{look.subtitle}</p> : null}

        <ul className="mt-6">
          {[...inBeeld, ...erbij].map((h, rij) => {
            const i = look.products.indexOf(h);
            const data = buy?.[h.handle];
            const opDeFoto = h.inBeeld !== false;
            const num = nummerVan(h);
            // Kopje precies één keer, vlak vóór het eerste artikel dat niet op de
            // foto staat. Zo is meteen duidelijk waar het beeld ophoudt en het
            // stijladvies begint.
            const kopje = !opDeFoto && rij === inBeeld.length;
            const sel = picked[i];
            const selSize = data?.sizes.find((s) => s.size === sel);
            const price = formatEuro(selSize?.priceCents ?? h.product!.minPriceCents);
            return (
              <Fragment key={i}>
              {kopje ? (
                <li className="pb-2 pt-6">
                  <p className="font-sans text-[0.65rem] uppercase tracking-[0.14em] text-muted">
                    {t("looks.shopTheLook.alsoFits")}
                  </p>
                </li>
              ) : null}
              <li
                ref={(el) => { cardRefs.current[i] = el; }}
                onMouseEnter={() => setActive(i)}
                className={`group flex items-start gap-4 border-b border-line py-4 transition-colors first:border-t last:border-b-0 ${active === i ? "bg-surface/70" : ""}`}
              >
                <Link href={`/products/${h.product!.handle}`} className="relative h-24 w-[4.5rem] shrink-0 overflow-hidden rounded-card bg-surface">
                  {h.product!.imageUrl ? <Image src={h.product!.imageUrl} alt={h.product!.title} fill sizes="72px" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" /> : null}
                  {/* Cijfer alleen bij artikelen die ook echt in de foto staan —
                      anders verwijst het naar een plek in het beeld die er niet is. */}
                  {opDeFoto ? (
                    <span className="absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-ink/85 font-sans text-[0.6rem] font-medium text-canvas">{num}</span>
                  ) : null}
                </Link>

                <div className="min-w-0 flex-1">
                  {h.label ? <span className="block font-sans text-[0.6rem] uppercase tracking-[0.14em] text-muted">{h.label}</span> : null}
                  <Link href={`/products/${h.product!.handle}`} className="mt-0.5 block truncate font-sans text-sm font-medium text-ink transition-colors group-hover:text-ink">{h.product!.title}</Link>
                  {data?.specs ? <span className="mt-0.5 block font-sans text-[0.7rem] italic leading-snug text-muted">{data.specs}</span> : null}

                  {shoppable && data && data.sizes.length ? (
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="font-sans text-sm text-ink">{price}</span>
                      {isSoldOut(h.handle) ? (
                        <button
                          type="button"
                          disabled
                          className="shrink-0 rounded-card border border-line px-3.5 py-1.5 font-sans text-xs font-medium text-muted opacity-60"
                        >
                          {t("common.soldOut")}
                        </button>
                      ) : (
                      <button
                        type="button"
                        onClick={() => setSizeDrawer(i)}
                        className={`shrink-0 rounded-card border px-3.5 py-1.5 font-sans text-xs font-medium transition-colors ${
                          added[i]
                            ? "border-success bg-success/10 text-success"
                            : sel
                              ? "border-ink bg-ink text-canvas"
                              : "border-ink text-ink hover:bg-ink hover:text-canvas"
                        }`}
                      >
                        {added[i] ? t("looks.shopTheLook.added") : sel ? `Maat ${sel}` : t("looks.shopTheLook.chooseSizeBtn")}
                      </button>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2.5 flex items-center justify-between gap-3">
                      <span className="font-sans text-sm text-ink">{price}</span>
                      <Link href={`/products/${h.product!.handle}`} className="shrink-0 font-sans text-xs font-medium text-ink underline underline-offset-4">Bekijk →</Link>
                    </div>
                  )}
                </div>
              </li>
              </Fragment>
            );
          })}
        </ul>
      </div>

      {/* Maat-drawer: matrix in een overlay i.p.v. lang op de pagina */}
      {sizeDrawer !== null && dh?.product && dData ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t("looks.shopTheLook.sizeDrawerTitle")}>
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSizeDrawer(null)} />
          <div ref={drawerPanelRef} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-[92%] max-w-md flex-col overflow-y-auto bg-canvas p-5 shadow-drawer focus:outline-none">
            <div className="mb-4 flex items-center justify-between">
              <p className="label-brand">{t("looks.shopTheLook.sizeDrawerTitle")}</p>
              <button type="button" onClick={() => setSizeDrawer(null)} className="font-sans text-sm underline underline-offset-2">{t("look.drawer.close")}</button>
            </div>

            <div className="flex items-start gap-3">
              <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-card bg-surface">
                {dh.product.imageUrl ? <Image src={dh.product.imageUrl} alt={dh.product.title} fill sizes="64px" className="object-cover" /> : null}
              </div>
              <div className="min-w-0">
                {dh.label ? <span className="block font-sans text-[0.65rem] uppercase tracking-wide text-muted">{dh.label}</span> : null}
                <p className="font-sans text-sm font-medium">{dh.product.title}</p>
                {dData.specs ? <span className="mt-0.5 block font-sans text-[0.7rem] italic leading-snug text-ink-soft/80">{dData.specs}</span> : null}
                <span className="mt-0.5 block font-sans text-sm text-ink-soft">{formatEuro(dSelSize?.priceCents ?? dh.product.minPriceCents)}</span>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="font-sans text-xs text-muted">{t("looks.shopTheLook.sizeLabel")}</span>
              <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-2">{t("look.drawer.sizeAdvice")}</Link>
            </div>
            <SizeMatrix
              sizes={dData.sizes}
              hoofdgroep={dData.hoofdgroep}
              selected={dSel ?? null}
              onSelect={(size) => setPicked((p) => ({ ...p, [sizeDrawer!]: size }))}
            />
            {/* Alles op? Zeg dat expliciet onder de maten i.p.v. alleen doorstrepen. */}
            {isSoldOut(dh.handle) ? (
              <p className="mt-3 font-sans text-sm text-muted">{t("pdp.size.soldout")}</p>
            ) : null}

            <button
              type="button"
              onClick={() => { addItem(sizeDrawer!); setSizeDrawer(null); }}
              disabled={!dSelSize || (dSelSize?.qty ?? 0) <= 0}
              className="btn-primary mt-5 w-full"
            >
              {!dSel ? t("looks.shopTheLook.chooseOneCta") : dSelSize && dSelSize.qty <= 0 ? t("common.soldOut") : `In winkelwagen — maat ${dSel}`}
            </button>
            <p className="mt-2 text-center font-sans text-xs text-muted">{t("look.drawer.returnNote")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
