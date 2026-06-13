"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { formatEuro } from "@/lib/pricing";
import type { ProductCardData } from "@/lib/catalog";

/**
 * Header-instant-search. Klik op het zoekicoon opent een fullscreen-overlay
 * met direct-tikken-suggesties (debounced 200ms). Klik op een product →
 * direct naar PDP; "Toon alle resultaten" → /zoeken?q=…
 */
export function InstantSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
      setQ("");
      setItems([]);
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    const id = setTimeout(() => {
      fetch(`/api/search-suggest?q=${encodeURIComponent(q)}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => {
          if (active) {
            setItems(d.items || []);
            setLoading(false);
          }
        })
        .catch(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(id);
      active = false;
    };
  }, [q, open]);

  if (!open) return null;

  const POPULAIR = ["pakken", "overhemden", "smoking", "stropdassen"];

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label="Zoeken" aria-modal="true">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div className="absolute inset-x-0 top-0 max-h-[90vh] overflow-y-auto bg-canvas shadow-pop">
        <div className="mx-auto max-w-page px-gutter py-5">
          <form
            action="/zoeken"
            method="get"
            onSubmit={() => onClose()}
            className="flex items-center gap-3 border-b border-line pb-3"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="text-muted">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
            </svg>
            <input
              ref={inputRef}
              name="q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Zoek op pak, kleur, merk of categorie…"
              aria-label="Zoekterm"
              className="flex-1 bg-transparent py-2 font-sans text-base focus:outline-none"
            />
            <button type="button" onClick={onClose} className="font-sans text-sm text-muted underline">
              Sluiten
            </button>
          </form>

          {q.trim().length < 2 ? (
            <div className="py-6">
              <p className="label-brand">Populair</p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {POPULAIR.map((c) => (
                  <li key={c}>
                    <Link
                      href={`/collections/${c}`}
                      onClick={onClose}
                      className="border border-line bg-canvas px-3 py-1.5 font-sans text-sm transition-colors hover:border-ink"
                    >
                      {c.charAt(0).toUpperCase() + c.slice(1)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : items.length === 0 && !loading ? (
            <p className="py-6 font-sans text-sm text-muted">Geen artikelen gevonden voor "{q}".</p>
          ) : (
            <>
              <ul className="divide-y divide-line">
                {items.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/products/${p.handle}`}
                      onClick={onClose}
                      className="flex items-center gap-4 py-3 transition-colors hover:bg-surface"
                    >
                      <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-card bg-surface">
                        {p.imageUrl ? <Image src={p.imageUrl} alt={p.imageAlt} fill sizes="44px" className="object-cover" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        {p.vendor ? <p className="font-sans text-[0.65rem] uppercase tracking-wide text-muted">{p.vendor}</p> : null}
                        <p className="truncate font-sans text-sm">{p.title}</p>
                        <p className="font-sans text-xs text-ink-soft">
                          {p.hasPriceRange ? "vanaf " : ""}
                          {formatEuro(p.minPriceCents)}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
              {items.length > 0 ? (
                <Link
                  href={`/zoeken?q=${encodeURIComponent(q)}`}
                  onClick={onClose}
                  className="mt-4 block border-t border-line py-3 text-center font-sans text-sm text-ink underline underline-offset-4"
                >
                  Toon alle resultaten →
                </Link>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
