"use client";

import { useState } from "react";
import type { BuySize } from "@/components/pdp/buy-box";
import {
  sizeLayoutFor,
  sizeRowLabel,
  sizeGroup,
  sizeToken,
  rowSortIndex,
  type SizeGroup,
} from "@/lib/size-taxonomy";
import { useT } from "@/components/i18n/locale-provider";

type Column = { key: SizeGroup; label: string; sub?: string };

const COLUMNS: Record<string, Column[]> = {
  "regular-long-short": [
    { key: "regular", label: "Regular", sub: "170 – 188 cm" },
    { key: "long", label: "Long", sub: "> 188 cm" },
    { key: "short", label: "Short", sub: "< 170 cm" },
  ],
  "extra-sleeve": [
    { key: "regular", label: "Regular" },
    { key: "long", label: "Mouwlengte 7", sub: "+5–6 cm mouw" },
  ],
};

/** Belletje op uitverkochte maten — signaleert dat je je kunt laten tippen zodra 'ie terug is. */
function BellIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function SizeMatrix({
  sizes,
  hoofdgroep,
  selected,
  onSelect,
}: {
  sizes: BuySize[];
  hoofdgroep: string;
  selected: string | null;
  onSelect: (size: string) => void;
}) {
  const t = useT();
  const soldOutHint = t("pdp.size.soldoutHint");
  // Uitverkochte maten WÉL tonen (doorgestreept + klikbaar): zo kan de klant zich
  // per maat aanmelden voor een terug-op-voorraad-tip. Alleen als er geen énkele
  // maat bekend is, is er niets te tonen.
  const live = sizes;
  if (!live.length) {
    return <p className="mt-2 font-sans text-sm text-muted">{t("pdp.size.soldout")}</p>;
  }

  const layout = sizeLayoutFor(hoofdgroep, live.map((s) => s.size));

  // Platte, horizontale rij maatknoppen. `display` bepaalt de knoptekst —
  // onder de "Mouwlengte 7"-tab tonen we de kale lettermaat (S i.p.v. S7):
  // de tab zegt de mouwlengte al, dubbel labelen was verwarrend.
  const flatRow = (list: BuySize[], display: (size: string) => string = sizeToken) => {
    const num = (s: string) => parseInt(sizeToken(s), 10);
    const allNumeric = list.every((s) => !Number.isNaN(num(s.size)));
    const sorted = [...list].sort((a, b) =>
      allNumeric
        ? num(a.size) - num(b.size)
        : rowSortIndex(sizeRowLabel(a.size)) - rowSortIndex(sizeRowLabel(b.size))
    );
    // Rustig, uniform grid — zelfde beeldtaal als de pakken-matrix: doorgestreept
    // + klein belletje voor uitverkocht (geen "Uitverkocht"-woord per tegel; de
    // hint-regel eronder legt het belletje uit), rood puntje voor bijna-op.
    return (
      <ul className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
        {sorted.map((s) => {
          const out = s.known && s.qty <= 0;
          const low = !out && s.known && s.qty > 0 && s.qty <= 3;
          const on = selected === s.size;
          return (
            <li key={s.size}>
              <button
                type="button"
                onClick={() => onSelect(s.size)}
                aria-pressed={on}
                aria-label={out ? `${display(s.size)} — ${soldOutHint}` : undefined}
                title={out ? soldOutHint : low ? `Nog ${s.qty} op voorraad` : undefined}
                className={`relative flex h-11 w-full items-center justify-center border font-sans text-sm transition-colors ${
                  on
                    ? out
                      ? "border-ink text-ink ring-1 ring-ink"
                      : "border-ink bg-ink text-canvas"
                    : out
                      ? "border-line/70 text-muted hover:border-ink"
                      : "border-line text-ink hover:border-ink"
                }`}
              >
                <span className={out ? "line-through decoration-muted" : undefined}>{display(s.size)}</span>
                {out ? (
                  <BellIcon className="absolute right-0.5 top-0.5 h-2.5 w-2.5 text-ink-soft" />
                ) : low ? (
                  <span aria-hidden className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger" />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    );
  };

  // Eén kolom (truien/schoenen/accessoires): platte rij.
  if (layout === "regular-only") return flatRow(live);

  const allColumns = COLUMNS[layout] ?? COLUMNS["regular-long-short"];
  // Alleen groepen waar deze kleur daadwerkelijk maten in heeft.
  const columns = allColumns.filter((c) => live.some((s) => sizeGroup(s.size, layout) === c.key));

  // Geen tweede dimensie (bv. geen mouwlengte) → gewoon horizontaal.
  if (columns.length <= 1) return flatRow(live);

  return <GroupedSizes live={live} layout={layout} columns={columns} selected={selected} flatRow={flatRow} />;
}

/**
 * Twee-staps-kiezer: eerst pasvorm/mouwlengte (segmented control), dan één
 * platte rij maten. Verving de rij×kolom-matrix — daar stond de maat dubbel
 * (rijlabel "S" + celtekst "S") en oogde de lege-cellen-grid rommelig.
 */
function GroupedSizes({
  live,
  layout,
  columns,
  selected,
  flatRow,
}: {
  live: BuySize[];
  layout: ReturnType<typeof sizeLayoutFor>;
  columns: Column[];
  selected: string | null;
  flatRow: (list: BuySize[], display?: (size: string) => string) => React.ReactNode;
}) {
  const byGroup = new Map<SizeGroup, BuySize[]>();
  for (const s of live) {
    const g = sizeGroup(s.size, layout);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g)!.push(s);
  }
  // Starttab: de groep van de gekozen maat, anders de eerste groep mét voorraad.
  const initial =
    (selected ? sizeGroup(selected, layout) : null) ??
    columns.find((c) => (byGroup.get(c.key) ?? []).some((s) => !s.known || s.qty > 0))?.key ??
    columns[0].key;
  const [tab, setTab] = useState<SizeGroup>(initial);
  const activeCol = columns.find((c) => c.key === tab) ?? columns[0];
  const list = byGroup.get(activeCol.key) ?? [];
  // Onder de mouwlengte-tab de kale lettermaat tonen (S i.p.v. S7) — de tab
  // benoemt de mouwlengte al. Bij Regular/Long/Short blijft het échte
  // confectienummer staan (48 vs 98 zijn verschillende maten voor de klant).
  const display = layout === "extra-sleeve" && activeCol.key === "long" ? sizeRowLabel : sizeToken;

  return (
    <div className="mt-2">
      <div className="flex gap-1.5" role="tablist" aria-label="Pasvorm">
        {columns.map((c) => {
          const on = c.key === tab;
          return (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setTab(c.key)}
              className={`flex-1 border px-3 py-2 text-center font-sans transition-colors ${
                on ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink"
              }`}
            >
              <span className="block text-sm">{c.label}</span>
              {c.sub ? <span className={`block text-[0.65rem] ${on ? "text-canvas/75" : "text-muted"}`}>{c.sub}</span> : null}
            </button>
          );
        })}
      </div>
      {flatRow(list, display)}
    </div>
  );
}
