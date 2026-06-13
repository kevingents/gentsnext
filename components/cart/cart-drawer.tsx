"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart, type CartLine } from "@/components/cart/cart-context";
import { DeliveryEstimate } from "@/components/cart/delivery-estimate";
import { useT } from "@/components/i18n/locale-provider";
import { formatEuro } from "@/lib/pricing";

type Suggestion = { id: string; handle: string; title: string; imageUrl: string; minPriceCents: number };

function CartSuggestions({ hoofdgroepen, onNavigate }: { hoofdgroepen: string[]; onNavigate: () => void }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const key = hoofdgroepen.join(",");

  useEffect(() => {
    if (!key) return;
    let active = true;
    fetch(`/api/cart-suggestions?hg=${encodeURIComponent(key)}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (active) setItems((d.items || []).slice(0, 3));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [key]);

  if (!items.length) return null;
  return (
    <div className="border-t border-line px-5 py-4">
      <p className="label-brand mb-3">Maak je outfit af</p>
      <ul className="space-y-3">
        {items.map((s) => (
          <li key={s.id}>
            <Link href={`/products/${s.handle}`} onClick={onNavigate} className="flex items-center gap-3 group">
              <div className="relative h-14 w-11 shrink-0 overflow-hidden rounded-card bg-surface">
                {s.imageUrl ? <Image src={s.imageUrl} alt={s.title} fill sizes="44px" className="object-cover" /> : null}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-sans text-sm text-ink group-hover:underline">{s.title}</p>
                <p className="font-sans text-xs text-muted">{formatEuro(s.minPriceCents)}</p>
              </div>
              <span aria-hidden className="text-muted">+</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const FREE_SHIPPING_CENTS = 7500; // €50 — instelbaar; gratis verzending-drempel

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

  useEffect(() => {
    document.body.style.overflow = cart.isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [cart.isOpen]);

  if (!cart.isOpen) return null;

  const remaining = Math.max(0, FREE_SHIPPING_CENTS - cart.subtotalCents);
  const pct = Math.min(100, Math.round((cart.subtotalCents / FREE_SHIPPING_CENTS) * 100));
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
    <div className="fixed inset-0 z-[60]" role="dialog" aria-label="Winkelwagen" aria-modal="true">
      <div className="absolute inset-0 animate-[fadeIn_.25s_ease] bg-ink/40" onClick={cart.close} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer animate-[slideInRight_.32s_cubic-bezier(.16,1,.3,1)]">
        {/* Kop */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <p className="font-display text-lg">{t("cart.title")} ({cart.count})</p>
          <button type="button" onClick={cart.close} aria-label="Sluiten" className="font-sans text-sm underline">
            Sluiten
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
              Ontdek onze pakken, overhemden en accessoires — of bekijk je{" "}
              <Link href="/favorieten" onClick={cart.close} className="text-ink underline underline-offset-4">
                favorieten
              </Link>
              .
            </p>
            <Link href="/collections/pakken" onClick={cart.close} className="btn-primary mt-2">
              Begin met shoppen
            </Link>
          </div>
        ) : (
          <>
            {/* Gratis verzending-balk + levertijdcue */}
            <div className="border-b border-line px-5 py-3">
              {remaining > 0 ? (
                <p className="font-sans text-xs text-ink-soft">
                  Nog <strong>{formatEuro(remaining)}</strong> tot gratis verzending
                </p>
              ) : (
                <p className="font-sans text-xs text-success">✓ Je komt in aanmerking voor gratis verzending</p>
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
                <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" /><circle cx="12" cy="12" r="9" /></svg>
                <p className="font-sans text-xs text-ink-soft">
                  <span className="font-medium text-ink">Slimme keuze.</span> Meerdere maten van hetzelfde artikel — houd de beste en retourneer de rest <strong>gratis</strong> binnen 14 dagen.
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
                        <p className="label-brand">{g.groupLabel ?? "Pak"}</p>
                        <button
                          type="button"
                          onClick={() => cart.removeGroup(g.groupId!)}
                          className="font-sans text-xs text-muted underline hover:text-ink"
                        >
                          Verwijder pak
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

            {/* Bijverkoop */}
            <CartSuggestions
              hoofdgroepen={[...new Set(cart.lines.map((l) => l.hoofdgroep).filter(Boolean) as string[])]}
              onNavigate={cart.close}
            />

            {/* Voettekst */}
            <div className="border-t border-line px-5 py-4">
              <div className="flex items-center justify-between">
                <span className="font-sans text-sm text-muted">{t("cart.subtotal")}</span>
                <span className="font-display text-lg">{formatEuro(cart.subtotalCents)}</span>
              </div>
              <p className="mt-1 font-sans text-xs text-muted">Incl. btw, excl. verzendkosten</p>
              <Link href="/afrekenen" onClick={cart.close} className="btn-primary mt-3 w-full">
                {t("cart.checkout")}
              </Link>
              <Link href="/winkelwagen" onClick={cart.close} className="btn-ghost mt-2 w-full">
                Bekijk winkelwagen
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function CartLineRow({ line, grouped }: { line: CartLine; grouped: boolean }) {
  const cart = useCart();
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
              {[line.color, line.size && `maat ${line.size}`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <p className="shrink-0 font-sans text-sm">{formatEuro(line.priceCents * line.qty)}</p>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="flex items-center border border-line">
            <button
              type="button"
              onClick={() => cart.setQty(line.id, line.qty - 1)}
              aria-label="Minder"
              className="px-2.5 py-1 font-sans text-sm hover:bg-surface"
            >
              −
            </button>
            <span className="min-w-[1.5rem] text-center font-sans text-sm">{line.qty}</span>
            <button
              type="button"
              onClick={() => cart.setQty(line.id, line.qty + 1)}
              aria-label="Meer"
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
              Verwijder
            </button>
          ) : null}
        </div>
      </div>
    </li>
  );
}
