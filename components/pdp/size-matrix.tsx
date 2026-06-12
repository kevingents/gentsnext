"use client";

import type { BuySize } from "@/components/pdp/buy-box";
import {
  sizeLayoutFor,
  sizeRowLabel,
  sizeGroup,
  sizeToken,
  rowSortIndex,
  type SizeGroup,
} from "@/lib/size-taxonomy";

type Column = { key: SizeGroup; label: string; sub?: string };

const COLUMNS: Record<string, Column[]> = {
  "regular-long-short": [
    { key: "regular", label: "Regular", sub: "170 – 188 cm" },
    { key: "long", label: "Long", sub: "> 188 cm" },
    { key: "short", label: "Short", sub: "< 170 cm" },
  ],
  "extra-sleeve": [
    { key: "regular", label: "Regular" },
    { key: "long", label: "Mouwlengte 7" },
  ],
};

function Cell({
  cell,
  selected,
  onSelect,
}: {
  cell: BuySize | null;
  selected: string | null;
  onSelect: (size: string) => void;
}) {
  if (!cell) return <span aria-hidden className="block" />;
  const out = cell.known && cell.qty <= 0;
  const low = cell.known && cell.qty > 0 && cell.qty <= 3;
  const on = selected === cell.size;
  return (
    <button
      type="button"
      disabled={out}
      onClick={() => onSelect(cell.size)}
      aria-pressed={on}
      title={out ? "Niet op voorraad" : low ? `Nog ${cell.qty} op voorraad` : undefined}
      className={`relative flex h-12 w-full items-center justify-center border font-sans text-sm transition-colors ${
        out
          ? "cursor-not-allowed border-line text-muted line-through decoration-muted"
          : on
            ? "border-ink bg-ink text-canvas"
            : "border-line text-ink hover:border-ink"
      }`}
    >
      {sizeToken(cell.size)}
      {low ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger" /> : null}
    </button>
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
  const layout = sizeLayoutFor(
    hoofdgroep,
    sizes.map((s) => s.size)
  );

  // Eén kolom (truien/schoenen): platte rij maatknoppen.
  if (layout === "regular-only") {
    const sorted = [...sizes].sort(
      (a, b) => rowSortIndex(sizeRowLabel(a.size)) - rowSortIndex(sizeRowLabel(b.size))
    );
    return (
      <ul className="mt-2 flex flex-wrap gap-2">
        {sorted.map((s) => {
          const out = s.known && s.qty <= 0;
          const low = s.known && s.qty > 0 && s.qty <= 3;
          const on = selected === s.size;
          return (
            <li key={s.size}>
              <button
                type="button"
                disabled={out}
                onClick={() => onSelect(s.size)}
                aria-pressed={on}
                title={out ? "Niet op voorraad" : low ? `Nog ${s.qty} op voorraad` : undefined}
                className={`flex min-w-[3rem] flex-col items-center border px-3 py-2 text-center font-sans text-sm transition-colors ${
                  out
                    ? "cursor-not-allowed border-line text-muted line-through decoration-muted"
                    : on
                      ? "border-ink bg-ink text-canvas"
                      : "border-line text-ink hover:border-ink"
                }`}
              >
                {sizeToken(s.size)}
                {low ? <span className="mt-0.5 text-[0.6rem] text-danger no-underline">nog {s.qty}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  const columns = COLUMNS[layout] ?? COLUMNS["regular-long-short"];

  // Bouw cell-map: rij (lettermaat) → groep → maat.
  const cellMap = new Map<string, Partial<Record<SizeGroup, BuySize>>>();
  for (const s of sizes) {
    const row = sizeRowLabel(s.size);
    const group = sizeGroup(s.size, layout);
    if (!cellMap.has(row)) cellMap.set(row, {});
    cellMap.get(row)![group] = s;
  }
  const rows = [...cellMap.keys()].sort((a, b) => rowSortIndex(a) - rowSortIndex(b));
  const gridCols = `2.5rem repeat(${columns.length}, minmax(0, 1fr))`;

  return (
    <div className="mt-2 overflow-x-auto">
      <div className="min-w-[18rem]">
        {/* Kolomkoppen */}
        <div className="grid items-end gap-2 pb-2" style={{ gridTemplateColumns: gridCols }}>
          <span />
          {columns.map((c) => (
            <div key={c.key} className="text-center">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink">{c.label}</p>
              {c.sub ? <p className="font-sans text-[0.65rem] text-muted">{c.sub}</p> : null}
            </div>
          ))}
        </div>
        {/* Rijen */}
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row} className="grid items-center gap-2" style={{ gridTemplateColumns: gridCols }}>
              <span className="font-sans text-xs font-medium text-muted">{row}</span>
              {columns.map((c) => (
                <Cell key={c.key} cell={cellMap.get(row)?.[c.key] ?? null} selected={selected} onSelect={onSelect} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
