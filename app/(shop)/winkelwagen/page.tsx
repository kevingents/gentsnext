"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CheckIcon } from "@/components/icons";
import { useCart } from "@/components/cart/cart-context";
import { useT } from "@/components/i18n/locale-provider";
import { formatEuro } from "@/lib/pricing";
import { BrandedState } from "@/components/brand-state";

export default function WinkelwagenPage() {
  const cart = useCart();
  const t = useT();
  // Instelbare gratis-verzending-drempel (i.p.v. hardcoded); checkout blijft autoritatief.
  const [freeShipCents, setFreeShipCents] = useState(7500);
  useEffect(() => {
    let active = true;
    fetch("/api/promo")
      .then((r) => r.json())
      .then((d) => { if (active && Number(d?.freeShippingCents) > 0) setFreeShipCents(Number(d.freeShippingCents)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Nog niet gehydrateerd uit localStorage → neutraal skelet i.p.v. eerst de
  // lege-staat flitsen en dan de gevulde wagen (voelt als dataverlies).
  if (!cart.hydrated) {
    return (
      <div className="mx-auto max-w-page px-gutter py-12" aria-busy="true">
        <div className="h-9 w-56 animate-pulse rounded-card bg-surface" />
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <div className="h-28 animate-pulse rounded-card bg-surface" />
            <div className="h-28 animate-pulse rounded-card bg-surface" />
          </div>
          <div className="h-64 animate-pulse rounded-card bg-surface" />
        </div>
      </div>
    );
  }

  if (cart.lines.length === 0) {
    return (
      <BrandedState
        eyebrow={t("cart.header.eyebrow")}
        title={t("cart.empty_title")}
        intro={t("cart.empty_intro")}
      >
        <div className="flex flex-wrap justify-center gap-3">
          <Link href="/collections/pakken" className="btn-primary">{t("cart.empty.shopButton")}</Link>
          <Link href="/looks" className="btn-ghost">{t("cart.empty.looksButton")}</Link>
        </div>
      </BrandedState>
    );
  }

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <h1 className="text-display-md">{t("cart.header.eyebrow")}</h1>
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Regels */}
        <ul className="divide-y divide-line border-y border-line">
          {cart.lines.map((line) => (
            <li key={line.id} className="flex gap-4 py-5">
              <Link href={`/products/${line.productHandle}`} className="shrink-0">
                <div className="relative h-28 w-22 overflow-hidden rounded-card bg-surface" style={{ width: "5.5rem" }}>
                  {line.imageUrl ? (
                    <Image src={line.imageUrl} alt={line.title} fill sizes="88px" className="object-cover" />
                  ) : null}
                </div>
              </Link>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {line.groupLabel ? (
                      <p className="font-sans text-[0.65rem] uppercase tracking-wide text-muted">{line.groupLabel}</p>
                    ) : null}
                    <Link href={`/products/${line.productHandle}`} className="font-sans text-sm font-medium hover:underline">
                      {line.roleLabel ? `${line.roleLabel}: ` : ""}
                      {line.title}
                    </Link>
                    <p className="mt-0.5 font-sans text-xs text-muted">
                      {[line.color, line.size && `${t("common.size")} ${line.size}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="shrink-0 font-sans text-sm">{formatEuro(line.priceCents * line.qty)}</p>
                </div>
                <div className="mt-auto flex items-center gap-4 pt-3">
                  <div className="flex items-center border border-line">
                    <button type="button" onClick={() => cart.setQty(line.id, line.qty - 1)} aria-label={t("cart.line.decrementAriaLabel")} className="px-3 py-1.5 hover:bg-surface">
                      −
                    </button>
                    <span className="min-w-[2rem] text-center font-sans text-sm">{line.qty}</span>
                    <button type="button" onClick={() => cart.setQty(line.id, line.qty + 1)} aria-label={t("cart.line.incrementAriaLabel")} className="px-3 py-1.5 hover:bg-surface">
                      +
                    </button>
                  </div>
                  <button type="button" onClick={() => cart.remove(line.id)} className="font-sans text-xs text-muted underline hover:text-ink">
                    {t("cart.line.remove")}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Samenvatting */}
        <aside className="lg:sticky lg:top-24 lg:h-fit">
          <div className="border border-line p-5">
            <p className="label-brand">{t("cart.summary.eyebrow")}</p>
            <div className="mt-4 flex items-center justify-between font-sans text-sm">
              <span className="text-muted">{t("cart.summary.items")} ({cart.count})</span>
              <span>{formatEuro(cart.subtotalCents)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between font-sans text-sm">
              <span className="text-muted">{t("cart.summary.shipping")}</span>
              <span>{cart.subtotalCents >= freeShipCents ? t("cart.summary.freeShipping") : t("cart.summary.shippingCalculated")}</span>
            </div>
            {cart.subtotalCents > 0 && cart.subtotalCents < freeShipCents ? (
              <p className="mt-2 font-sans text-xs text-ink-soft">
                {t("cart.summary.freeShippingHint1")} <strong>{formatEuro(freeShipCents - cart.subtotalCents)}</strong> {t("cart.summary.freeShippingHint2")}
              </p>
            ) : null}
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4">
              <span className="font-sans text-sm">{t("cart.summary.subtotal")}</span>
              <span className="font-display text-xl">{formatEuro(cart.subtotalCents)}</span>
            </div>
            <p className="mt-1 font-sans text-xs text-muted">{t("cart.summary.shippingNote")}</p>
            <Link href="/afrekenen" className="btn-primary mt-5 w-full">
              {t("cart.summary.checkoutButton")}
            </Link>
            <Link href="/collections/pakken" className="btn-ghost mt-2 w-full">
              {t("cart.summary.continueButton")}
            </Link>
            <ul className="mt-5 space-y-1.5">
              {["cart.summary.trust.freeReturn", "cart.summary.trust.safePay", "cart.summary.trust.personalAdvice"].map((k) => (
                <li key={k} className="flex items-center gap-2 font-sans text-xs text-ink-soft">
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
