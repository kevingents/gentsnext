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
  // Sticky afreken-balk wijkt zodra de footer in beeld komt — anders blijft de
  // onderste footer-rij (juridische links) permanent afgedekt. Zelfde patroon
  // als de sticky koopbalk op de PDP.
  const [footerVisible, setFooterVisible] = useState(false);
  useEffect(() => {
    const footer = document.querySelector("footer");
    if (!footer || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setFooterVisible(e.isIntersecting));
    io.observe(footer);
    return () => io.disconnect();
  }, []);
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
    <div className="mx-auto max-w-page px-gutter py-12 pb-28 lg:pb-12">
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
                  {/* 44px-tikvlakken; − uit op aantal 1 (mis-tik mag de regel niet
                      stilletjes weghalen — daar is de Verwijder-knop voor). */}
                  <div className="flex items-center border border-line">
                    <button type="button" onClick={() => cart.setQty(line.id, line.qty - 1)} disabled={line.qty <= 1} aria-label={t("cart.line.decrementAriaLabel")} className="flex h-11 min-w-11 items-center justify-center px-2.5 hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent">
                      −
                    </button>
                    <span className="min-w-[2rem] text-center font-sans text-sm">{line.qty}</span>
                    <button type="button" onClick={() => cart.setQty(line.id, line.qty + 1)} aria-label={t("cart.line.incrementAriaLabel")} className="flex h-11 min-w-11 items-center justify-center px-2.5 hover:bg-surface">
                      +
                    </button>
                  </div>
                  <button type="button" onClick={() => cart.remove(line.id)} className="flex min-h-11 items-center font-sans text-xs text-muted underline hover:text-ink">
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
            {/* "Verzendkosten worden bij het afrekenen bepaald" alleen als het
                (nog) niet gratis is — naast "Gratis" was het tegenstrijdig. */}
            {cart.subtotalCents < freeShipCents ? (
              <p className="mt-1 font-sans text-xs text-muted">{t("cart.summary.shippingNote")}</p>
            ) : null}
            <Link href="/afrekenen" className="btn-primary mt-5 w-full">
              {t("cart.summary.checkoutButton")}
            </Link>
            <Link href="/collections/pakken" className="btn-ghost mt-2 w-full">
              {t("cart.summary.continueButton")}
            </Link>
            {/* Zelfde ontdubbeling als op de PDP: veilig betalen staat als badges
                in de checkout, persoonlijk advies in de topbar. */}
            <ul className="mt-5 space-y-1.5">
              {["cart.summary.trust.freeReturn", "pdp.trust_alteration"].map((k) => (
                <li key={k} className="flex items-center gap-2 font-sans text-xs text-ink-soft">
                  <CheckIcon className="h-3.5 w-3.5 shrink-0 text-success" />
                  {t(k)}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>

      {/* Mobiel: sticky afreken-balk — de samenvatting staat onder alle regels,
          dus zonder deze balk is de CTA pas na lang scrollen bereikbaar.
          Verdwijnt zodra de footer in beeld is (die moet aantikbaar blijven). */}
      {footerVisible ? null : (
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-page items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-sans text-xs text-muted">{t("cart.summary.subtotal")}</p>
            <p className="font-display text-base">{formatEuro(cart.subtotalCents)}</p>
          </div>
          <Link href="/afrekenen" className="btn-primary !px-6">
            {t("cart.summary.checkoutButton")}
          </Link>
        </div>
      </div>
      )}
    </div>
  );
}
