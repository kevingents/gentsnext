"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n/locale-provider";

type Branch = { store: string; qty: number; openNow?: boolean; openLabel?: string };

/**
 * "Vandaag afhalen in winkel X". Toont aantal winkels met voorraad voor de
 * gekozen maat; klik = volledige modal met ALLE winkels (voorraad/geen voorraad).
 */
export function ClickAndCollect({ branches }: { branches: Branch[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const available = branches.filter((b) => b.qty > 0);
  if (!available.length) return null;
  const openNow = available.filter((b) => b.openNow).length;
  // Open + op voorraad eerst.
  const sorted = [...branches].sort(
    (a, b) => Number(b.openNow) - Number(a.openNow) || b.qty - a.qty
  );

  return (
    <>
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between border border-line bg-canvas px-4 py-3 text-left font-sans text-sm hover:border-ink"
        >
          <span className="flex items-center gap-2.5">
            {/* Winkel-icoon — visueel duidelijker dan een puntje */}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden className="shrink-0 text-ink">
              <path d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 14h6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="flex flex-col gap-0.5">
              <span className="font-medium text-ink">{t("clickCollect.title")}</span>
              <span className="text-xs text-success">
                ● {t("clickCollect.available")} {available.length} {available.length === 1 ? t("clickCollect.storeSingular") : t("clickCollect.storePlural")}
                {openNow > 0 ? <span className="text-muted"> · {openNow} {t("clickCollect.openNow")}</span> : null}
              </span>
            </span>
          </span>
          <span aria-hidden className="text-muted">→</span>
        </button>
      </div>

      {open && typeof document !== "undefined" ? createPortal(
        <div className="fixed inset-0 z-[60]" role="dialog" aria-label={t("clickCollect.modal.title")} aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="font-display text-lg">{t("clickCollect.modal.title")}</p>
              <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="font-sans text-sm underline">
                {t("common.close")}
              </button>
            </div>
            <p className="border-b border-line bg-surface px-5 py-3 font-sans text-xs text-ink-soft">
              Reservering en ophaal volgt in de checkout-fase. Bel ondertussen direct
              voor zekerheid.
            </p>
            <ul className="flex-1 divide-y divide-line overflow-y-auto">
              {sorted.map((b) => {
                const inStock = b.qty > 0;
                return (
                  <li key={b.store} className="flex items-center justify-between gap-3 px-5 py-3 font-sans text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{b.store}</span>
                      {b.openLabel ? (
                        <span className={`text-xs ${b.openNow ? "text-success" : "text-muted"}`}>{b.openLabel}</span>
                      ) : null}
                    </span>
                    {inStock ? (
                      <span className="shrink-0 text-xs text-success">
                        ● {b.qty > 5 ? t("clickCollect.modal.inStock") : `Nog ${b.qty}`}
                      </span>
                    ) : (
                      <span className="shrink-0 text-xs text-muted">{t("clickCollect.modal.outOfStock")}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="border-t border-line p-5">
              <Link href="/pages/winkels" onClick={() => setOpen(false)} className="btn-ghost w-full">
                Adressen & openingstijden
              </Link>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
