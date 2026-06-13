"use client";

import Link from "next/link";
import { useState } from "react";

type Branch = { store: string; qty: number };

/**
 * "Vandaag afhalen in winkel X". Toont aantal winkels met voorraad voor de
 * gekozen maat; klik = uitklap-lijst (max 6 winkels).
 */
export function ClickAndCollect({ branches }: { branches: Branch[] }) {
  const [open, setOpen] = useState(false);
  const available = branches.filter((b) => b.qty > 0);
  if (!available.length) return null;
  const top = available.slice(0, 6);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between border border-line bg-canvas px-4 py-2.5 text-left font-sans text-sm hover:border-ink"
      >
        <span>
          <span className="text-success">●</span>{" "}
          <span className="font-medium">Vandaag afhalen</span>{" "}
          <span className="text-muted">in {available.length} {available.length === 1 ? "winkel" : "winkels"}</span>
        </span>
        <span aria-hidden className="text-muted">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <ul className="mt-2 border-x border-b border-line bg-canvas">
          {top.map((b) => (
            <li key={b.store} className="flex items-center justify-between border-t border-line px-4 py-2 font-sans text-sm">
              <span className="text-ink-soft">{b.store}</span>
              <span className="text-xs text-success">●  voorraad</span>
            </li>
          ))}
          <li className="border-t border-line px-4 py-2 text-right">
            <Link href="/pages/winkels" className="font-sans text-xs text-ink underline underline-offset-4">
              Alle winkels →
            </Link>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
