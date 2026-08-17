"use client";

import { useState } from "react";
import type { BuySize } from "@/components/pdp/buy-box";
import {
  sizeLayoutFor,
  sizeRowLabel,
  sizeSleeveBase,
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

/** Envelop op uitverkochte maten — klik = mail me zodra deze maat terug is. */
function MailIcon({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
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
  // Het aantal kolommen volgt uit het aantal maten (zie kolommenVoor onderaan).
  const flatRow = (list: BuySize[], display: (size: string) => string = sizeToken) => {
    const num = (s: string) => parseInt(sizeToken(s), 10);
    const allNumeric = list.every((s) => !Number.isNaN(num(s.size)));
    const sorted = [...list].sort((a, b) =>
      allNumeric
        ? num(a.size) - num(b.size)
        : rowSortIndex(sizeRowLabel(a.size, hoofdgroep)) - rowSortIndex(sizeRowLabel(b.size, hoofdgroep))
    );
    // Rustig, uniform grid. Een uitverkochte maat moet zichzelf uitleggen — er
    // staat geen hintregel meer onder de kiezer: grijze vulling, gestippelde rand,
    // diagonale streep én doorgestreepte maat, met een envelopje dat zegt dat je
    // je kunt laten mailen. Rood puntje = bijna op.
    return (
      <ul
        className="mt-2 grid gap-2 [grid-template-columns:repeat(var(--maat-kolommen-m),minmax(0,1fr))] sm:[grid-template-columns:repeat(var(--maat-kolommen),minmax(0,1fr))]"
        style={
          {
            "--maat-kolommen-m": kolommenVoor(sorted.length, 5),
            "--maat-kolommen": kolommenVoor(sorted.length, 8),
          } as React.CSSProperties
        }
      >
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
                className={`relative flex h-11 w-full items-center justify-center overflow-hidden border font-sans text-sm transition-colors ${
                  on
                    ? out
                      ? "border-dashed border-ink bg-surface text-ink ring-1 ring-ink"
                      : "border-ink bg-ink text-canvas"
                    : out
                      ? "border-dashed border-line bg-surface text-muted hover:border-ink hover:text-ink"
                      : "border-line text-ink hover:border-ink"
                }`}
              >
                {/* Diagonaal door de hele tegel: op één oogopslag "kan niet". */}
                {out ? (
                  <svg
                    aria-hidden
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 h-full w-full text-muted/40"
                  >
                    <line x1="0" y1="100" x2="100" y2="0" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                  </svg>
                ) : null}
                <span className={out ? "relative line-through decoration-muted" : undefined}>{display(s.size)}</span>
                {out ? (
                  <MailIcon className="absolute bottom-0.5 right-0.5 h-3 w-3 text-ink-soft" />
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
  const display = layout === "extra-sleeve" && activeCol.key === "long" ? sizeSleeveBase : sizeToken;

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

/**
 * Hoeveel maatknoppen naast elkaar. Vast aantal kolommen liet bij 7 maten één
 * knop verweesd op een tweede regel achter ("S M L XL XXL 3XL" + "4XL"), wat
 * zowel rommelig oogt als onnodig hoog is.
 *
 * Passen alle maten binnen `max`, dan komen ze op één regel. Zo niet, dan
 * verdelen we ze gelijk over het minimale aantal regels — 12 maten worden 6+6,
 * niet 8+4. `max` verschilt per scherm (mobiel smaller) zodat een knop nooit te
 * klein wordt om te raken.
 */
function kolommenVoor(aantal: number, max: number): number {
  if (aantal <= 1) return 1;
  if (aantal <= max) return aantal;
  return Math.ceil(aantal / Math.ceil(aantal / max));
}
