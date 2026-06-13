"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SuitDetail, SuitPieceDetail, SuitRole } from "@/lib/suit-pairing";
import { formatEuro } from "@/lib/pricing";
import { rowSortIndex, rowDisplayLabel } from "@/lib/size-taxonomy";
import { useCart } from "@/components/cart/cart-context";
import { parseComposition, parseCare, careProse } from "@/lib/care";
import { MaterialBlock, CareBlock } from "@/components/pdp/care-material";
import { Accordion } from "@/components/pdp/accordion";

const ROLE_LABEL: Record<SuitRole, string> = {
  colbert: "Colbert",
  broek: "Pantalon",
  gilet: "Gilet",
};

const ROLE_HG: Record<SuitRole, string> = {
  colbert: "Colberts",
  broek: "Broeken",
  gilet: "Gilets",
};

/** Per maat-bucket de (eerst beschikbare) variant van een onderdeel. */
function sizeIndex(piece: SuitPieceDetail) {
  const map = new Map<string, SuitPieceDetail["sizes"][number]>();
  for (const s of piece.sizes) {
    const cur = map.get(s.sizeLabel);
    // Voorkeur: in-voorraad variant wint.
    if (!cur || (s.known && s.qty > 0 && !(cur.known && cur.qty > 0))) map.set(s.sizeLabel, s);
  }
  return map;
}

export function SuitBuilder({ suit }: { suit: SuitDetail }) {
  const cart = useCart();
  const colbert = suit.pieces.find((p) => p.role === "colbert")!;
  const broek = suit.pieces.find((p) => p.role === "broek")!;
  const gilet = suit.pieces.find((p) => p.role === "gilet") ?? null;

  const pakTitle = colbert.title.replace(/^colbert[\s-]*/i, "").trim() || colbert.title;
  const [withGilet, setWithGilet] = useState(false);
  // Maat PER ONDERDEEL — de USP: je kunt bv. een groter colbert (lange armen) met
  // een kleinere pantalon (korte benen) combineren.
  const [sizes, setSizes] = useState<Partial<Record<SuitRole, string>>>({});

  const activePieces = useMemo(
    () => [colbert, broek, ...(withGilet && gilet ? [gilet] : [])],
    [colbert, broek, gilet, withGilet]
  );

  const indices = useMemo(() => activePieces.map((p) => sizeIndex(p)), [activePieces]);
  const pieceSizes = useMemo(
    () => indices.map((m) => [...m.keys()].sort((a, b) => rowSortIndex(a) - rowSortIndex(b))),
    [indices]
  );

  // Bij het kiezen van een maat: vul nog-niet-gekozen onderdelen met dezelfde maat
  // als die bestaat (snel "zelfde maat", maar elk onderdeel blijft los aanpasbaar).
  function pickSize(role: SuitRole, label: string) {
    setSizes((prev) => {
      const next: Partial<Record<SuitRole, string>> = { ...prev, [role]: label };
      activePieces.forEach((p, i) => {
        if (next[p.role] != null) return;
        const v = indices[i].get(label);
        if (v && !(v.known && v.qty <= 0)) next[p.role] = label; // alleen een leverbare maat auto-invullen
      });
      return next;
    });
  }

  // Gilet erbij → vul 'm met de colbert-maat als die bestaat.
  useEffect(() => {
    if (!withGilet || !gilet) return;
    const gi = activePieces.findIndex((p) => p.role === "gilet");
    if (gi >= 0 && !sizes.gilet && sizes.colbert && indices[gi]?.has(sizes.colbert)) {
      setSizes((prev) => ({ ...prev, gilet: sizes.colbert }));
    }
  }, [withGilet, gilet, activePieces, indices, sizes.colbert, sizes.gilet]);

  const selection = useMemo(
    () => activePieces.map((p, i) => ({ piece: p, variant: sizes[p.role] ? indices[i].get(sizes[p.role]!) ?? null : null })),
    [activePieces, indices, sizes]
  );
  const allChosen = activePieces.every((p) => sizes[p.role]);
  const totalCents = useMemo(() => selection.reduce((sum, s) => sum + (s.variant?.priceCents ?? 0), 0), [selection]);

  const baseFrom = useMemo(
    () => activePieces.reduce((sum, p) => sum + Math.min(...p.sizes.map((s) => s.priceCents)), 0),
    [activePieces]
  );

  // Niet toevoegbaar als een gekozen onderdeel uitverkocht is.
  const canAdd = allChosen && selection.every((s) => s.variant && !(s.variant.known && (s.variant.qty ?? 0) <= 0));

  // Materiaal / onderhoud / pasvorm-details van het pak (uit het colbert).
  const attrs = (suit.attributes ?? {}) as Record<string, unknown>;
  const composition = parseComposition(String(attrs.samenstelling_materiaal ?? attrs.samenstelling ?? ""));
  const careItems = parseCare(String(attrs.wasvoorschrift ?? ""), attrs);
  const careProseLines = careProse(String(attrs.wasvoorschrift ?? ""));
  const materiaal = String(attrs.materiaal ?? "").trim();
  const specRows = ([["merk", "Merk"], ["pasvorm", "Pasvorm"], ["sluiting", "Sluiting"], ["boord", "Boord"], ["zakken", "Zakken"], ["seizoen", "Seizoen"]] as const)
    .map(([k, l]) => ({ label: l, value: String(attrs[k] ?? "").trim() }))
    .filter((s) => s.value);
  const detailItems = [
    ...(composition.length || materiaal ? [{ title: "Materiaal", content: <MaterialBlock composition={composition} fallback={materiaal} /> }] : []),
    ...(careItems.length ? [{ title: "Onderhoud", content: <CareBlock items={careItems} prose={careProseLines} /> }] : []),
    ...(specRows.length
      ? [{
          title: "Pasvorm & details",
          content: (
            <dl className="divide-y divide-line border-y border-line">
              {specRows.map((s) => (
                <div key={s.label} className="flex justify-between gap-4 py-2.5 font-sans text-sm">
                  <dt className="text-muted">{s.label}</dt>
                  <dd className="text-right text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          ),
        }]
      : []),
  ];

  function addPak() {
    if (!canAdd) return;
    const groupId = `pak-${suit.code}-${withGilet ? "3d" : "2d"}-${activePieces.map((p) => sizes[p.role]).join("-")}`;
    cart.addMany(
      selection.map((s) => ({
        sku: s.variant!.sku,
        productHandle: s.piece.handle,
        title: s.piece.title,
        size: s.variant!.size,
        color: "",
        priceCents: s.variant!.priceCents,
        imageUrl: s.piece.image,
        qty: 1,
        hoofdgroep: ROLE_HG[s.piece.role],
        groupId,
        groupLabel: `Pak — ${pakTitle}`,
        roleLabel: ROLE_LABEL[s.piece.role],
      }))
    );
  }

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      {/* Visueel: de onderdelen */}
      <div>
        <div className="grid grid-cols-2 gap-3">
          {activePieces.map((p, i) => (
            <div
              key={p.role}
              className={`relative overflow-hidden rounded-card bg-surface ${i === 0 ? "col-span-2 aspect-[4/5]" : "aspect-square"}`}
            >
              {p.image ? (
                <Image
                  src={p.image}
                  alt={p.title}
                  fill
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                  priority={i === 0}
                />
              ) : null}
              <span className="absolute left-2 top-2 bg-canvas/90 px-2 py-0.5 font-sans text-[0.65rem] uppercase tracking-wide">
                {ROLE_LABEL[p.role]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Configurator */}
      <div className="lg:sticky lg:top-24 lg:self-start">
        <p className="label-brand">Stel je pak samen</p>
        <h1 className="mt-2 text-display-md">{colbert.title.replace(/^colbert[\s-]*/i, "").trim()}</h1>
        <p className="mt-2 font-display text-xl">
          {allChosen ? formatEuro(totalCents) : `vanaf ${formatEuro(baseFrom)}`}
        </p>

        {/* 2- vs 3-delig */}
        {gilet ? (
          <div className="mt-6">
            <p className="font-sans text-sm font-medium">Uitvoering</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setWithGilet(false)}
                aria-pressed={!withGilet}
                className={`border px-4 py-3 text-left transition-colors ${!withGilet ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink"}`}
              >
                <span className="block font-sans text-sm font-medium">2-delig</span>
                <span className={`font-sans text-xs ${!withGilet ? "text-canvas/70" : "text-muted"}`}>Colbert + pantalon</span>
              </button>
              <button
                type="button"
                onClick={() => setWithGilet(true)}
                aria-pressed={withGilet}
                className={`border px-4 py-3 text-left transition-colors ${withGilet ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink"}`}
              >
                <span className="block font-sans text-sm font-medium">3-delig</span>
                <span className={`font-sans text-xs ${withGilet ? "text-canvas/70" : "text-muted"}`}>+ gilet</span>
              </button>
            </div>
          </div>
        ) : null}

        {/* Maat PER ONDERDEEL — de USP: combineer gerust verschillende maten. */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="font-sans text-sm font-medium">Maat per onderdeel</p>
            <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-4">
              Vind mijn maat
            </Link>
          </div>
          <p className="mt-1 font-sans text-xs text-muted">
            Kies per onderdeel je maat — handig bij bijvoorbeeld langere armen of kortere benen.
          </p>
          <div className="mt-3 space-y-4">
            {activePieces.map((p, i) => (
              <div key={p.role}>
                <p className="font-sans text-xs uppercase tracking-wide text-muted">{ROLE_LABEL[p.role]}</p>
                {pieceSizes[i]?.length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-2">
                    {pieceSizes[i].map((label) => {
                      const v = indices[i].get(label);
                      const out = v?.known && (v?.qty ?? 0) <= 0;
                      const on = sizes[p.role] === label;
                      return (
                        <li key={label}>
                          <button
                            type="button"
                            disabled={out}
                            onClick={() => pickSize(p.role, label)}
                            aria-pressed={on}
                            className={`min-w-[3rem] border px-3 py-1.5 text-center font-sans leading-none transition-colors ${
                              out ? "cursor-not-allowed border-line text-muted opacity-50" : on ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink"
                            }`}
                          >
                            <span className={`block text-sm ${out ? "line-through" : ""}`}>{v?.size ?? rowDisplayLabel(label)}</span>
                            {rowDisplayLabel(label) !== (v?.size ?? "") ? (
                              <span className="mt-0.5 block text-[0.6rem] font-normal opacity-70">{rowDisplayLabel(label)}</span>
                            ) : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-1 font-sans text-sm text-muted">Geen maten beschikbaar.</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Samenvatting onderdelen */}
        {allChosen ? (
          <ul className="mt-6 divide-y divide-line border-y border-line">
            {selection.map((s) => {
              const out = s.variant?.known && (s.variant?.qty ?? 0) <= 0;
              return (
                <li key={s.piece.role} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-medium">{ROLE_LABEL[s.piece.role]}</p>
                    <Link href={`/products/${s.piece.handle}`} className="block truncate font-sans text-xs text-muted hover:text-ink">
                      {s.piece.title} · maat {s.variant?.size ?? "—"}
                    </Link>
                  </div>
                  <div className="text-right">
                    <p className="font-sans text-sm">{s.variant ? formatEuro(s.variant.priceCents) : "—"}</p>
                    {out ? <p className="font-sans text-[0.65rem] text-danger">uitverkocht</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {/* Totaal + CTA */}
        <div className="mt-6 flex items-center justify-between">
          <span className="font-sans text-sm text-muted">Totaalprijs</span>
          <span className="font-display text-2xl">{allChosen ? formatEuro(totalCents) : "—"}</span>
        </div>
        <button type="button" onClick={addPak} disabled={!canAdd} className="btn-primary mt-4 w-full">
          {allChosen ? "Pak in winkelwagen" : "Kies de maten"}
        </button>
        <p className="mt-3 font-sans text-xs text-muted">
          Elk onderdeel mag een eigen maat hebben — ze worden als één compleet pak toegevoegd.
          Gratis retour binnen 14 dagen; afrekenen met iDEAL volgt binnenkort.
        </p>
      </div>

      {/* Materiaal, onderhoud & pasvorm — net als op de productpagina */}
      {detailItems.length ? (
        <div className="lg:col-span-2">
          <Accordion items={detailItems} />
        </div>
      ) : null}
    </div>
  );
}
