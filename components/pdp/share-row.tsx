"use client";

import { useState } from "react";

/** Delen via systeem of kopieer-link. Geen tracking, geen externe scripts. */
export function ShareRow({ title }: { title: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = typeof window !== "undefined" ? window.location.href : "";
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* gebruiker annuleerde */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* leeg */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="mt-6 inline-flex items-center gap-2 font-sans text-xs text-ink-soft underline underline-offset-4 hover:text-ink"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M16 6l-4-4-4 4M12 2v14" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {copied ? "Link gekopieerd" : "Deel dit product"}
    </button>
  );
}
