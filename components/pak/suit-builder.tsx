"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { SuitDetail, SuitRole } from "@/lib/suit-pairing";
import { formatEuro } from "@/lib/pricing";
import { sizeRowLabel } from "@/lib/size-taxonomy";
import { useCart } from "@/components/cart/cart-context";
import { parseComposition, parseCare, careProse } from "@/lib/care";
import { MaterialBlock, CareBlock } from "@/components/pdp/care-material";
import { Accordion } from "@/components/pdp/accordion";
import { SizeMatrix } from "@/components/pdp/size-matrix";
import { DeliveryPromise } from "@/components/pdp/delivery-promise";

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

type Props = {
  suit: SuitDetail;
  /** Server-belofte uit de allocatie-engine (estimateDelivery) — net als de PDP. */
  deliveryPromise?: string | null;
  deliveryNote?: string | null;
  cutoffHour?: number;
};

export function SuitBuilder({ suit, deliveryPromise, deliveryNote, cutoffHour }: Props) {
  const cart = useCart();
  const colbert = suit.pieces.find((p) => p.role === "colbert")!;
  const broek = suit.pieces.find((p) => p.role === "broek")!;
  const gilet = suit.pieces.find((p) => p.role === "gilet") ?? null;

  const pakTitle = colbert.title.replace(/^colbert[\s-]*/i, "").trim() || colbert.title;
  const [withGilet, setWithGilet] = useState(false);
  // Maat PER ONDERDEEL (de USP) — bv. een groter colbert met een kleinere pantalon.
  // We bewaren de werkelijke maat (bv. "50") per rol, net als op de productpagina.
  const [sizes, setSizes] = useState<Partial<Record<SuitRole, string>>>({});
  // Actieve maat-tab (Colbert/Pantalon/Gilet) — één matrix tegelijk = minder scrollen.
  const [tab, setTab] = useState<SuitRole>("colbert");

  const activePieces = useMemo(
    () => [colbert, broek, ...(withGilet && gilet ? [gilet] : [])],
    [colbert, broek, gilet, withGilet]
  );

  // Val terug op Colbert als de actieve tab (gilet) verdwijnt bij 2-delig.
  useEffect(() => {
    if (!activePieces.some((p) => p.role === tab)) setTab("colbert");
  }, [activePieces, tab]);

  // Bij het kiezen van een maat: vul nog-niet-gekozen onderdelen met dezelfde
  // lettermaat-bucket (bv. colbert L → pantalon L) als die leverbaar bestaat.
  function pickSize(role: SuitRole, size: string) {
    setSizes((prev) => {
      const next: Partial<Record<SuitRole, string>> = { ...prev, [role]: size };
      const rowLabel = sizeRowLabel(size);
      for (const p of activePieces) {
        if (next[p.role] != null) continue;
        const match = p.sizes.find((s) => sizeRowLabel(s.size) === rowLabel && !(s.known && s.qty <= 0));
        if (match) next[p.role] = match.size;
      }
      return next;
    });
  }

  // Gilet erbij → vul 'm met de colbert-maat als die bestaat.
  useEffect(() => {
    if (!withGilet || !gilet || sizes.gilet || !sizes.colbert) return;
    if (gilet.sizes.some((s) => s.size === sizes.colbert)) {
      setSizes((prev) => ({ ...prev, gilet: sizes.colbert }));
    }
  }, [withGilet, gilet, sizes.colbert, sizes.gilet]);

  const selection = useMemo(
    () =>
      activePieces.map((p) => ({
        piece: p,
        variant: sizes[p.role] ? p.sizes.find((s) => s.size === sizes[p.role]) ?? null : null,
      })),
    [activePieces, sizes]
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
              className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface"
            >
              {p.image ? (
                <Image src={p.image} alt={p.title} fill sizes="(max-width: 1024px) 50vw, 25vw" className="object-cover" priority={i === 0} />
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
        <h1 className="mt-2 text-display-md">{pakTitle}</h1>
        <p className="mt-2 font-display text-xl">{allChosen ? formatEuro(totalCents) : `vanaf ${formatEuro(baseFrom)}`}</p>

        {/* 2- vs 3-delig */}
        {gilet ? (
          <div className="mt-6">
            <p className="font-sans text-sm font-medium">Uitvoering</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setWithGilet(false)} aria-pressed={!withGilet} className={`border px-4 py-3 text-left transition-colors ${!withGilet ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink"}`}>
                <span className="block font-sans text-sm font-medium">2-delig</span>
                <span className={`font-sans text-xs ${!withGilet ? "text-canvas/70" : "text-muted"}`}>Colbert + pantalon</span>
              </button>
              <button type="button" onClick={() => setWithGilet(true)} aria-pressed={withGilet} className={`border px-4 py-3 text-left transition-colors ${withGilet ? "border-ink bg-ink text-canvas" : "border-line hover:border-ink"}`}>
                <span className="block font-sans text-sm font-medium">3-delig</span>
                <span className={`font-sans text-xs ${withGilet ? "text-canvas/70" : "text-muted"}`}>+ gilet</span>
              </button>
            </div>
          </div>
        ) : null}

        {/* Maat PER ONDERDEEL — Suitsupply-stijl matrix (Regular/Long/Short). */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="font-sans text-sm font-medium">Maat per onderdeel</p>
            <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-4">Vind mijn maat</Link>
          </div>
          <p className="mt-1 font-sans text-xs text-muted">Kies per onderdeel je maat — handig bij langere armen of kortere benen.</p>

          {/* Tabs per onderdeel — één matrix tegelijk = minder scrollen; vinkje als de maat gekozen is. */}
          <div className="mt-4 flex gap-1 border-b border-line">
            {selection.map(({ piece }) => {
              const on = piece.role === tab;
              const chosen = Boolean(sizes[piece.role]);
              return (
                <button
                  key={piece.role}
                  type="button"
                  onClick={() => setTab(piece.role)}
                  aria-pressed={on}
                  className={`-mb-px flex items-center gap-1.5 border-b-2 px-4 py-2.5 font-sans text-sm transition-colors ${
                    on ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {ROLE_LABEL[piece.role]}
                  {chosen ? (
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-success" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6L9 17l-5-5" /></svg>
                  ) : null}
                </button>
              );
            })}
          </div>

          {selection
            .filter(({ piece }) => piece.role === tab)
            .map(({ piece, variant }) => (
              <div key={piece.role} className="mt-4">
                {piece.sizes.length ? (
                  <SizeMatrix
                    sizes={piece.sizes}
                    hoofdgroep={ROLE_HG[piece.role]}
                    selected={sizes[piece.role] ?? null}
                    onSelect={(size) => pickSize(piece.role, size)}
                  />
                ) : (
                  <p className="mt-1 font-sans text-sm text-muted">Geen maten beschikbaar.</p>
                )}
                {variant ? (
                  <p className="mt-3 font-sans text-xs">
                    {variant.qty > 0 ? (
                      variant.qty <= 5 ? (
                        <span className="text-danger">● Nog maar {variant.qty} — maat {variant.size}</span>
                      ) : (
                        <span className="text-success">● Op voorraad — maat {variant.size}</span>
                      )
                    ) : (
                      <span className="text-muted">Maat {variant.size} tijdelijk uitverkocht</span>
                    )}
                  </p>
                ) : null}
              </div>
            ))}
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
          Gratis retour binnen 14 dagen; veilig afrekenen met o.a. iDEAL.
        </p>

        {/* Levertijd — onder de bestelknop (zoals gevraagd). */}
        <DeliveryPromise promise={deliveryPromise} note={deliveryNote} cutoffHour={cutoffHour} />
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
