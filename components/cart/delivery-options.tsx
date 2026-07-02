"use client";

import { useEffect, useState } from "react";
import { formatEuro } from "@/lib/pricing";
import { useT } from "@/components/i18n/locale-provider";

type Item = { sku: string; qty: number };
type Option = { dateLabel: string; rangeLabel: string; surchargeCents: number };
type Estimate = {
  promise: string;
  note: string | null;
  isSplit: boolean;
  hasStoreSource: boolean;
  standard: Option;
  express: Option | null;
};

/**
 * Bezorgkeuze op de afrekenpagina: standaard (gratis) of sneller (+toeslag),
 * met live bezorgdatums uit de allocatie-engine en uitleg bij split/winkel.
 */
export function DeliveryOptions({
  items,
  value,
  onChange,
}: {
  items: Item[];
  value: "standard" | "express";
  onChange: (method: "standard" | "express", surchargeCents: number) => void;
}) {
  const t = useT();
  const [est, setEst] = useState<Estimate | null>(null);
  const key = items.map((i) => `${i.sku}:${i.qty}`).join(",");

  useEffect(() => {
    if (!items.length) return;
    let active = true;
    fetch("/api/delivery-estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (active && d?.estimate) {
          setEst(d.estimate);
          // Reset naar standaard als express niet (meer) sneller is.
          const exp = d.estimate.express;
          if (value === "express" && exp) onChange("express", exp.surchargeCents);
          else onChange("standard", 0);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!est) return null;

  const opts: { method: "standard" | "express"; title: string; option: Option }[] = [
    { method: "standard", title: t("delivery.standard"), option: est.standard },
    ...(est.express ? [{ method: "express" as const, title: t("delivery.express"), option: est.express }] : []),
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-sans text-sm font-medium">{t("delivery.label")}</legend>
      {opts.map(({ method, title, option }) => {
        const active = value === method;
        return (
          <label
            key={method}
            className={`flex cursor-pointer items-center gap-3 border px-3 py-2.5 transition-colors ${active ? "border-ink" : "border-line hover:border-muted"}`}
          >
            <input
              type="radio"
              name="delivery"
              checked={active}
              onChange={() => onChange(method, option.surchargeCents)}
              className="accent-ink"
            />
            {/* Icoon: vrachtwagen (standaard) of bliksem (sneller) */}
            <span aria-hidden className="shrink-0 text-ink">
              {method === "express" ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
                  <path d="M13 2 5 13h5l-1 9 9-12h-5z" />
                </svg>
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6.5h11v9H3zM14 9.5h3.6L21 13v2.5h-7z" />
                  <circle cx="7" cy="17.5" r="1.6" />
                  <circle cx="17.5" cy="17.5" r="1.6" />
                </svg>
              )}
            </span>
            {/* Eén heldere belofte: titel + concrete bezorgdag (geen dubbele range meer) */}
            <span className="flex flex-1 items-center justify-between gap-2">
              <span className="font-sans text-sm leading-tight">
                <span className="font-medium">{title}</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  {t("delivery.deliveredOn")} <strong className="text-ink">{option.dateLabel}</strong>
                </span>
              </span>
              <span className="shrink-0 font-sans text-sm font-medium">
                {option.surchargeCents > 0 ? `+ ${formatEuro(option.surchargeCents)}` : t("checkout.free")}
              </span>
            </span>
          </label>
        );
      })}
      {est.note ? <p className="font-sans text-xs text-muted">{est.note}</p> : null}
    </fieldset>
  );
}
