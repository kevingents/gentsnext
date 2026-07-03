import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { priceHistory } from "@/db/schema";

/**
 * Prijsweergave volgens de Omnibus-richtlijn (Besluit prijsaanduiding, art. 5a):
 * een doorgestreepte "van"-prijs mag alleen de LAAGSTE prijs zijn die in de
 * 30 dagen vóór het ingaan van de huidige (actie)prijs gold.
 *
 * Bewuste keuze: we tonen een vergelijkprijs UITSLUITEND wanneer die uit de
 * eigen prijshistorie berekend kan worden. Het Shopify-veld compareAtCents
 * wordt wel bewaard (migratie/analyse) maar nooit als "van"-prijs gerenderd —
 * marketeers krijgen geen vrij invulbaar kortingsveld. ACM handhaaft hierop
 * actief (boetes o.a. G-Star, Tommy Hilfiger).
 */

// Verplaatst naar lib/format (pure module, geen db-import — lichter voor client
// bundles); re-export zodat de bestaande imports via "@/lib/pricing" blijven werken.
export { formatEuro } from "@/lib/format";

export type TieredDiscountCfg = { enabled: boolean; minItems: number; percentOff: number };

/** Staffelkorting: vanaf `minItems` artikelen → `percentOff`% op het subtotaal.
 *  Pure functie — zelfde berekening op client (weergave) en server (autoritatief). */
export function tieredDiscountCents(itemCount: number, subtotalCents: number, cfg?: TieredDiscountCfg | null): number {
  if (!cfg?.enabled || subtotalCents <= 0) return 0;
  if (itemCount < Math.max(1, cfg.minItems || 0)) return 0;
  const pct = Math.max(0, Math.min(100, cfg.percentOff || 0));
  return Math.min(subtotalCents, Math.round((subtotalCents * pct) / 100));
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type HistoryRow = { variantId: string; priceCents: number; validFrom: Date };

/**
 * Berekent per variant de Omnibus-referentieprijs: de laagste prijs die gold
 * in de 30 dagen vóór de ingangsdatum van de huidige prijs. Retourneert alleen
 * een waarde als die referentie HOGER is dan de huidige prijs (= echte korting).
 *
 * Opeenvolgende rijen met dezelfde prijs worden eerst samengevouwen, zodat een
 * herimport die een no-op-rij toevoegt het vensteranker (de ingangsdatum van
 * de huidige prijs) niet kan verschuiven.
 */
export function computeReferencePrices(rows: HistoryRow[]): Map<string, number> {
  const byVariant = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const list = byVariant.get(row.variantId) || [];
    list.push(row);
    byVariant.set(row.variantId, list);
  }

  const result = new Map<string, number>();
  for (const [variantId, history] of byVariant) {
    history.sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());

    // Vouw opeenvolgende gelijke prijzen samen — vroegste ingangsdatum wint.
    const collapsed: HistoryRow[] = [];
    for (const row of history) {
      const last = collapsed[collapsed.length - 1];
      if (!last || last.priceCents !== row.priceCents) collapsed.push(row);
    }
    if (collapsed.length < 2) continue; // geen prijswijziging → geen "van"-prijs

    const current = collapsed[collapsed.length - 1];
    const windowEnd = current.validFrom.getTime();
    const windowStart = windowEnd - THIRTY_DAYS_MS;
    let lowest: number | null = null;
    for (let i = 0; i < collapsed.length - 1; i++) {
      const row = collapsed[i];
      const next = collapsed[i + 1];
      // Prijsperiode [row.validFrom, next.validFrom) overlapt het 30-dagenvenster?
      if (next.validFrom.getTime() > windowStart && row.validFrom.getTime() < windowEnd) {
        lowest = lowest == null ? row.priceCents : Math.min(lowest, row.priceCents);
      }
    }
    if (lowest != null && lowest > current.priceCents) result.set(variantId, lowest);
  }
  return result;
}

/**
 * Haalt referentieprijzen op voor een set varianten (PDP-gebruik).
 * Bewust ZONDER datumfilter: een prijsperiode die lang geleden begon kan het
 * 30-dagenvenster nog steeds raken, en prijsrijen per variant zijn schaars
 * (alleen echte prijswijzigingen) — volledig ophalen is correct én goedkoop.
 */
export async function getReferencePrices(variantIds: string[]): Promise<Map<string, number>> {
  if (!variantIds.length) return new Map();
  const db = getDb();
  const rows = await db
    .select({
      variantId: priceHistory.variantId,
      priceCents: priceHistory.priceCents,
      validFrom: priceHistory.validFrom,
    })
    .from(priceHistory)
    .where(inArray(priceHistory.variantId, variantIds));
  return computeReferencePrices(rows);
}
