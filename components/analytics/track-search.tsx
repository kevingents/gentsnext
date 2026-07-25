"use client";

import { useEffect, useRef } from "react";
import { track } from "@/lib/track-client";

/**
 * Meet de zoekPAGINA (server-gerenderd, dus ná het renderen — niet per
 * toetsaanslag zoals de instant-search dat doet). Eén event per combinatie van
 * zoekterm en aantal resultaten; geen resultaten = een afhaker, dat is een
 * ander event zodat het los te analyseren is.
 */
export function TrackSearch({ query, resultCount }: { query: string; resultCount: number }) {
  const last = useRef("");
  useEffect(() => {
    const key = `${query}|${resultCount}`;
    if (!query || last.current === key) return;
    last.current = key;
    track(resultCount === 0 ? "search_no_results" : "search", { query, props: { resultCount } });
  }, [query, resultCount]);
  return null;
}
