"use client";

import { useEffect, useRef } from "react";
import type { ProductCardData } from "@/lib/catalog";
import { track } from "@/lib/track-client";

/**
 * `view_item_list` — welke producten heeft de klant daadwerkelijk gezíen.
 *
 * Dit is de NOEMER onder `select_item` en `view_item`. Zonder deze meting weet
 * je alleen wat er geklikt werd, niet wat er getoond werd, en is elke
 * doorklikratio een gok. Google Ads en Meta gebruiken hem bovendien om te leren
 * welk aanbod aanslaat.
 *
 * De event-catalogus kende `lijst_bekeken` al wel, maar er vuurde niets — en
 * precies dat soort gat is waarom die catalogus bestaat: een event dat wel
 * gedeclareerd is en nooit afgaat leest achteraf als "gemeten".
 *
 * Alleen de eerste 24 kaarten gaan mee. GA4 kapt een items-array toch af, en
 * een lijst van 200 producten zou de payload groter maken dan de pagina zelf.
 */
export function TrackLijst({
  producten,
  listId,
  listName,
}: {
  producten: ProductCardData[];
  /** Bv. "categorie:overhemden", "collection:sale", "zoek:smoking". */
  listId: string;
  listName?: string;
}) {
  // Eén keer per lijst, niet per re-render. Een filterwissel geeft een nieuwe
  // listId en dus terecht een nieuw event.
  const gemeld = useRef("");

  useEffect(() => {
    if (!producten?.length) return;
    const sleutel = `${listId}|${producten.length}|${producten[0]?.handle ?? ""}`;
    if (gemeld.current === sleutel) return;
    gemeld.current = sleutel;

    track("lijst_bekeken", {
      props: {
        listId,
        listName: listName || listId,
        aantal: producten.length,
        items: producten.slice(0, 24).map((p, i) => ({
          item_id: p.handle,
          item_name: p.title,
          item_brand: p.vendor || undefined,
          item_category: p.category || undefined,
          price: p.minPriceCents / 100,
          index: i + 1,
          quantity: 1,
        })),
      },
    });
  }, [producten, listId, listName]);

  return null;
}
