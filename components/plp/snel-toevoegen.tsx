"use client";

import { useEffect, useRef, useState } from "react";
import type { TegelMaat } from "@/lib/catalog";
import { useCart } from "@/components/cart/cart-context";
import { useT } from "@/components/i18n/locale-provider";
import { track } from "@/lib/track-client";

/**
 * Snel toevoegen vanaf de tegel: maat kiezen zonder eerst de productpagina te
 * openen.
 *
 * Drie keuzes die dit eerlijk houden:
 *
 *  1. UITVERKOCHTE MATEN BLIJVEN STAAN, uitgegrijsd. Ze weglaten maakt de rij
 *     korter maar liegt over het assortiment — en een klik op een uitverkochte
 *     maat is een inkoopsignaal dat we al meten (`size_click`).
 *  2. GEEN EIGEN VOORRAADWAARHEID. De maten komen uit dezelfde bron als de
 *     productpagina (availableForSkus, dus mét reserveringen en
 *     veiligheidsvoorraad). Een tegel die iets aanbiedt wat de PDP daarna
 *     weigert is erger dan geen snelknop.
 *  3. HET IS EEN AANVULLING, GEEN VERVANGING. De tegel blijft een link naar de
 *     productpagina; dit paneel opent alleen op de knop. Wie de foto's, de
 *     pasvorm of de maattabel wil zien, klikt gewoon door.
 */
export function SnelToevoegen({
  handle,
  title,
  imageUrl,
  hoofdgroep,
  maten,
}: {
  handle: string;
  title: string;
  imageUrl: string;
  hoofdgroep: string;
  maten: TegelMaat[];
}) {
  const cart = useCart();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [gekozen, setGekozen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  // Buiten klikken of Escape sluit het paneel. Zonder dit blijft er op een
  // lijstpagina zomaar een half paneel openstaan over de tegel eronder.
  useEffect(() => {
    if (!open) return;
    const opKlik = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const opToets = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", opKlik);
    document.addEventListener("keydown", opToets);
    return () => {
      document.removeEventListener("mousedown", opKlik);
      document.removeEventListener("keydown", opToets);
    };
  }, [open]);

  if (!maten.length) return null;

  function kies(m: TegelMaat) {
    if (!m.leverbaar) {
      // Uitverkocht: geen wagen, wél het signaal — dit is de vraag die we anders
      // nooit zien omdat de klant gewoon wegklikt.
      track("size_click", { handle, props: { size: m.size, bron: "plp-snel" } });
      return;
    }
    cart.add({
      sku: m.sku,
      productHandle: handle,
      title,
      size: m.size,
      color: "",
      priceCents: m.priceCents,
      imageUrl,
      qty: 1,
      hoofdgroep,
    });
    setGekozen(m.size);
    setOpen(false);
    window.setTimeout(() => setGekozen(null), 2500);
  }

  return (
    <div ref={wrap} className="relative">
      <button
        type="button"
        onClick={(e) => {
          // De tegel is één grote link; zonder dit navigeert de klik meteen weg.
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-expanded={open}
        className="w-full rounded-lg border border-line bg-canvas/95 py-2 font-sans text-xs font-medium text-ink backdrop-blur transition-colors hover:border-ink"
      >
        {gekozen ? t("plp.snel.toegevoegd", { size: gekozen }) : t("plp.snel.knop")}
      </button>

      {open ? (
        <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border border-line bg-canvas p-2 shadow-pop">
          <div className="flex flex-wrap gap-1.5">
            {maten.map((m) => (
              <button
                key={m.sku}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  kies(m);
                }}
                aria-disabled={!m.leverbaar}
                className={`min-w-11 rounded border px-2 py-1.5 font-sans text-xs transition-colors ${
                  m.leverbaar
                    ? "border-line hover:border-ink"
                    : "cursor-not-allowed border-line/60 text-muted line-through"
                }`}
              >
                {m.size}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
