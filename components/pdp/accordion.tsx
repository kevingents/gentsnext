"use client";

import { useEffect, useState } from "react";

export function Accordion({
  items,
}: {
  items: { title: string; content: React.ReactNode }[];
}) {
  // Mobiel: alles dicht (rustiger, korter scrollen); desktop: eerste item open.
  // SSR rendert dicht; op desktop klapt het eerste item na hydration open.
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 1024px)").matches) setOpen(0);
  }, []);
  return (
    <div className="border-t border-line">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={item.title} className="border-b border-line">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between py-4 text-left font-sans text-sm font-medium"
            >
              {item.title}
              <span aria-hidden className="text-muted">
                {isOpen ? "–" : "+"}
              </span>
            </button>
            {/* Dicht = CSS-verborgen, NIET conditioneel gerenderd: de inhoud
                (productbeschrijving, FAQ) moet in de server-HTML staan voor
                Google's mobile-first indexering. */}
            <div className={isOpen ? "pb-5" : "hidden"}>{item.content}</div>
          </div>
        );
      })}
    </div>
  );
}
