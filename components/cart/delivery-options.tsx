"use client";

import { useEffect, useState } from "react";
import { formatEuro } from "@/lib/pricing";

type Item = { sku: string; qty: number };
type Option = { dateLabel: string; rangeLabel: string; surchargeCents: number };
type Estimate = {
  promise: string;
  note: string | null;
  isSplit: boolean;
  hasStoreSource: boolean;
  standard: Option;
  express: Option;
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
          // Reset toeslag als de keuze niet meer geldig is.
          onChange(value, value === "express" ? d.estimate.express.surchargeCents : 0);
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
    { method: "standard", title: "Standaard", option: est.standard },
    { method: "express", title: "Sneller", option: est.express },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="mb-2 font-sans text-sm font-medium">Bezorging</legend>
      {opts.map(({ method, title, option }) => {
        const active = value === method;
        return (
          <label
            key={method}
            className={`flex cursor-pointer items-start gap-3 border p-4 transition-colors ${active ? "border-ink" : "border-line hover:border-muted"}`}
          >
            <input
              type="radio"
              name="delivery"
              checked={active}
              onChange={() => onChange(method, option.surchargeCents)}
              className="mt-1 accent-ink"
            />
            <span className="flex-1">
              <span className="flex items-center justify-between">
                <span className="font-sans text-sm font-medium">
                  {title} <span className="font-normal text-muted">· {option.rangeLabel}</span>
                </span>
                <span className="font-sans text-sm">
                  {option.surchargeCents > 0 ? `+ ${formatEuro(option.surchargeCents)}` : "Gratis"}
                </span>
              </span>
              <span className="mt-0.5 block font-sans text-xs text-ink-soft">
                Bezorgd <strong>{option.dateLabel}</strong>
              </span>
            </span>
          </label>
        );
      })}
      {est.note ? <p className="font-sans text-xs text-muted">{est.note}</p> : null}
    </fieldset>
  );
}
