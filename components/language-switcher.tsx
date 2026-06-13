"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/lib/i18n";

/** Taalkeuze — zet de locale-cookie en ververst de pagina (server hertaalt). */
export function LanguageSwitcher({ current }: { current: Locale }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function choose(loc: Locale) {
    document.cookie = `gents-locale=${loc}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Taal wijzigen"
        className="flex items-center gap-1 font-sans text-xs uppercase tracking-wide text-ink-soft transition-colors hover:text-ink"
      >
        {current}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden><path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      </button>
      {open ? (
        <ul className="absolute right-0 z-50 mt-2 w-36 border border-line bg-canvas py-1 shadow-pop">
          {LOCALES.map((loc) => (
            <li key={loc}>
              <button
                type="button"
                onClick={() => choose(loc)}
                className={`block w-full px-3 py-1.5 text-left font-sans text-sm hover:bg-surface ${loc === current ? "font-medium text-ink" : "text-ink-soft"}`}
              >
                {LOCALE_LABELS[loc]}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
