"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { useCart } from "@/components/cart/cart-context";
import { formatEuro } from "@/lib/pricing";

/**
 * Site-brede "Toegevoegd aan winkelwagen"-bevestiging. Verschijnt bij elke
 * toevoeging (PDP, looks, pak-samensteller, aanraders) i.p.v. de hele
 * winkelwagen-drawer open te klappen. Geeft keuze: verder kijken in de wagen of
 * direct afrekenen. Sluit automatisch na een paar seconden.
 */
export function AddedToCartToast() {
  const cart = useCart();
  const added = cart.added;

  useEffect(() => {
    if (!added) return;
    const t = setTimeout(() => cart.dismissAdded(), 5000);
    return () => clearTimeout(t);
    // Opnieuw aftellen bij elke nieuwe toevoeging (nonce).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [added?.nonce]);

  if (!added) return null;
  const l = added.line;
  const meta = [l.color, l.size ? `maat ${l.size}` : ""].filter(Boolean).join(" · ");

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex justify-center px-4 pt-4 sm:pt-20" role="status" aria-live="polite">
      <div className="pointer-events-auto relative w-full max-w-md rounded-card border border-line bg-canvas p-4 shadow-drawer sm:p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-success" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l2.5 2.5L16 9.5" />
            </svg>
            <p className="font-sans text-sm font-medium text-ink">Toegevoegd aan winkelwagen</p>
          </div>
          <button type="button" onClick={cart.dismissAdded} aria-label="Sluiten" className="text-muted hover:text-ink">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="mt-3 flex items-start gap-3 border-t border-line pt-3">
          <div className="relative h-20 w-14 shrink-0 overflow-hidden rounded-card bg-surface">
            {l.imageUrl ? <Image src={l.imageUrl} alt={l.title} fill sizes="56px" className="object-cover" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-sans text-sm font-medium text-ink">{l.title}</p>
            {meta ? <p className="mt-0.5 font-sans text-xs text-muted">{meta}</p> : null}
            {added.extraCount > 0 ? <p className="mt-0.5 font-sans text-xs text-muted">+ {added.extraCount} onderdeel{added.extraCount === 1 ? "" : "en"}</p> : null}
          </div>
          <p className="shrink-0 font-sans text-sm text-ink">{formatEuro(l.priceCents)}</p>
        </div>

        <div className="mt-4 grid gap-2">
          <button
            type="button"
            onClick={() => { cart.dismissAdded(); cart.open(); }}
            className="btn-ghost w-full"
          >
            Bekijk winkelwagen ({cart.count})
          </button>
          <Link href="/afrekenen" onClick={cart.dismissAdded} className="btn-primary w-full text-center">
            Ga naar de kassa
          </Link>
        </div>
      </div>
    </div>
  );
}
