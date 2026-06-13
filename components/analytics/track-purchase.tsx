"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

/** Vuurt het purchase-event één keer per order (dedupe via localStorage). */
export function TrackPurchase({ orderNumber, totalCents }: { orderNumber: string; totalCents: number }) {
  useEffect(() => {
    const key = `gents-purchase-${orderNumber}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch {
      /* leeg */
    }
    track("purchase", { valueCents: totalCents, props: { orderNumber } });
  }, [orderNumber, totalCents]);
  return null;
}
