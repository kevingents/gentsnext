"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-context";
import { formatEuro } from "@/lib/pricing";
import { BrandedState } from "@/components/brand-state";

export default function WinkelwagenPage() {
  const cart = useCart();

  if (cart.lines.length === 0) {
    return (
      <BrandedState
        eyebrow="Winkelwagen"
        title="Je winkelwagen is leeg"
        intro="Ontdek onze pakken, overhemden en accessoires — of laat je inspireren door de looks."
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/collections/pakken" className="btn-primary">Begin met shoppen</Link>
          <Link href="/looks" className="btn-ghost">Bekijk de looks</Link>
        </div>
      </BrandedState>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <h1 className="text-display-md">Winkelwagen</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Regels */}
        <ul className="divide-y divide-line border-y border-line">
          {cart.lines.map((line) => (
            <li key={line.id} className="flex gap-4 py-5">
              <Link href={`/products/${line.productHandle}`} className="shrink-0">
                <div className="relative h-28 w-22 overflow-hidden rounded-card bg-surface" style={{ width: "5.5rem" }}>
                  {line.imageUrl ? (
                    <Image src={line.imageUrl} alt={line.title} fill sizes="88px" className="object-cover" />
                  ) : null}
                </div>
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {line.groupLabel ? (
                      <p className="font-sans text-[0.65rem] uppercase tracking-wide text-muted">{line.groupLabel}</p>
                    ) : null}
                    <Link href={`/products/${line.productHandle}`} className="font-sans text-sm font-medium hover:underline">
                      {line.roleLabel ? `${line.roleLabel}: ` : ""}
                      {line.title}
                    </Link>
                    <p className="mt-0.5 font-sans text-xs text-muted">
                      {[line.color, line.size && `maat ${line.size}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="shrink-0 font-sans text-sm">{formatEuro(line.priceCents * line.qty)}</p>
                </div>
                <div className="mt-auto flex items-center gap-4 pt-3">
                  <div className="flex items-center border border-line">
                    <button type="button" onClick={() => cart.setQty(line.id, line.qty - 1)} aria-label="Minder" className="px-3 py-1.5 hover:bg-surface">
                      −
                    </button>
                    <span className="min-w-[2rem] text-center font-sans text-sm">{line.qty}</span>
                    <button type="button" onClick={() => cart.setQty(line.id, line.qty + 1)} aria-label="Meer" className="px-3 py-1.5 hover:bg-surface">
                      +
                    </button>
                  </div>
                  <button type="button" onClick={() => cart.remove(line.id)} className="font-sans text-xs text-muted underline hover:text-ink">
                    Verwijder
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Samenvatting */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="border border-line p-5">
            <p className="label-brand">Overzicht</p>
            <div className="mt-4 flex items-center justify-between font-sans text-sm">
              <span className="text-muted">Artikelen ({cart.count})</span>
              <span>{formatEuro(cart.subtotalCents)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between font-sans text-sm">
              <span className="text-muted">Verzending</span>
              <span>{cart.subtotalCents >= 7500 ? "Gratis" : "Berekend bij afrekenen"}</span>
            </div>
            {cart.subtotalCents > 0 && cart.subtotalCents < 7500 ? (
              <p className="mt-2 font-sans text-xs text-ink-soft">
                Nog <strong>{formatEuro(7500 - cart.subtotalCents)}</strong> tot gratis verzending.
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
              <span className="font-sans text-sm">Subtotaal</span>
              <span className="font-display text-xl">{formatEuro(cart.subtotalCents)}</span>
            </div>
            <p className="mt-1 font-sans text-xs text-muted">Verzendkosten worden bij het afrekenen bepaald.</p>
            <Link href="/afrekenen" className="btn-primary mt-5 w-full">
              Afrekenen
            </Link>
            <Link href="/collections/pakken" className="btn-ghost mt-2 w-full">
              Verder winkelen
            </Link>
            <ul className="mt-5 space-y-1.5">
              {["Gratis retour binnen 14 dagen", "Veilig betalen met iDEAL", "Persoonlijk advies in 19 winkels"].map((t) => (
                <li key={t} className="flex items-center gap-2 font-sans text-xs text-ink-soft">
                  <span aria-hidden className="text-success">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
