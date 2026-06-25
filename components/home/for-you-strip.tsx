"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import type { ProductCardData } from "@/lib/catalog";

/**
 * Persoonlijke "Voor jou"-strip op de homepage. Laadt sessie-gated na (de
 * homepage blijft statisch); toont niets voor uitgelogde bezoekers of zonder
 * bruikbaar signaal. Zelfde patroon als de "recently viewed"-strip.
 */
export function ForYouStrip() {
  const [data, setData] = useState<{ eyebrow: string; title: string; items: ProductCardData[] } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/account/for-you")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d?.items) && d.items.length >= 4) {
          setData({ eyebrow: d.eyebrow, title: d.title, items: d.items.slice(0, 4) });
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!data) return null;

  return (
    <section className="mx-auto max-w-page px-gutter py-16">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <p className="label-brand">{data.eyebrow}</p>
          <h2 className="mt-2 text-display-md">{data.title}</h2>
        </div>
        <Link href="/account" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
          Mijn GENTS
        </Link>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
        {data.items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
