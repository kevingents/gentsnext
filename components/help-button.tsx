"use client";

import Link from "next/link";
import { useState } from "react";

/**
 * Floating "Hulp nodig?"-knop rechtsonder. Eenvoudige dropdown met links naar
 * klantenservice, winkelzoeker en (later) chat/WhatsApp. Geen externe scripts.
 */
export function HelpButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed bottom-6 left-6 z-30 hidden lg:block">
      {open ? (
        <div className="mb-3 w-64 border border-line bg-canvas p-4 shadow-pop">
          <p className="label-brand mb-3">Hulp nodig?</p>
          <ul className="space-y-2 font-sans text-sm">
            <li>
              <Link href="/pages/service" onClick={() => setOpen(false)} className="text-ink hover:underline">
                Klantenservice
              </Link>
            </li>
            <li>
              <Link href="/maatadvies" onClick={() => setOpen(false)} className="text-ink hover:underline">
                Maatadvies krijgen
              </Link>
            </li>
            <li>
              <Link href="/pages/winkels" onClick={() => setOpen(false)} className="text-ink hover:underline">
                Vind een winkel
              </Link>
            </li>
            <li>
              <Link href="/pages/etiquette" onClick={() => setOpen(false)} className="text-ink hover:underline">
                Dresscode-gids
              </Link>
            </li>
          </ul>
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Hulp nodig"
        className="flex h-12 items-center gap-2 rounded-full border border-line bg-canvas px-5 font-sans text-sm shadow-card hover:border-ink"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9a2.5 2.5 0 014.9.5c0 1.5-2.4 2-2.4 3.5M12 16h.01" strokeLinecap="round" />
        </svg>
        Hulp nodig?
      </button>
    </div>
  );
}
