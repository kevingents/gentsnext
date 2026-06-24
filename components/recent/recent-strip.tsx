"use client";

import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { useT } from "@/components/i18n/locale-provider";
import type { ProductCardData } from "@/lib/catalog";

const KEY = "gents-recent-v1";

/**
 * Strip "Recent bekeken" — leest handles uit localStorage en haalt productdata
 * op via /api/products-by-handles. Verbergt zichzelf als er niets is.
 */
export function RecentStrip({ exclude }: { exclude?: string }) {
  const t = useT();
  const [items, setItems] = useState<ProductCardData[]>([]);

  useEffect(() => {
    let active = true;
    try {
      const raw = localStorage.getItem(KEY);
      const list: string[] = raw ? JSON.parse(raw) : [];
      const handles = list.filter((h) => h && h !== exclude).slice(0, 8);
      if (!handles.length) return;
      fetch("/api/products-by-handles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handles }),
      })
        .then((r) => r.json())
        .then((d) => {
          if (active) setItems(d.items || []);
        })
        .catch(() => {});
    } catch {
      /* leeg */
    }
    return () => {
      active = false;
    };
  }, [exclude]);

  if (items.length === 0) return null;
  return (
    <section className="mx-auto max-w-page px-gutter py-16">
      <header className="mb-8">
        <p className="label-brand">{t("recent.eyebrow")}</p>
        <h2 className="mt-2 text-display-md">{t("recent.title")}</h2>
      </header>
      <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
        {items.slice(0, 4).map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </section>
  );
}
