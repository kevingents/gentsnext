"use client";

import { useEffect } from "react";
import { track } from "@/lib/track-client";

const KEY = "gents-recent-v1";
const MAX = 12;

/** Plaatst geen UI; voegt de bezochte product-handle vooraan toe in localStorage. */
export function TrackRecent({ handle }: { handle: string }) {
  useEffect(() => {
    if (!handle) return;
    track("product_view", { handle });
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
