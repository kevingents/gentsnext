import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { maattabelRijen, maattabelVersies } from "@/db/schema";
import { CHART_CATEGORIES, builtInChart, type SizeChart } from "@/lib/size-chart";
import { SIZE_GUIDES } from "@/lib/size-chart-hub";
import { sizeGroup, sizeRowLabel } from "@/lib/size-taxonomy";
import { naarSizeChart, type KeurContext, type MaatRij } from "@/lib/maattabel-regels";

/**
 * De actieve maattabel lezen en nieuwe versies opslaan. SERVER-ONLY (database).
 *
 * De site draait op `getActieveTabel()`. Is er niets geüpload, of ligt de DB
 * eruit, dan komt de ingebakken tabel uit lib/size-chart terug. Dat is met opzet
 * geen foutmelding: een maatadvies van vorige maand is beter dan geen maatadvies,
 * en een maattabelpagina die "er ging iets mis" zegt is voor een klant nutteloos.
 */

/* Dezelfde TTL-cache als lib/settings: deze tabel wordt bij élke storefront-render
   gelezen (de layout geeft hem aan de client mee) en verandert een paar keer per
   jaar. 30 seconden na het activeren staat de nieuwe tabel overal. */
let _cache: SizeChart | null = null;
let _at = 0;
const TTL = 30_000;

export type VersieRij = {
  id: string;
  versie: number;
  bestandsnaam: string;
  actor: string;
  aantalRijen: number;
  actief: boolean;
  notitie: string;
  createdAt: string;
};

/** Rijen van één versie, op bladvolgorde. */
export async function rijenVanVersie(versieId: string): Promise<MaatRij[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(maattabelRijen)
    .where(eq(maattabelRijen.versieId, versieId))
    .orderBy(asc(maattabelRijen.sortering));
  return rows.map((r) => ({
    productType: (r.productType as MaatRij["productType"]) || "TOP",
    categorie: r.categorie,
    maat: r.maat,
    boordCm: r.boordCm,
    borstMin: r.borstMin,
    borstMax: r.borstMax,
    tailleMin: r.tailleMin,
    tailleMax: r.tailleMax,
    binnenbeenMin: r.binnenbeenMin,
    binnenbeenMax: r.binnenbeenMax,
    sortering: r.sortering,
  }));
}

/** De actieve versie, of null als er nog nooit iets geüpload is. */
export async function actieveVersie(): Promise<VersieRij | null> {
  const db = getDb();
  // Tolerant lezen: mocht er ooit door een handmatige UPDATE meer dan één versie
  // op actief staan, dan is de hoogste voorspelbaar de juiste — geen 500.
  const rows = await db
    .select()
    .from(maattabelVersies)
    .where(eq(maattabelVersies.actief, true))
    .orderBy(desc(maattabelVersies.versie))
    .limit(1);
  const v = rows[0];
  return v ? { ...v, createdAt: v.createdAt.toISOString() } : null;
}

/** De maattabel waar de site op draait. Valt terug op de tabel in code. */
export async function getActieveTabel(): Promise<SizeChart> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  let chart = builtInChart();
  try {
    const v = await actieveVersie();
    if (v) {
      const rijen = await rijenVanVersie(v.id);
      // Een actieve versie zónder rijen is kapotter dan geen versie: dan zou het
      // maatadvies niets meer kunnen matchen. Val dan terug op de code.
      if (rijen.length) chart = naarSizeChart(rijen, v.versie);
    }
  } catch {
    chart = builtInChart();
  }
  _cache = chart;
  _at = Date.now();
  return chart;
}

export function leegMaattabelCache() {
  _cache = null;
  _at = 0;
}

/** Alle versies, nieuwste eerst — de historie in de portal. */
export async function alleVersies(limiet = 25): Promise<VersieRij[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(maattabelVersies)
    .orderBy(desc(maattabelVersies.versie))
    .limit(limiet);
  return rows.map((v) => ({ ...v, createdAt: v.createdAt.toISOString() }));
}

/**
 * Slaat een nieuwe versie op. Schrijft in deze volgorde: versie (nog NIET
 * actief) → rijen → eventueel activeren. Die volgorde is de hele
 * veiligheidsmaatregel: neon-http kent geen transacties, dus een half
 * weggeschreven versie is mogelijk — maar zolang hij niet actief is, ziet geen
 * enkele klant hem.
 */
export async function bewaarVersie(opts: {
  rijen: MaatRij[];
  bestandsnaam?: string;
  actor?: string;
  notitie?: string;
  activeer?: boolean;
}): Promise<VersieRij> {
  const db = getDb();
  if (!opts.rijen.length) throw new Error("Een versie zonder rijen opslaan heeft geen zin.");

  const [hoogste] = await db
    .select({ n: sql<number>`coalesce(max(${maattabelVersies.versie}), 0)` })
    .from(maattabelVersies);
  const versie = Number(hoogste?.n || 0) + 1;

  const [ingevoegd] = await db
    .insert(maattabelVersies)
    .values({
      versie,
      bestandsnaam: (opts.bestandsnaam || "").slice(0, 200),
      actor: (opts.actor || "").slice(0, 200),
      aantalRijen: opts.rijen.length,
      notitie: (opts.notitie || "").slice(0, 500),
      actief: false,
    })
    .returning();

  // In blokken invoegen: één insert met 90 rijen is prima, maar een blad met
  // honderden rijen loopt tegen de parameterlimiet van de driver aan.
  const BLOK = 100;
  for (let i = 0; i < opts.rijen.length; i += BLOK) {
    await db.insert(maattabelRijen).values(
      opts.rijen.slice(i, i + BLOK).map((r, j) => ({
        versieId: ingevoegd.id,
        productType: r.productType,
        categorie: r.categorie,
        maat: r.maat,
        boordCm: r.boordCm,
        borstMin: r.borstMin,
        borstMax: r.borstMax,
        tailleMin: r.tailleMin,
        tailleMax: r.tailleMax,
        binnenbeenMin: r.binnenbeenMin,
        binnenbeenMax: r.binnenbeenMax,
        sortering: i + j,
      })),
    );
  }

  if (opts.activeer) return (await activeerVersie(ingevoegd.id)) ?? { ...ingevoegd, createdAt: ingevoegd.createdAt.toISOString() };
  return { ...ingevoegd, createdAt: ingevoegd.createdAt.toISOString() };
}

/**
 * Zet één versie actief en alle andere uit, in ÉÉN statement.
 *
 * `SET actief = (id = $1) WHERE actief OR id = $1` raakt precies de oude en de
 * nieuwe rij. Twee losse updates zouden een moment opleveren waarin er geen
 * actieve tabel is en de hele site terugvalt op de code-fallback — zie de
 * uitleg in drizzle/0059 waarom hier geen unieke index op staat.
 */
export async function activeerVersie(versieId: string): Promise<VersieRij | null> {
  const db = getDb();
  await db
    .update(maattabelVersies)
    .set({ actief: sql`(${maattabelVersies.id} = ${versieId})` })
    .where(or(eq(maattabelVersies.actief, true), eq(maattabelVersies.id, versieId)));
  leegMaattabelCache();
  const rows = await db
    .select()
    .from(maattabelVersies)
    .where(and(eq(maattabelVersies.id, versieId), eq(maattabelVersies.actief, true)))
    .limit(1);
  const v = rows[0];
  return v ? { ...v, createdAt: v.createdAt.toISOString() } : null;
}

/** Categorie → hoofdgroepen, afgeleid uit de maattabellen-hub — één bron. */
export function hoofdgroepenPerCategorie(): Map<string, string[]> {
  const kaart = new Map<string, string[]>();
  for (const gids of SIZE_GUIDES) {
    for (const spec of gids.charts) {
      const cat = spec.boord ? "Overhemden (Boordmaat)" : spec.category;
      if (!cat) continue;
      kaart.set(cat, [...new Set([...(kaart.get(cat) ?? []), ...gids.hoofdgroepen])]);
    }
  }
  return kaart;
}

/**
 * De lijstjes die de keuring nodig heeft, in één keer. `metCatalogus: false` laat
 * de catalogus-controle weg — die kost een query en is niet nodig als je alleen
 * wilt weten of een versie überhaupt geactiveerd mag worden.
 */
export async function keurContext(metCatalogus = true): Promise<KeurContext> {
  return {
    bekendeCategorieen: CHART_CATEGORIES,
    hoofdgroepen: hoofdgroepenPerCategorie(),
    catalogusMaten: metCatalogus ? await catalogusMatenPerHoofdgroep().catch(() => undefined) : undefined,
    // Vergelijken op de lettermaat-rij, niet op de ruwe maat — één hoofdgroep
    // bevat meerdere maatsystemen door elkaar (zie KeurContext.rijLabel).
    rijLabel: sizeRowLabel,
    // Broeken hebben standaard-, lengte- én kwartmaten door elkaar; de tabel
    // splitst die in drie categorieën. Hiermee blijven ze gescheiden.
    maatGroep: (maat) => sizeGroup(maat, "regular-long-short"),
  };
}

/**
 * Maten zoals ze in de CATALOGUS voorkomen, per hoofdgroep — voor de controle
 * "welke verkochte maat kent de tabel niet". Leest de varianten, niet de
 * maattabel: dit is de werkelijkheid waar de tabel iets over moet zeggen.
 */
export async function catalogusMatenPerHoofdgroep(): Promise<Map<string, string[]>> {
  const db = getDb();
  // Hoofdgroep zit in attributes->>'hoofdgroep_omschrijving' — dat is de
  // categorie-sleutel die de rest van de codebase ook gebruikt.
  //
  // `having count(*) >= 2` filtert tikfouten weg: één losse variant met maat
  // "50 " of "M/" hoort geen bevinding op te leveren die niemand kan oplossen.
  const rows = await db
    .execute<{ hoofdgroep: string; maat: string }>(sql`
      select
        coalesce(p.attributes->>'hoofdgroep_omschrijving', '') as hoofdgroep,
        v.size as maat
      from product_variants v
      join products p on p.id = v.product_id
      where coalesce(v.size, '') <> ''
        and coalesce(p.attributes->>'hoofdgroep_omschrijving', '') <> ''
      group by 1, 2
      having count(*) >= 2
      order by 1, 2
    `)
    .then((r) => r.rows);

  const kaart = new Map<string, string[]>();
  for (const r of rows) {
    const groep = String(r.hoofdgroep || "").trim();
    const maat = String(r.maat || "").trim();
    if (!groep || !maat) continue;
    if (!kaart.has(groep)) kaart.set(groep, []);
    kaart.get(groep)!.push(maat);
  }
  return kaart;
}
