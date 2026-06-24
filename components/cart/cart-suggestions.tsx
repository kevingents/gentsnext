"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/i18n/locale-provider";
import { formatEuro } from "@/lib/pricing";

/**
 * Bijpassende artikelen ("vaak samen gekocht") op basis van de hoofdgroep(en) van
 * de winkelwagen of een net toegevoegd artikel. Gedeeld tussen de cart-drawer en
 * de "Toegevoegd"-bevestiging. Horizontale strip, sluit zacht (lege lijst = niets).
 */
type Suggestion = { id: string; handle: string; title: string; imageUrl: string; minPriceCents: number };

export function CartSuggestions({
  hoofdgroepen,
  excludeHandles,
  onNavigate,
  title,
  className = "border-t border-line px-5 py-4",
}: {
  hoofdgroepen: string[];
  excludeHandles: string[];
  onNavigate: () => void;
  title?: string;
  className?: string;
}) {
  const t = useT();
  const heading = title ?? t("cart.suggestions.title");
  const [items, setItems] = useState<Suggestion[]>([]);
  const key = hoofdgroepen.join(",");
  const exclude = excludeHandles.join(",");

  useEffect(() => {
    if (!key) return;
    let active = true;
    const skip = new Set(exclude.split(",").filter(Boolean));
    fetch(`/api/cart-suggestions?hg=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (active) setItems(((d.items || []) as Suggestion[]).filter((s) => !skip.has(s.handle)).slice(0, 10));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key, exclude]);

  if (!items.length) return null;
  return (
    <div className={className}>
      <p className="label-brand mb-3">{heading}</p>
      <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((s) => (
          <Link key={s.id} href={`/products/${s.handle}`} onClick={onNavigate} className="group block w-28 shrink-0">
            <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-surface">
              {s.imageUrl ? <Image src={s.imageUrl} alt={s.title} fill sizes="112px" className="object-cover transition-transform duration-300 group-hover:scale-105" /> : null}
            </div>
            <p className="mt-1.5 line-clamp-2 font-sans text-xs leading-snug text-ink">{s.title}</p>
            <p className="font-sans text-xs text-muted">{formatEuro(s.minPriceCents)}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
