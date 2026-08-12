"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

const KEY = "gents-recent-v1";
const MAX = 12;

/**
 * Plaatst geen UI; voegt de bezochte product-handle vooraan toe in localStorage
 * en meldt de weergave.
 *
 * Titel, merk, categorie en prijs gaan mee omdat `view_item` bij Meta en Google
 * Ads de basis is voor waarde-gestuurd bieden. Zonder prijs weten die platforms
 * alleen dát er gekeken werd, niet naar hoeveel — en dan optimaliseren ze een
 * kijkje naar een das even hard als een kijkje naar een driedelig pak.
 */
export function TrackRecent({
  handle,
  title,
  vendor,
  category,
  priceCents,
}: {
  handle: string;
  title?: string;
  vendor?: string;
  category?: string;
  priceCents?: number;
}) {
  useEffect(() => {
    if (!handle) return;
    track("product_view", {
      handle,
      valueCents: priceCents ?? 0,
      props: {
        ...(title ? { title } : {}),
        ...(vendor ? { brand: vendor } : {}),
        ...(category ? { category } : {}),
      },
    });
    try {
      const raw = localStorage.getItem(KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const next = [handle, ...list.filter((h) => h !== handle)].slice(0, MAX);
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      /* leeg */
    }
  }, [handle]);
  return null;
}
