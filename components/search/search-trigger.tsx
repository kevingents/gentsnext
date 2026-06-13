"use client";

import { useState } from "react";
import { InstantSearch } from "@/components/search/instant-search";

export function SearchTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Zoeken openen"
        className="text-ink-soft transition-colors hover:text-ink"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4.3-4.3" strokeLinecap="round" />
        </svg>
      </button>
      <InstantSearch open={open} onClose={() => setOpen(false)} />
    </>
  );
}
