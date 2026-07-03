"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatEuro } from "@/lib/pricing";
import { track } from "@/lib/track-client";
import { useT } from "@/components/i18n/locale-provider";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";
import type { ProductCardData } from "@/lib/catalog";

/**
 * Header-instant-search. Klik op het zoekicoon opent een fullscreen-overlay
 * met direct-tikken-suggesties (debounced 200ms). Klik op een product →
 * direct naar PDP; "Toon alle resultaten" → /zoeken?q=…
 */
export function InstantSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus (op het zoekveld = eerste focusable), scroll-lock, focus-trap, Esc en
  // achtergrond inert komen uit de gedeelde hook (portal → body, dus inertMain veilig).
  useModalA11y(panelRef, { onClose, active: open, inertMain: true });

  useEffect(() => {
    // Alleen de zoekstaat resetten bij sluiten; de rest doet useModalA11y.
    if (!open) {
      setQ("");
      setItems([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || q.trim().length < 2) {
      setItems([]);
      return;
    }
    let active = true;
    setLoading(true);
    const id = setTimeout(() => {
      // Lowercase ín de URL: de CDN cachet op de request-URL, dus alleen zó delen
      // "Pak" en "pak" één edge-cache-entry (de zoek is toch case-insensitief).
      fetch(`/api/search-suggest?q=${encodeURIComponent(q.trim().toLowerCase())}`)
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => {
          if (active) {
            const results = d.items || [];
            setItems(results);
            setLoading(false);
            track(results.length ? "search" : "search_no_results", { query: q, props: { results: results.length } });
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

  // Via portal naar document.body: de header heeft backdrop-blur, wat een
  // containing block voor fixed-kinderen maakt — anders klemt deze overlay in op
  // de header-hoogte i.p.v. fullscreen (zelfde reden als de mobiele menu-drawer).
  const tree = (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-label={t("search.label")} aria-modal="true">
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div ref={panelRef} tabIndex={-1} className="absolute inset-x-0 top-0 max-h-[90vh] overflow-y-auto bg-canvas shadow-pop focus:outline-none">
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
              aria-label={t("search.input.ariaLabel")}
              className="flex-1 bg-transparent py-2 font-sans text-base focus:outline-none"
            />
            <button type="button" onClick={onClose} className="font-sans text-sm text-muted underline">
              {t("common.close")}
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
                {items.map((p, i) => (
                  <li key={p.id}>
                    <Link
                      href={`/products/${p.handle}`}
                      onClick={() => {
                        track("search_click", { query: q, handle: p.handle, props: { position: i + 1 } });
                        onClose();
                      }}
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
                        {p.availableSizes && p.availableSizes.length ? (
                          <p className="mt-0.5 truncate font-sans text-[0.65rem] text-muted">
                            Maten: {p.availableSizes.slice(0, 8).join(" · ")}
                          </p>
                        ) : null}
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
  return createPortal(tree, document.body);
}
