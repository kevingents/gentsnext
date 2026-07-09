"use client";

import { useState } from "react";
import { InstantSearch } from "@/components/search/instant-search";
import { useT } from "@/components/i18n/locale-provider";

export function SearchTrigger() {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* 44×44px tikvlak; -mx-2 compenseert in de layout zodat de icoon-spatiëring
          in de header gelijk blijft (het icoon zelf blijft 20px). */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("search.openAriaLabel")}
        className="-mx-2 flex h-11 w-11 items-center justify-center text-ink-soft transition-colors hover:text-ink"
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
