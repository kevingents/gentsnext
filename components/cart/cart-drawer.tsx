"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCart, type CartLine } from "@/components/cart/cart-context";
import { DeliveryEstimate } from "@/components/cart/delivery-estimate";
import { CartSuggestions } from "@/components/cart/cart-suggestions";
import { useT } from "@/components/i18n/locale-provider";
import { formatEuro } from "@/lib/pricing";

// Fallback; de echte, instelbare drempel komt uit /api/promo (freeShippingCents).
const FREE_SHIPPING_FALLBACK = 7500;

type Group = { groupId?: string; groupLabel?: string; lines: CartLine[] };

function groupLines(lines: CartLine[]): Group[] {
  const groups: Group[] = [];
  const byId = new Map<string, Group>();
  for (const line of lines) {
    if (line.groupId) {
      let g = byId.get(line.groupId);
      if (!g) {
        g = { groupId: line.groupId, groupLabel: line.groupLabel, lines: [] };
        byId.set(line.groupId, g);
        groups.push(g);
      }
      g.lines.push(line);
    } else {
      groups.push({ lines: [line] });
    }
  }
  return groups;
}

export function CartDrawer() {
  const cart = useCart();
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(cart.close);
  closeRef.current = cart.close;

  // Instelbare gratis-verzending-drempel (loopt mee met de settings; checkout blijft autoritatief).
  const [freeShipCents, setFreeShipCents] = useState(FREE_SHIPPING_FALLBACK);
  useEffect(() => {
    let active = true;
    fetch("/api/promo")
      .then((r) => r.json())
      .then((d) => { if (active && Number(d?.freeShippingCents) > 0) setFreeShipCents(Number(d.freeShippingCents)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Toegankelijkheid: scroll-lock + Esc-sluiten + focus-trap + focus-terugkeer.
  useEffect(() => {
    if (!cart.isOpen) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'
            )
          )
        : [];
    focusables()[0]?.focus();
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === "Tab") {
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prevFocus?.focus?.();
    };
  }, [cart.isOpen]);

  if (!cart.isOpen) return null;

  const remaining = Math.max(0, freeShipCents - cart.subtotalCents);
  const pct = Math.min(100, Math.round((cart.subtotalCents / freeShipCents) * 100));
  const groups = groupLines(cart.lines);

  // Slim: meerdere maten van hetzelfde artikel → moedig "houd de beste, retour de rest" aan.
  const sizesByHandle = new Map<string, Set<string>>();
  for (const l of cart.lines) {
    if (!l.size) continue;
    const set = sizesByHandle.get(l.productHandle) ?? new Set<string>();
    set.add(l.size);
    sizesByHandle.set(l.productHandle, set);
  }
  const multiSize = [...sizesByHandle.values()].some((s) => s.size >= 2);

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label={t("cart.arialabel")} aria-modal="true">
      <div className="absolute inset-0 animate-[fadeIn_.25s_ease] bg-ink/40" onClick={cart.close} />
      <div ref={panelRef} className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-canvas shadow-drawer animate-[slideInRight_.32s_cubic-bezier(.16,1,.3,1)]">
        {/* Kop */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <p className="font-display text-lg">{t("cart.title")} ({cart.count})</p>
          <button type="button" onClick={cart.close} aria-label={t("common.close")} className="font-sans text-sm underline">
            {t("common.close")}
          </button>
        </div>

        {cart.lines.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className="text-muted" aria-hidden>
              <path d="M3 6h2l3 12h10l3-9H7" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="9" cy="20" r="1.5" />
              <circle cx="17" cy="20" r="1.5" />
            </svg>
            <p className="font-display text-xl font-light">{t("cart.empty")}</p>
            <p className="font-sans text-sm text-muted">
              {t("cart.drawer.emptyIntro")}{" "}
              <Link href="/favorieten" onClick={cart.close} className="text-ink underline underline-offset-4">
                {t("cart.drawer.emptyIntroFavorites")}
              </Link>
              .
            </p>
            <Link href="/collections/pakken" onClick={cart.close} className="btn-primary mt-2">
              {t("cart.empty.shopButton")}
            </Link>
          </div>
        ) : (
          <>
            {/* Gratis verzending-balk + levertijdcue */}
            <div className="border-b border-line px-5 py-3">
              {remaining > 0 ? (
                <p className="font-sans text-xs text-ink-soft">
                  {t("cart.shipping.remaining")} <strong>{formatEuro(remaining)}</strong> {t("cart.shipping.untilFree")}
                </p>
              ) : (
                <p className="flex items-center gap-1.5 font-sans text-xs text-success">
                  <svg aria-hidden viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  {t("cart.freeShipping")}
                </p>
              )}
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-surface">
                <div className="h-full bg-ink transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
              <DeliveryEstimate
                items={cart.lines.map((l) => ({ sku: l.sku, qty: l.qty }))}
                className="mt-2 font-sans text-[0.65rem] text-muted"
              />
            </div>

            {multiSize ? (
              <div className="flex items-start gap-2 border-b border-line bg-surface px-5 py-2.5">
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8h18v8H3zM7 8v3M11 8v5M15 8v3M19 8v5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <p className="font-sans text-xs text-ink-soft">
                  {t("cart.warning.multiSize")}{" "}
                  <Link href="/maatadvies" onClick={cart.close} className="font-medium text-ink underline underline-offset-2">{t("cart.warning.sizeAdviceLink")}</Link>{" "}
                  {t("cart.warning.multiSizeHelp")}
                </p>
              </div>
            ) : null}

            {/* Regels */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <ul className="space-y-5">
                {groups.map((g, gi) => (
                  <li key={g.groupId ?? g.lines[0].id} className={g.groupId ? "border border-line p-3" : ""}>
                    {g.groupId ? (
                      <div className="mb-2 flex items-center justify-between">
                        <p className="label-brand">{g.groupLabel ?? t("cart.group.fallback")}</p>
                        <button
                          type="button"
                          onClick={() => cart.removeGroup(g.groupId!)}
                          className="font-sans text-xs text-muted underline hover:text-ink"
                        >
                          {t("cart.action.removeGroup")}
                        </button>
                      </div>
                    ) : null}
                    <ul className={g.groupId ? "space-y-3" : ""}>
                      {g.lines.map((line) => (
                        <CartLineRow key={line.id} line={line} grouped={Boolean(g.groupId)} />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>

            {/* Vaak samen gekocht */}
            <CartSuggestions
              hoofdgroepen={[...new Set(cart.lines.map((l) => l.hoofdgroep).filter(Boolean) as string[])]}
              excludeHandles={[...new Set(cart.lines.map((l) => l.productHandle))]}
              onNavigate={cart.close}
            />

            {/* Voettekst */}
            <div className="border-t border-line px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="font-sans text-sm text-muted">{t("cart.subtotal")}</span>
                <span className="font-display text-lg">{formatEuro(cart.subtotalCents)}</span>
              </div>
              <p className="mt-1 font-sans text-xs text-muted">{t("cart.taxnote")}</p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={cart.close} className="btn-ghost w-full !px-2 text-sm">
                  {t("cart.action.continueShopping")}
                </button>
                <Link href="/afrekenen" onClick={cart.close} className="btn-primary w-full text-center !px-2 text-sm">
                  {t("cart.checkout")}
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CartLineRow({ line, grouped }: { line: CartLine; grouped: boolean }) {
  const cart = useCart();
  const t = useT();
  return (
    <li className="flex gap-3">
      <Link href={`/products/${line.productHandle}`} onClick={cart.close} className="shrink-0">
        <div className="relative h-20 w-16 overflow-hidden rounded-card bg-surface">
          {line.imageUrl ? <Image src={line.imageUrl} alt={line.title} fill sizes="64px" className="object-cover" /> : null}
        </div>
      </Link>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {line.roleLabel ? <p className="font-sans text-[0.65rem] uppercase tracking-wide text-muted">{line.roleLabel}</p> : null}
            <p className="truncate font-sans text-sm text-ink">{line.title}</p>
            <p className="font-sans text-xs text-muted">
              {[line.color, line.size && t("cart.added.sizeMeta", { size: line.size })].filter(Boolean).join(" · ")}
            </p>
          </div>
          <p className="shrink-0 font-sans text-sm">{formatEuro(line.priceCents * line.qty)}</p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center border border-line">
            <button
              type="button"
              onClick={() => cart.setQty(line.id, line.qty - 1)}
              aria-label={t("cart.line.decrementAriaLabel")}
              className="px-2.5 py-1 font-sans text-sm hover:bg-surface"
            >
              −
            </button>
            <span className="min-w-[1.5rem] text-center font-sans text-sm">{line.qty}</span>
            <button
              type="button"
              onClick={() => cart.setQty(line.id, line.qty + 1)}
              aria-label={t("cart.line.incrementAriaLabel")}
              className="px-2.5 py-1 font-sans text-sm hover:bg-surface"
            >
              +
            </button>
          </div>
          {!grouped ? (
            <button
              type="button"
              onClick={() => cart.remove(line.id)}
              className="font-sans text-xs text-muted underline hover:text-ink"
            >
              {t("cart.line.remove")}
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
