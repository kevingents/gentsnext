"use client";

import Image from "next/image";
import Link from "next/link";
import { useCart } from "@/components/cart/cart-context";
import { formatEuro } from "@/lib/pricing";

export default function WinkelwagenPage() {
  const cart = useCart();

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-page px-gutter py-20 text-center">
        <h1 className="text-display-md">Je winkelwagen is leeg</h1>
        <p className="mt-3 font-sans text-ink-soft">Ontdek onze pakken, overhemden en accessoires.</p>
        <Link href="/collections/pakken" className="btn-primary mt-8 inline-flex">
          Begin met shoppen
        </Link>
      </div>
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
              <span className="text-muted">Subtotaal ({cart.count})</span>
              <span>{formatEuro(cart.subtotalCents)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between font-sans text-sm">
              <span className="text-muted">Verzending</span>
              <span>{cart.subtotalCents >= 5000 ? "Gratis" : "Berekend bij afrekenen"}</span>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
              <span className="font-sans text-sm">Totaal</span>
              <span className="font-display text-xl">{formatEuro(cart.subtotalCents)}</span>
            </div>
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
