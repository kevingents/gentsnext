"use client";

import Image from "next/image";
import Link from "next/link";
import { useRef, useState } from "react";
import { formatEuro } from "@/lib/pricing";
import type { ResolvedLook, LookBuyData } from "@/lib/looks";
import { useCart } from "@/components/cart/cart-context";
import { track } from "@/lib/track-client";
import { SizeMatrix } from "@/components/pdp/size-matrix";

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
}: {
  look: ResolvedLook;
  aspectClass?: string;
  buy?: Record<string, LookBuyData>;
}) {
  const cart = useCart();
  const [active, setActive] = useState<number | null>(null);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [sizeDrawer, setSizeDrawer] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLLIElement | null)[]>([]);

  const items = look.products.filter((h) => h.product);

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
    track("add_to_cart", { handle: h.handle, props: { fromLook: look.slug } });
    setTimeout(() => setAdded((p) => ({ ...p, [i]: false })), 1800);
  }

  const shoppable = Boolean(buy);

  // Geopende maat-drawer (één tegelijk) — voorkomt een lange pagina vol matrices.
  const dh = sizeDrawer !== null ? look.products[sizeDrawer] : null;
  const dData = dh ? buy?.[dh.handle] : undefined;
  const dSel = sizeDrawer !== null ? picked[sizeDrawer] : undefined;
  const dSelSize = dData?.sizes.find((s) => s.size === dSel);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr]">
      {/* Modelfoto met genummerde hotspots */}
      <div className={`relative ${aspectClass} overflow-hidden rounded-card bg-surface`}>
        <Image src={look.image} alt={look.title} fill priority sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
        {items.map((h) => {
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
                {items.indexOf(h) + 1}
              </span>
              <span className="pointer-events-none absolute left-1/2 top-9 hidden -translate-x-1/2 whitespace-nowrap rounded-card bg-ink px-2 py-1 font-sans text-[0.65rem] text-canvas group-hover:block">
                {h.label || h.product!.title}
              </span>
            </button>
          );
        })}
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-canvas/85 px-3 py-1 font-sans text-[0.7rem] text-ink-soft shadow-pop">
          Tik op een cijfer om het artikel te shoppen
        </span>
      </div>

      {/* Koop-paneel */}
      <div className="flex flex-col">
        <p className="label-brand">{look.occasion}</p>
        <h2 className="mt-1 text-display-md">{look.title}</h2>
        {look.subtitle ? <p className="mt-1 font-sans text-sm text-ink-soft">{look.subtitle}</p> : null}

        <ul className="mt-5 space-y-3">
          {items.map((h) => {
            const i = look.products.indexOf(h);
            const data = buy?.[h.handle];
            const num = items.indexOf(h) + 1;
            const sel = picked[i];
            const selSize = data?.sizes.find((s) => s.size === sel);
            return (
              <li
                key={i}
                ref={(el) => { cardRefs.current[i] = el; }}
                onMouseEnter={() => setActive(i)}
                className={`rounded-card border p-3 transition-colors ${active === i ? "border-ink" : "border-line"}`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink font-sans text-[0.65rem] text-canvas">{num}</span>
                  <Link href={`/products/${h.product!.handle}`} className="relative h-20 w-14 shrink-0 overflow-hidden rounded-card bg-surface">
                    {h.product!.imageUrl ? <Image src={h.product!.imageUrl} alt={h.product!.title} fill sizes="60px" className="object-cover" /> : null}
                  </Link>
                  <div className="min-w-0 flex-1">
                    {h.label ? <span className="block font-sans text-[0.65rem] uppercase tracking-wide text-muted">{h.label}</span> : null}
                    <Link href={`/products/${h.product!.handle}`} className="block truncate font-sans text-sm hover:underline">{h.product!.title}</Link>
                    {data?.specs ? <span className="mt-0.5 block font-sans text-[0.7rem] italic leading-snug text-ink-soft/80">{data.specs}</span> : null}
                    <span className="mt-0.5 block font-sans text-sm text-ink-soft">{formatEuro(selSize?.priceCents ?? h.product!.minPriceCents)}</span>
                  </div>
                </div>

                {shoppable && data && data.sizes.length ? (
                  <div className="mt-3 pl-8">
                    <button
                      type="button"
                      onClick={() => setSizeDrawer(i)}
                      className={`w-full !py-2 text-sm ${added[i] || !sel ? "btn-primary" : "btn-ghost"}`}
                    >
                      {added[i] ? "Toegevoegd" : sel ? `Maat ${sel} gekozen — wijzigen` : "Kies maat"}
                    </button>
                  </div>
                ) : (
                  <div className="mt-2 pl-8">
                    <Link href={`/products/${h.product!.handle}`} className="font-sans text-sm text-ink underline underline-offset-4">Bekijk & kies maat →</Link>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Maat-drawer: matrix in een overlay i.p.v. lang op de pagina */}
      {sizeDrawer !== null && dh?.product && dData ? (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Kies je maat">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setSizeDrawer(null)} />
          <div className="absolute inset-y-0 right-0 flex w-[92%] max-w-md flex-col overflow-y-auto bg-canvas p-5 shadow-drawer">
            <div className="mb-4 flex items-center justify-between">
              <p className="label-brand">Kies je maat</p>
              <button type="button" onClick={() => setSizeDrawer(null)} className="font-sans text-sm underline underline-offset-2">Sluiten</button>
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
              <span className="font-sans text-xs text-muted">Maat</span>
              <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-2">Vind mijn maat</Link>
            </div>
            <SizeMatrix
              sizes={dData.sizes.map((s) => ({ ...s, known: true }))}
              hoofdgroep={dData.hoofdgroep}
              selected={dSel ?? null}
              onSelect={(size) => setPicked((p) => ({ ...p, [sizeDrawer!]: size }))}
            />

            <button
              type="button"
              onClick={() => { addItem(sizeDrawer!); setSizeDrawer(null); }}
              disabled={!dSelSize || (dSelSize?.qty ?? 0) <= 0}
              className="btn-primary mt-5 w-full"
            >
              {!dSel ? "Kies een maat" : dSelSize && dSelSize.qty <= 0 ? "Uitverkocht" : `In winkelwagen — maat ${dSel}`}
            </button>
            <p className="mt-2 text-center font-sans text-xs text-muted">Gratis retour binnen 14 dagen.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
