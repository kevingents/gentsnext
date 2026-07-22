"use client";

import { useEffect, useState } from "react";
import { Dot } from "@/components/icons";

type Item = { sku: string; qty: number };

/**
 * Toont een accurate levertijd-belofte o.b.v. de allocatie-engine (magazijn-
 * eerst, openingstijden, cutoff). Voor cart-drawer en afrekenpagina.
 */
export function DeliveryEstimate({ items, className }: { items: Item[]; className?: string }) {
  const [promise, setPromise] = useState<string | null>(null);
  const key = items.map((i) => `${i.sku}:${i.qty}`).join(",");

  useEffect(() => {
    if (!items.length) return;
    let active = true;
    fetch("/api/delivery-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (active) setPromise(d?.estimate?.promise ?? null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  // Geen fallback-tekst vóór het antwoord er is: de generieke belofte flitste
  // even en werd dan gecorrigeerd. Non-breaking space als expliciete escape
  // (een kale spatie collapst naar 0px) houdt de regelhoogte stabiel.
  return (
    <p className={className ?? "font-sans text-xs text-ink-soft"}>
      {promise ? (
        <>
          <span className="text-success"><Dot className="inline-block h-[7px] w-[7px]" /></span> {promise}
        </>
      ) : (
        "\u00A0"
      )}
    </p>
  );
}
