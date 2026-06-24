"use client";

import Link from "next/link";
import { useState } from "react";
import { createPortal } from "react-dom";
import {
  rowsForCategory,
  cmText,
  BOORD_CHART,
  type ChartCategory,
} from "@/lib/size-chart";
import { useT } from "@/components/i18n/locale-provider";

/** Catalogus-hoofdgroep → tabel: een chest/waist-categorie of de boord-tabel. */
function chartFor(hg: string): { category?: ChartCategory; boord?: boolean } {
  const h = (hg || "").toLowerCase();
  if (h.includes("overhemd")) return { boord: true };
  if (h.includes("pak")) return { category: "Pakken (algemeen)" };
  if (h.includes("colbert") || h.includes("gilet") || h.includes("jas") || h.includes("blazer")) return { category: "Colberts (Standaard)" };
  if (h.includes("broek") || h.includes("pantalon")) return { category: "Pantalon (Standaard)" };
  if (h.includes("polo")) return { category: "Poloshirts" };
  if (h.includes("trui") || h.includes("vest") || h.includes("sweat")) return { category: "Truien" };
  return {};
}

/**
 * "Onze maattabel" — data-gedreven uit de échte GENTS-maattabel (lib/size-chart),
 * per productcategorie. Toont lichaamsmaten (cm) per maat zodat de klant zijn maat
 * kan opzoeken. Geen knop voor categorieën zonder maattabel (schoenen/accessoires).
 */
export function SizeChartButton({ hoofdgroep, pageHandle }: { hoofdgroep: string; pageHandle?: string | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const target = chartFor(hoofdgroep);
  if (!target.category && !target.boord) return null;

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-ink-soft underline underline-offset-4 hover:text-ink">
        {t("pdp.size.chart")}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[60]" role="dialog" aria-label={t("pdp.size.chart")} aria-modal="true">
              <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
              <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-canvas shadow-drawer">
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <p className="font-display text-lg">Onze maattabel</p>
                  <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="font-sans text-sm underline">{t("common.close")}</button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <p className="mb-3 font-sans text-xs text-ink-soft">Lichaamsmaten in centimeters. Twijfel je tussen twee maten? Onze stylisten in de winkel helpen je graag.</p>
                  {target.boord ? <BoordTable /> : <CategoryTable category={target.category!} />}
                  <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-sans text-xs">
                    <Link href="/maatadvies" onClick={() => setOpen(false)} className="text-ink underline underline-offset-4">Vind mijn maat →</Link>
                    {pageHandle ? <Link href={`/pages/${pageHandle}`} onClick={() => setOpen(false)} className="text-ink-soft underline underline-offset-4">Uitgebreide maatinformatie</Link> : null}
                  </div>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border-b border-line px-2 py-2 text-left font-sans text-xs font-medium text-ink">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="border-b border-line/60 px-2 py-2 font-sans text-sm tabular-nums text-ink-soft">{children}</td>;
}

function CategoryTable({ category }: { category: ChartCategory }) {
  const rows = rowsForCategory(category);
  const hasChest = rows.some((r) => r.chestMin != null);
  const hasWaist = rows.some((r) => r.waistMin != null);
  const hasInner = rows.some((r) => r.innerLegMin != null);
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <Th>Maat</Th>
          {hasChest ? <Th>Borst</Th> : null}
          {hasWaist ? <Th>Taille</Th> : null}
          {hasInner ? <Th>Binnenbeen</Th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.size}>
            <Td>{r.size}</Td>
            {hasChest ? <Td>{cmText(r.chestMin, r.chestMax)}</Td> : null}
            {hasWaist ? <Td>{cmText(r.waistMin, r.waistMax)}</Td> : null}
            {hasInner ? <Td>{cmText(r.innerLegMin, r.innerLegMax)}</Td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BoordTable() {
  return (
    <>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <Th>Maat</Th>
            <Th>Boordmaat</Th>
            <Th>Borst</Th>
            <Th>Taille</Th>
          </tr>
        </thead>
        <tbody>
          {BOORD_CHART.map((r) => (
            <tr key={r.confectie}>
              <Td>{r.confectie}</Td>
              <Td>{r.boordCm} cm</Td>
              <Td>{cmText(r.chestMin, r.chestMax)}</Td>
              <Td>{cmText(r.waistMin, r.waistMax)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-sans text-xs text-muted">Lange armen? Kies de 7-variant (+5–6 cm mouwlengte).</p>
    </>
  );
}
