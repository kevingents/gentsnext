"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { useWishlist } from "@/components/wishlist/wishlist-context";
import { BrandedState } from "@/components/brand-state";
import type { ProductCardData } from "@/lib/catalog";

export default function FavorietenPage() {
  const wl = useWishlist();
  const [items, setItems] = useState<ProductCardData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!wl.hydrated) return;
    if (!wl.handles.length) {
      setItems([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    fetch("/api/products-by-handles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handles: wl.handles }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (active) {
          setItems(d.items || []);
          setLoading(false);
        }
      })
      .catch(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [wl.handles, wl.hydrated]);

  if (!wl.hydrated || loading) {
    return (
      <div className="mx-auto max-w-page px-gutter py-12">
        <h1 className="text-display-md">Favorieten</h1>
        <p className="mt-4 font-sans text-muted">Bezig met laden…</p>
      </div>
    );
  }

  if (!wl.handles.length) {
    return (
      <BrandedState
        eyebrow="Bewaard"
        title="Nog geen favorieten"
        intro="Bewaar producten met het hartje op de productkaart of -pagina, dan vind je ze hier altijd terug."
      >
        <Link href="/collections/pakken" className="btn-primary">Begin met shoppen</Link>
      </BrandedState>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="flex items-end justify-between">
        <div>
          <p className="label-brand">Bewaard</p>
          <h1 className="mt-2 text-display-md">Favorieten</h1>
          <p className="mt-1 font-sans text-sm text-muted">{wl.count} {wl.count === 1 ? "artikel" : "artikelen"}</p>
        </div>
        <button type="button" onClick={wl.clear} className="font-sans text-sm text-muted underline hover:text-ink">
          Lijst wissen
        </button>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((p) => (
          <ProductCard key={p.id} product={p} />
        ))}
      </div>
    </div>
  );
}
