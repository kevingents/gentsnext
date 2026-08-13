"use client";

import { useEffect, useState } from "react";

export function Accordion({
  items,
  altijdOpen = false,
}: {
  items: { title: string; content: React.ReactNode }[];
  /** A/B-variant: alles uitgeklapt tonen (ook mobiel), i.p.v. dicht. */
  altijdOpen?: boolean;
}) {
  // Mobiel: alles dicht (rustiger, korter scrollen); desktop: eerste item open.
  // SSR rendert dicht; op desktop klapt het eerste item na hydration open.
  // Een verzameling i.p.v. één index, want de A/B-variant "alles open" moet
  // daarna nog wél per item dicht kunnen — een uitklapper die niet meer
  // reageert op klikken is erger dan de variant die je wilde testen.
  const [open, setOpen] = useState<Set<number>>(altijdOpen ? new Set(items.map((_, i) => i)) : new Set());
  useEffect(() => {
    if (altijdOpen) return; // variant beslist de begintoestand
    if (window.matchMedia("(min-width: 1024px)").matches) setOpen(new Set([0]));
  }, [altijdOpen]);
  return (
    <div className="border-t border-line">
      {items.map((item, i) => {
        const isOpen = open.has(i);
        return (
          <div key={item.title} className="border-b border-line">
            <button
              type="button"
              onClick={() =>
                setOpen((vorig) => {
                  const volgend = new Set(vorig);
                  if (volgend.has(i)) volgend.delete(i);
                  else {
                    // Zonder variant blijft het gedrag "één tegelijk".
                    if (!altijdOpen) volgend.clear();
                    volgend.add(i);
                  }
                  return volgend;
                })
              }
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
