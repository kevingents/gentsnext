"use client";

import Link from "next/link";
import { useState } from "react";

type Branch = { store: string; qty: number };

/**
 * "Vandaag afhalen in winkel X". Toont aantal winkels met voorraad voor de
 * gekozen maat; klik = volledige modal met ALLE winkels (voorraad/geen voorraad).
 */
export function ClickAndCollect({ branches }: { branches: Branch[] }) {
  const [open, setOpen] = useState(false);
  const available = branches.filter((b) => b.qty > 0);
  if (!available.length) return null;
  const sorted = [...branches].sort((a, b) => b.qty - a.qty);

  return (
    <>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between border border-line bg-canvas px-4 py-2.5 text-left font-sans text-sm hover:border-ink"
        >
          <span>
            <span className="text-success">●</span>{" "}
            <span className="font-medium">Vandaag afhalen</span>{" "}
            <span className="text-muted">
              in {available.length} {available.length === 1 ? "winkel" : "winkels"}
            </span>
          </span>
          <span aria-hidden className="text-muted">→</span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-label="Voorraad per winkel" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="font-display text-lg">Voorraad per winkel</p>
              <button type="button" onClick={() => setOpen(false)} aria-label="Sluiten" className="font-sans text-sm underline">
                Sluiten
              </button>
            </div>
            <p className="border-b border-line bg-surface px-5 py-3 font-sans text-xs text-ink-soft">
              Reservering en ophaal volgt in de checkout-fase. Bel ondertussen direct
              voor zekerheid.
            </p>
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {sorted.map((b) => {
                const inStock = b.qty > 0;
                return (
                  <li key={b.store} className="flex items-center justify-between gap-3 px-5 py-3 font-sans text-sm">
                    <span className="text-ink">{b.store}</span>
                    {inStock ? (
                      <span className="text-xs text-success">
                        ● {b.qty > 5 ? "Op voorraad" : `Nog ${b.qty}`}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">Niet op voorraad</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-line p-5">
              <Link href="/pages/winkels" onClick={() => setOpen(false)} className="btn-ghost w-full">
                Adressen & openingstijden
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
