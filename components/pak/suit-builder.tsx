"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import type { SuitDetail, SuitPieceDetail, SuitRole } from "@/lib/suit-pairing";
import { formatEuro } from "@/lib/pricing";
import { rowSortIndex, rowDisplayLabel } from "@/lib/size-taxonomy";
import { useCart } from "@/components/cart/cart-context";

const ROLE_LABEL: Record<SuitRole, string> = {
  colbert: "Colbert",
  broek: "Pantalon",
  gilet: "Gilet",
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
  const [sizeLabel, setSizeLabel] = useState<string | null>(null);

  const activePieces = useMemo(
    () => [colbert, broek, ...(withGilet && gilet ? [gilet] : [])],
    [colbert, broek, gilet, withGilet]
  );

  const indices = useMemo(() => activePieces.map((p) => sizeIndex(p)), [activePieces]);

  // Maten die in álle actieve onderdelen bestaan (zo is een compleet pak mogelijk).
  const availableSizes = useMemo(() => {
    if (!indices.length) return [];
    const [first, ...rest] = indices;
    const labels = [...first.keys()].filter((l) => rest.every((m) => m.has(l)));
    return labels.sort((a, b) => rowSortIndex(a) - rowSortIndex(b));
  }, [indices]);

  const selection = useMemo(() => {
    if (!sizeLabel) return null;
    return activePieces.map((p, i) => ({ piece: p, variant: indices[i].get(sizeLabel) ?? null }));
  }, [sizeLabel, activePieces, indices]);

  const totalCents = useMemo(
    () => (selection ? selection.reduce((sum, s) => sum + (s.variant?.priceCents ?? 0), 0) : 0),
    [selection]
  );

  const baseFrom = useMemo(
    () => activePieces.reduce((sum, p) => sum + Math.min(...p.sizes.map((s) => s.priceCents)), 0),
    [activePieces]
  );

  const canAdd = Boolean(selection && selection.every((s) => s.variant));

  function addPak() {
    if (!selection || !canAdd) return;
    const groupId = `pak-${suit.code}-${sizeLabel}-${withGilet ? "3d" : "2d"}`;
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
          {selection ? formatEuro(totalCents) : `vanaf ${formatEuro(baseFrom)}`}
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

        {/* Maat (zelfde maat voor alle onderdelen) */}
        <div className="mt-6">
          <div className="flex items-center justify-between">
            <p className="font-sans text-sm font-medium">Maat</p>
            <Link href="/maatadvies" className="font-sans text-xs text-ink underline underline-offset-4">
              Vind mijn maat
            </Link>
          </div>
          {availableSizes.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {availableSizes.map((label) => {
                const on = sizeLabel === label;
                return (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => setSizeLabel(label)}
                      aria-pressed={on}
                      className={`min-w-[3rem] border px-3 py-2 text-center font-sans text-sm transition-colors ${on ? "border-ink bg-ink text-canvas" : "border-line text-ink hover:border-ink"}`}
                    >
                      {rowDisplayLabel(label)}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-2 font-sans text-sm text-muted">
              Voor deze combinatie zijn geen overlappende maten beschikbaar.
            </p>
          )}
        </div>

        {/* Samenvatting onderdelen */}
        {selection ? (
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
          <span className="font-display text-2xl">{selection ? formatEuro(totalCents) : "—"}</span>
        </div>
        <button type="button" onClick={addPak} disabled={!canAdd} className="btn-primary mt-4 w-full">
          {sizeLabel ? "Pak in winkelwagen" : "Kies een maat"}
        </button>
        <p className="mt-3 font-sans text-xs text-muted">
          De onderdelen worden als compleet pak toegevoegd in dezelfde maat.
          Gratis retour binnen 14 dagen; afrekenen met iDEAL volgt binnenkort.
        </p>
      </div>
    </div>
  );
}
