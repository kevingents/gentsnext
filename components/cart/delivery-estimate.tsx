"use client";

import { Dot } from "@/components/icons";
import { useDeliveryEstimate, type Item } from "@/components/cart/use-delivery-estimate";

/**
 * Levertijd-belofte uit de allocatie-engine (magazijn-eerst, openingstijden,
 * feestdagen, cutoff). Voor de afrekenpagina; de winkelwagen gebruikt de hook
 * rechtstreeks omdat die ook de per-artikel-datums nodig heeft.
 */
export function DeliveryEstimate({ items, className }: { items: Item[]; className?: string }) {
  const { promise } = useDeliveryEstimate(items);

  // Geen fallback-tekst vÃ³Ã³r het antwoord er is: de generieke belofte flitste
  // even en werd dan gecorrigeerd. Non-breaking space als expliciete escape
  // (een kale spatie collapst naar 0px) houdt de regelhoogte stabiel.
  return (
    <p className={className ?? "font-sans text-xs text-ink-soft"}>
      {promise ? (
        <>
          <span className="text-success">
            <Dot className="inline-block h-[7px] w-[7px]" />
          </span>{" "}
          {promise}
        </>
      ) : (
        <>&nbsp;</>
      )}
    </p>
  );
}
