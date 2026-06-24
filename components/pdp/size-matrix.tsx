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
  const low = cell.known && cell.qty > 0 && cell.qty <= 3;
  const on = selected === cell.size;
  return (
    <button
      type="button"
      onClick={() => onSelect(cell.size)}
      aria-pressed={on}
      title={low ? `Nog ${cell.qty} op voorraad` : undefined}
      className={`relative flex h-10 w-full items-center justify-center border font-sans text-sm transition-colors ${
        on ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink"
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
  const t = useT();
  // Uitverkochte maten niet tonen (i.p.v. doorstrepen).
  const live = sizes.filter((s) => !(s.known && s.qty <= 0));
  if (!live.length) {
    return <p className="mt-2 font-sans text-sm text-muted">{t("pdp.size.soldout")}</p>;
  }

  const layout = sizeLayoutFor(hoofdgroep, live.map((s) => s.size));

  // Platte, horizontale rij maatknoppen.
  const flatRow = (list: BuySize[]) => {
    const num = (s: string) => parseInt(sizeToken(s), 10);
    const allNumeric = list.every((s) => !Number.isNaN(num(s.size)));
    const sorted = [...list].sort((a, b) =>
      allNumeric
        ? num(a.size) - num(b.size)
        : rowSortIndex(sizeRowLabel(a.size)) - rowSortIndex(sizeRowLabel(b.size))
    );
    return (
      <ul className="mt-2 flex flex-wrap gap-2">
        {sorted.map((s) => {
          const low = s.known && s.qty > 0 && s.qty <= 3;
          const on = selected === s.size;
          return (
            <li key={s.size}>
              <button
                type="button"
                onClick={() => onSelect(s.size)}
                aria-pressed={on}
                title={low ? `Nog ${s.qty} op voorraad` : undefined}
                className={`flex min-w-[3rem] flex-col items-center border px-3 py-2 text-center font-sans text-sm transition-colors ${
                  on ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink"
                }`}
              >
                {sizeToken(s.size)}
                {low ? <span className="mt-0.5 text-[0.6rem] text-danger">nog {s.qty}</span> : null}
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
  // Alleen kolommen die ná het weghalen van uitverkocht nog maten hebben.
  const columns = allColumns.filter((c) => live.some((s) => sizeGroup(s.size, layout) === c.key));

  // Geen tweede dimensie (bv. geen mouwlengte) → gewoon horizontaal.
  if (columns.length <= 1) return flatRow(live);

  // Cell-map: rij (lettermaat) → groep → maat.
  const cellMap = new Map<string, Partial<Record<SizeGroup, BuySize>>>();
  for (const s of live) {
    const row = sizeRowLabel(s.size);
    const group = sizeGroup(s.size, layout);
    if (!cellMap.has(row)) cellMap.set(row, {});
    cellMap.get(row)![group] = s;
  }
  const rows = [...cellMap.keys()].sort((a, b) => rowSortIndex(a) - rowSortIndex(b));
  const gridCols = `1.75rem repeat(${columns.length}, minmax(0, 1fr))`;

  return (
    <div className="mt-2 overflow-x-auto">
      <div className="min-w-[16rem]">
        <div className="grid items-end gap-1.5 pb-2" style={{ gridTemplateColumns: gridCols }}>
          <span />
          {columns.map((c) => (
            <div key={c.key} className="text-center">
              <p className="font-sans text-xs font-semibold uppercase tracking-wide text-ink">{c.label}</p>
              {c.sub ? <p className="font-sans text-[0.65rem] text-muted">{c.sub}</p> : null}
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          {rows.map((row) => (
            <div key={row} className="grid items-center gap-1.5" style={{ gridTemplateColumns: gridCols }}>
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
