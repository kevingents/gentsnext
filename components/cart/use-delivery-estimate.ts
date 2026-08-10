"use client";

import { useEffect, useState } from "react";

export type Item = { sku: string; qty: number };

export type CartDelivery = {
  promise: string | null;
  /** sku → bezorgdag, alleen gevuld als de zendingen op verschillende dagen aankomen. */
  perSku: Map<string, string>;
  isSplit: boolean;
};

const LEEG: CartDelivery = { promise: null, perSku: new Map(), isSplit: false };

/**
 * Levertijd voor een setje regels, uit de allocatie-engine (magazijn-eerst,
 * openingstijden, feestdagen, cutoff). Eén plek die 'm ophaalt, zodat de
 * winkelwagen de kop-belofte én de per-artikel-datum uit dezelfde call haalt
 * i.p.v. twee keer te vragen.
 */
export function useDeliveryEstimate(items: Item[]): CartDelivery {
  const [data, setData] = useState<CartDelivery>(LEEG);
  const key = items.map((i) => `${i.sku}:${i.qty}`).join(",");

  useEffect(() => {
    if (!items.length) {
      setData(LEEG);
      return;
    }
    let active = true;
    fetch("/api/delivery-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!active) return;
        const est = d?.estimate;
        const per = new Map<string, string>();
        for (const p of est?.perSku ?? []) {
          if (p?.sku && p?.dateLabel) per.set(String(p.sku), String(p.dateLabel));
        }
        setData({ promise: est?.promise ?? null, perSku: per, isSplit: Boolean(est?.isSplit) });
      })
      .catch(() => {
        /* Bij een fout liever niets beloven dan een verzonnen datum. */
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return data;
}
