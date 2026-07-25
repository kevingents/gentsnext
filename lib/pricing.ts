import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { priceHistory } from "@/db/schema";
import { getSettings } from "@/lib/settings";

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

/**
 * Alleen een korting tonen die de naam waard is: minstens 5% én € 1. Een
 * doorgestreepte prijs bij 5 cent verschil (afronding in de brondata) ondermijnt
 * elke echte sale-badge.
 */
export function isRealDiscount(priceCents: number, compareAtCents?: number | null): boolean {
  if (!compareAtCents || compareAtCents <= priceCents) return false;
  const diff = compareAtCents - priceCents;
  return diff >= 100 && diff / compareAtCents >= 0.05;
}

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

/**
 * Hoe lang een prijsvermindering "aangekondigd" mag blijven: standaard 30 dagen
 * ná de ingangsdatum van de huidige (lagere) prijs. Daarna vervalt de
 * doorgestreepte "van"-prijs en de sale-badge, óók als de prijs feitelijk
 * verlaagd is.
 *
 * Waarom: de Omnibus-richtlijn gaat over het AANKONDIGEN van een prijsvermindering.
 * Een prijs die al maanden de gewone verkoopprijs is, is geen aankondiging meer —
 * dan is de oude prijs simpelweg niet langer relevant en zou een blijvende
 * doorgestreepte prijs de klant een korting voorspiegelen die niet bestaat.
 * Zonder deze grens bleef één prijsverlaging tot in lengte van jaren "SALE".
 *
 * Dit is de DEFAULT; de werkelijke grens staat als `saleAnnouncementDays` in de
 * instellingen-store en is via /account/instellingen te bewerken — geen
 * codewijziging + redeploy nodig. De 30 sluit bewust aan op het
 * referentievenster hierboven zodat er één begrijpelijk getal in het spel is.
 */
export const DEFAULT_SALE_ANNOUNCEMENT_DAYS = 30;
/** Grenzen voor de instelling: minstens één dag, hooguit twee jaar. */
export const SALE_ANNOUNCEMENT_DAYS_MIN = 1;
export const SALE_ANNOUNCEMENT_DAYS_MAX = 730;

/**
 * Onzin uit de instelling (0, negatief, 5000, leeg, tekst) mag de sale-weergave
 * nooit kapotmaken: klem naar het toegestane bereik, val bij niet-getallen terug
 * op de default. De API weigert zulke waarden al bij het opslaan; dit is het
 * vangnet voor rijen die er ooit langs zijn gekomen.
 */
export function clampSaleAnnouncementDays(days: unknown): number {
  const n = Math.round(Number(days));
  if (!Number.isFinite(n)) return DEFAULT_SALE_ANNOUNCEMENT_DAYS;
  return Math.max(SALE_ANNOUNCEMENT_DAYS_MIN, Math.min(SALE_ANNOUNCEMENT_DAYS_MAX, n));
}

type HistoryRow = { variantId: string; priceCents: number; validFrom: Date };

/**
 * Berekent per variant de Omnibus-referentieprijs: de laagste prijs die gold
 * in de 30 dagen vóór de ingangsdatum van de huidige prijs. Retourneert alleen
 * een waarde als die referentie HOGER is dan de huidige prijs (= echte korting)
 * ÉN de huidige prijs zelf nog geen `announcementDays` oud is.
 *
 * Opeenvolgende rijen met dezelfde prijs worden eerst samengevouwen, zodat een
 * herimport die een no-op-rij toevoegt het vensteranker (de ingangsdatum van
 * de huidige prijs) niet kan verschuiven.
 *
 * Blijft een PURE functie: `now` en `announcementDays` gaan erin, er wordt niets
 * opgehaald. `now` is injecteerbaar zodat de rekenkern testbaar is zonder aan de
 * klok te hoeven zitten; in productie blijft het gewoon "nu". De ingestelde
 * termijn komt van getReferencePrices (die de instellingen leest).
 */
export function computeReferencePrices(
  rows: HistoryRow[],
  now: Date = new Date(),
  announcementDays: number = DEFAULT_SALE_ANNOUNCEMENT_DAYS
): Map<string, number> {
  const announcementMs = clampSaleAnnouncementDays(announcementDays) * 24 * 60 * 60 * 1000;
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
    // Aankondiging uitgewerkt: de huidige prijs geldt al langer dan de drempel en
    // is daarmee gewoon de normale prijs geworden — geen "van"-prijs, geen badge.
    if (now.getTime() - windowEnd > announcementMs) continue;
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
 *
 * Dit is de plek waar de INGESTELDE sale-vervaltermijn de pure rekenkern in
 * gaat. Bewust hier en niet bij de aanroepers (PDP-pagina, catalogus): die
 * halen de instellingen elders in hun bestand op, in een andere Promise.all —
 * de waarde daarvandaan doorgeven zou twee bestanden herbedraden voor één
 * getal. getSettings() heeft een cache van 30 sec, dus dit kost geen extra
 * DB-round-trip per productpagina.
 */
export async function getReferencePrices(variantIds: string[]): Promise<Map<string, number>> {
  if (!variantIds.length) return new Map();
  const db = getDb();
  const [rows, settings] = await Promise.all([
    db
      .select({
        variantId: priceHistory.variantId,
        priceCents: priceHistory.priceCents,
        validFrom: priceHistory.validFrom,
      })
      .from(priceHistory)
      .where(inArray(priceHistory.variantId, variantIds)),
    getSettings().catch(() => null), // instellingen weg → gewoon de default-termijn
  ]);
  return computeReferencePrices(rows, new Date(), settings?.saleAnnouncementDays);
}
