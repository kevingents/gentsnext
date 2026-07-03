"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { useWishlist } from "@/components/wishlist/wishlist-context";
import { BrandedState } from "@/components/brand-state";
import { useT } from "@/components/i18n/locale-provider";
import type { ProductCardData } from "@/lib/catalog";

export default function FavorietenPage() {
  const t = useT();
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
        <h1 className="text-display-md">{t("wishlist.title")}</h1>
        <p className="mt-4 font-sans text-muted">{t("common.loading")}</p>
      </div>
    );
  }

  if (!wl.handles.length) {
    return (
      <BrandedState
        eyebrow={t("wishlist.label")}
        title={t("wishlist.empty_title")}
        intro={t("wishlist.empty_intro")}
      >
        <Link href="/collections/pakken" className="btn-primary">{t("common.browse_now")}</Link>
      </BrandedState>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="flex items-end justify-between">
        <div>
          <p className="label-brand">{t("wishlist.label")}</p>
          <h1 className="mt-2 text-display-md">{t("wishlist.title")}</h1>
          <p className="mt-1 font-sans text-sm text-muted">{wl.count} {wl.count === 1 ? t("wishlist.item") : t("wishlist.items")}</p>
        </div>
        <button type="button" onClick={wl.clear} className="font-sans text-sm text-muted underline hover:text-ink">
          {t("wishlist.clear_list")}
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
