"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { formatEuro } from "@/lib/pricing";
import type { ResolvedLook } from "@/lib/looks";
import { track } from "@/lib/track-client";

/**
 * Interactieve modelfoto met klikbare hotspot-dots + "Shop de look"-paneel
 * (Mr Marvis-stijl). Klik op een dot → het product licht op; "Shop de look" →
 * modal met alle losse producten uit de outfit.
 */
export function ShopTheLook({ look }: { look: ResolvedLook }) {
  const [active, setActive] = useState<number | null>(null);
  const [modal, setModal] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      {/* Modelfoto met hotspots */}
      <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
        <Image src={look.image} alt={look.title} fill priority sizes="(max-width:1024px) 100vw, 50vw" className="object-cover" />
        {look.products.map((h, i) =>
          h.product ? (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-label={`Bekijk ${h.label || h.product.title}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${h.x}%`, top: `${h.y}%` }}
            >
              <span className={`block h-5 w-5 rounded-full border-2 border-canvas bg-ink/80 ring-2 ring-canvas/40 transition-transform ${active === i ? "scale-125" : "hover:scale-110"}`}>
                <span className="block h-full w-full rounded-full" />
              </span>
            </button>
          ) : null
        )}
        <button
          type="button"
          onClick={() => { setModal(true); track("product_view", { handle: look.slug, props: { shopTheLook: true } }); }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-line bg-canvas px-5 py-2 font-sans text-sm shadow-pop hover:border-ink"
        >
          Shop de look
        </button>
      </div>

      {/* Toelichting + actieve hotspot */}
      <div className="flex flex-col justify-center">
        <p className="label-brand">{look.occasion}</p>
        <h2 className="mt-2 text-display-md">{look.title}</h2>
        <p className="mt-2 font-sans text-ink-soft">{look.subtitle}</p>

        <ul className="mt-6 space-y-3">
          {look.products.map((h, i) =>
            h.product ? (
              <li key={i}>
                <Link
                  href={`/products/${h.product.handle}`}
                  onMouseEnter={() => setActive(i)}
                  className={`flex items-center gap-4 border p-3 transition-colors ${active === i ? "border-ink" : "border-line hover:border-muted"}`}
                >
                  <span className="relative h-16 w-12 shrink-0 overflow-hidden rounded-card bg-surface">
                    {h.product.imageUrl ? <Image src={h.product.imageUrl} alt={h.product.title} fill sizes="48px" className="object-cover" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    {h.label ? <span className="block font-sans text-[0.65rem] uppercase tracking-wide text-muted">{h.label}</span> : null}
                    <span className="block truncate font-sans text-sm">{h.product.title}</span>
                    <span className="block font-sans text-sm text-ink-soft">{formatEuro(h.product.minPriceCents)}</span>
                  </span>
                  <span aria-hidden className="text-muted">→</span>
                </Link>
              </li>
            ) : null
          )}
        </ul>
      </div>

      {/* Modal */}
      {modal ? (
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Shop de look">
          <div className="absolute inset-0 bg-ink/50" onClick={() => setModal(false)} />
          <div className="absolute inset-x-0 top-0 mx-auto max-h-[90vh] max-w-2xl overflow-y-auto bg-canvas p-6 shadow-pop">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl">Shop de look — {look.title}</h3>
              <button type="button" onClick={() => setModal(false)} className="font-sans text-sm underline">Sluiten</button>
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {look.products.map((h, i) =>
                h.product ? (
                  <Link key={i} href={`/products/${h.product.handle}`} onClick={() => setModal(false)} className="group">
                    <span className="relative block aspect-[3/4] overflow-hidden rounded-card bg-surface">
                      {h.product.imageUrl ? <Image src={h.product.imageUrl} alt={h.product.title} fill sizes="33vw" className="object-cover transition group-hover:scale-105" /> : null}
                    </span>
                    <span className="mt-2 block truncate font-sans text-sm">{h.product.title}</span>
                    <span className="block font-sans text-sm text-ink-soft">{formatEuro(h.product.minPriceCents)}</span>
                  </Link>
                ) : null
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
