import { rowsForCategory, cmText, BOORD_CHART, type ChartCategory } from "@/lib/size-chart";
import type { SizeChartSpec } from "@/lib/size-chart-hub";

/**
 * Server-gerenderde, semantische maattabel uit de échte GENTS-data (lib/size-chart).
 * Geen client-JS nodig: de tabel staat in de HTML en is dus indexeerbaar voor Google.
 */
function Th({ children }: { children: React.ReactNode }) {
  return <th scope="col" className="border-b border-line px-3 py-2.5 text-left font-sans text-xs font-medium uppercase tracking-wide text-ink">{children}</th>;
}
function Td({ children, head }: { children: React.ReactNode; head?: boolean }) {
  return head
    ? <th scope="row" className="border-b border-line/60 px-3 py-2.5 text-left font-sans text-sm font-medium tabular-nums text-ink">{children}</th>
    : <td className="border-b border-line/60 px-3 py-2.5 font-sans text-sm tabular-nums text-ink-soft">{children}</td>;
}

function CategoryTable({ category, caption }: { category: ChartCategory; caption: string }) {
  const rows = rowsForCategory(category);
  const hasChest = rows.some((r) => r.chestMin != null);
  const hasWaist = rows.some((r) => r.waistMin != null);
  const hasInner = rows.some((r) => r.innerLegMin != null);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface">
          <tr>
            <Th>Maat</Th>
            {hasChest ? <Th>Borst (cm)</Th> : null}
            {hasWaist ? <Th>Taille (cm)</Th> : null}
            {hasInner ? <Th>Binnenbeen (cm)</Th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.size}>
              <Td head>{r.size}</Td>
              {hasChest ? <Td>{cmText(r.chestMin, r.chestMax)}</Td> : null}
              {hasWaist ? <Td>{cmText(r.waistMin, r.waistMax)}</Td> : null}
              {hasInner ? <Td>{cmText(r.innerLegMin, r.innerLegMax)}</Td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoordTable({ caption }: { caption: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface">
          <tr>
            <Th>Maat</Th>
            <Th>Boordmaat (cm)</Th>
            <Th>Borst (cm)</Th>
            <Th>Taille (cm)</Th>
          </tr>
        </thead>
        <tbody>
          {BOORD_CHART.map((r) => (
            <tr key={r.confectie}>
              <Td head>{r.confectie}</Td>
              <Td>{r.boordCm}</Td>
              <Td>{cmText(r.chestMin, r.chestMax)}</Td>
              <Td>{cmText(r.waistMin, r.waistMax)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SizeTable({ spec }: { spec: SizeChartSpec }) {
  return (
    <figure className="m-0">
      <figcaption className="mb-2 font-sans text-sm font-medium text-ink">{spec.caption}</figcaption>
      {spec.boord ? <BoordTable caption={spec.caption} /> : spec.category ? <CategoryTable category={spec.category} caption={spec.caption} /> : null}
    </figure>
  );
}
