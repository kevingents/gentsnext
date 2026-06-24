"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

type Item = { sku: string; qty: number };

/**
 * Toont een accurate levertijd-belofte o.b.v. de allocatie-engine (magazijn-
 * eerst, openingstijden, cutoff). Voor cart-drawer en afrekenpagina.
 */
export function DeliveryEstimate({ items, className }: { items: Item[]; className?: string }) {
  const t = useT();
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

  return (
    <p className={className ?? "font-sans text-xs text-ink-soft"}>
      {promise ? <span className="text-success">●</span> : null}{" "}
      {promise || t("delivery.sameday")}
    </p>
  );
}
