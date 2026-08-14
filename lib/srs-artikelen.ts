/**
 * De SRS-koppeling op PRODUCTNIVEAU.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WAT ER NIET WAS
 *
 * `products.srs_artikel_nummer` en `srs_kleur_id` bestaan al sinds de blauwdruk
 * ("een product = artikelnummer + kleur"), maar op productie stond bij alle
 * 2.973 producten allebei leeg en `srs_gezien_op` op null. Op VARIANTniveau was
 * de koppeling er wél: 23.169 varianten hebben een `srs_artikel_id`, en
 * `srs_stock` matcht op `sku`. De brug tussen die twee ontbrak simpelweg.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWEE WEGEN, BEWUST ALLEBEI
 *
 * 1. UIT DE BRONDATA (geen SRS-toegang nodig). `attributes.artikel_nummer` staat
 *    bij 98% van de producten al gevuld en is hetzelfde nummer dat SRS in zijn
 *    productenbestand "Artikel nummer" noemt — de attribuutnamen komen
 *    één-op-één uit die feed (artikel_id, hoofdgroep_id, artikel_nummer). Goed
 *    genoeg om de kolom te vullen, maar het bewíjst niets: het zegt alleen dat
 *    wij dat nummer ooit hebben overgenomen, niet dat SRS het artikel vandaag
 *    nog kent. Daarom zet deze weg `srs_gezien_op` NIET.
 *
 * 2. UIT SRS ZELF (si_webshop productinformatie). Dat is de echte koppeling: het
 *    levende artikelnummer, het KLEUR-ID (dat we nergens anders hebben) en het
 *    bewijs dat het artikel bestaat. Die zet `srs_gezien_op` wél.
 *
 * De join is de BARCODE ↔ `product_variants.sku`. Niet de handle, niet de titel:
 * dat is dezelfde regel als bij de voorraad, en om dezelfde reden — een sku hoort
 * bij precies één fysiek artikel en verandert niet mee met een titelwijziging.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECRETS. Weg 2 vraagt SRS_API_USER + SRS_API_PASSWORD (dezelfde si_webshop-
 * gebruiker als de weborder- en voucherservice, die in storegents al gebruikt
 * wordt). Staan die niet in de omgeving, dan meldt deze module dat en doet weg 1
 * het werk — in plaats van te crashen.
 *
 * Het parsen zelf staat in lib/srs-artikelen-regels.js, zodat `node --test`
 * erbij kan: één verschoven kolom koppelt artikelnummers aan de verkeerde
 * barcodes zónder dat er iets faalt, en dat wil je door een test laten bewaken.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { leesArtikelen, meestVoorkomend } from "@/lib/srs-artikelen-regels";

/* ══════════════════════════════════════════════════════════════════════════
   1. De si_webshop-client
   ══════════════════════════════════════════════════════════════════════════ */

const DEFAULT_BASE = "https://ws.srs.nl";
const PRODUCT_INFO_PATH = "/webservices/rest/webshop/get_product_info.php";

export type SrsArtikel = {
  artikelNummer: string;
  artikelId: string;
  omschrijving: string;
  hoofdgroepId: string;
  hoofdgroep: string;
  leverancier: string;
  kleurId: string;
  kleur: string;
  maat: string;
  barcode: string;
  verkoopprijsCents: number;
  /** label_* uit SRS — precies de velden waar de compleetheidsmeting op let. */
  merk: string;
  seizoen: string;
  jaar: string;
  materiaal: string;
  samenstelling: string;
  pasvorm: string;
  /** 'Artikel foto' 1 t/m 6, alleen http(s). */
  fotos: string[];
};

export function srsBeschikbaar(): boolean {
  return Boolean((process.env.SRS_API_USER || process.env.SRS_API_USERNAME) && process.env.SRS_API_PASSWORD);
}

/** SRS levert cp1252, niet UTF-8 — anders wordt "café" een blokje. */
function decodeCp1252(buf: Buffer): string {
  try {
    return new TextDecoder("windows-1252").decode(buf);
  } catch {
    return buf.toString("latin1");
  }
}

/**
 * Haalt het SRS-productenbestand op.
 * `delta` = alleen wat in de laatste 72 uur veranderde (klein en snel);
 * zonder delta krijg je alles (groot — reken op tientallen megabytes).
 */
export async function haalSrsArtikelen(
  { delta = false, timeoutMs = 90_000 }: { delta?: boolean; timeoutMs?: number } = {},
): Promise<{ ok: true; rijen: SrsArtikel[]; delta: boolean } | { ok: false; error: string }> {
  const user = process.env.SRS_API_USER || process.env.SRS_API_USERNAME || "";
  const password = process.env.SRS_API_PASSWORD || "";
  if (!user || !password) {
    return { ok: false, error: "SRS_API_USER en/of SRS_API_PASSWORD ontbreken (si_webshop)." };
  }
  const base = (process.env.SRS_WEBSERVICES_BASE_URL || process.env.SRS_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const url = `${base}${PRODUCT_INFO_PATH}?user=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}${delta ? "&delta=true" : ""}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal, redirect: "follow", cache: "no-store" });
  } catch (e) {
    const err = e as Error;
    return { ok: false, error: err.name === "AbortError" ? `SRS gaf geen antwoord binnen ${timeoutMs}ms.` : err.message };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) return { ok: false, error: `SRS product-info HTTP ${res.status}.` };

  const buf = Buffer.from(await res.arrayBuffer());
  const text = decodeCp1252(buf);
  /* SRS kan per webshop-instelling ook XML leveren. Dat is geen parse-fout maar
     een verkeerd gezette schakelaar aan hún kant — zeg dat dan ook. */
  if (/^\s*</.test(text)) {
    return { ok: false, error: 'SRS gaf XML terug. Zet "Bestandsformaat" op CSV in SRS-programma "webshops".' };
  }

  return { ok: true, rijen: leesArtikelen(text) as SrsArtikel[], delta };
}

/* ══════════════════════════════════════════════════════════════════════════
   2. Koppelen
   ══════════════════════════════════════════════════════════════════════════ */

export type KoppelResultaat = {
  bekeken: number;
  gekoppeld: number;
  ongewijzigd: number;
  zonderMatch: number;
  /** Artikelnummers die aan meer dan één product hangen — die slaan we over. */
  botsingen: { artikelNummer: string; handles: string[] }[];
  bron: "srs" | "attributen";
};

/**
 * Koppelt op basis van wat we al hebben: `attributes.artikel_nummer`.
 *
 * Vult alleen `srs_artikel_nummer` — géén kleur-id (dat staat nergens in onze
 * data) en géén `srs_gezien_op`, want dit bewijst niet dat SRS het artikel nog
 * kent. Een botsing (twee producten met hetzelfde nummer) wordt overgeslagen en
 * gemeld in plaats van willekeurig opgelost: dat zijn duplicaten in de
 * catalogus, en die hoor je te zien, niet weg te schrijven.
 */
export async function koppelUitAttributen(droogdraaien = false): Promise<KoppelResultaat> {
  const db = getDb();
  const rijen = (
    await db.execute<{ id: string; handle: string; nr: string; huidig: string }>(sql`
      select id, handle, attributes ->> 'artikel_nummer' nr, coalesce(srs_artikel_nummer, '') huidig
      from products
      where coalesce(attributes ->> 'artikel_nummer', '') <> '' and status <> 'archived'`)
  ).rows;

  const perNummer = new Map<string, { id: string; handle: string; huidig: string }[]>();
  for (const r of rijen) {
    const lijst = perNummer.get(r.nr) ?? [];
    lijst.push({ id: r.id, handle: r.handle, huidig: r.huidig });
    perNummer.set(r.nr, lijst);
  }

  const botsingen: KoppelResultaat["botsingen"] = [];
  const teZetten: { id: string; nr: string }[] = [];
  let ongewijzigd = 0;

  for (const [nr, lijst] of perNummer) {
    if (lijst.length > 1) {
      botsingen.push({ artikelNummer: nr, handles: lijst.map((x) => x.handle) });
      continue;
    }
    if (lijst[0].huidig === nr) ongewijzigd += 1;
    else teZetten.push({ id: lijst[0].id, nr });
  }

  if (!droogdraaien) await schrijfNummers(teZetten);

  return { bekeken: rijen.length, gekoppeld: teZetten.length, ongewijzigd, zonderMatch: 0, botsingen, bron: "attributen" };
}

/**
 * De echte koppeling: haal het SRS-productenbestand op, match de barcodes op
 * onze sku's, en schrijf artikelnummer + kleur-id + gezien-op per product.
 *
 * Eén SRS-rij is één BARCODE (dus één maat); een product bij ons is
 * artikelnummer + kleur. We nemen daarom per product de meest voorkomende
 * combinatie over zijn varianten — niet de eerste. Staat één maat verkeerd in
 * SRS, dan wint de rest nog steeds. Zie meestVoorkomend() in de regels.
 */
export async function koppelUitSrs(
  { delta = false, droogdraaien = false }: { delta?: boolean; droogdraaien?: boolean } = {},
): Promise<KoppelResultaat | { error: string }> {
  const feed = await haalSrsArtikelen({ delta });
  if (!feed.ok) return { error: feed.error };

  /* barcode → { nr, kleur }. De feed is de waarheid; bij een dubbele barcode
     wint de laatste regel. (SRS levert die niet dubbel, maar aannemen dat iets
     niet voorkomt is precies hoe je het een keer meemaakt.) */
  const opBarcode = new Map<string, { nr: string; kleur: string }>();
  for (const r of feed.rijen) {
    if (r.barcode && r.artikelNummer) opBarcode.set(r.barcode, { nr: r.artikelNummer, kleur: r.kleurId });
  }

  const db = getDb();
  const varianten = (
    await db.execute<{ product_id: string; sku: string; huidig_nr: string; huidig_kleur: string }>(sql`
      select v.product_id, v.sku,
             coalesce(p.srs_artikel_nummer, '') huidig_nr, coalesce(p.srs_kleur_id, '') huidig_kleur
      from product_variants v join products p on p.id = v.product_id
      where coalesce(v.sku, '') <> '' and p.status <> 'archived'`)
  ).rows;

  const perProduct = new Map<string, { huidigNr: string; huidigKleur: string; paren: { nr: string; kleur: string }[] }>();
  for (const v of varianten) {
    const hit = opBarcode.get(v.sku);
    if (!hit) continue;
    const p = perProduct.get(v.product_id) ?? { huidigNr: v.huidig_nr, huidigKleur: v.huidig_kleur, paren: [] };
    p.paren.push(hit);
    perProduct.set(v.product_id, p);
  }

  const teZetten: { id: string; nr: string; kleur: string }[] = [];
  let ongewijzigd = 0;
  for (const [id, p] of perProduct) {
    const beste = meestVoorkomend(p.paren);
    if (!beste) continue;
    if (p.huidigNr === beste.nr && p.huidigKleur === beste.kleur) ongewijzigd += 1;
    else teZetten.push({ id, nr: beste.nr, kleur: beste.kleur });
  }

  if (!droogdraaien) await schrijfNummers(teZetten, true);

  /* Producten die we bekeken maar niet in de feed vonden. Bij een delta-run zegt
     dat niets (die bevat alleen wijzigingen); bij een volledige run wél — dan
     kent SRS het artikel niet meer. */
  const bekeken = new Set(varianten.map((v) => v.product_id)).size;
  return { bekeken, gekoppeld: teZetten.length, ongewijzigd, zonderMatch: bekeken - perProduct.size, botsingen: [], bron: "srs" };
}

/**
 * Schrijft in blokken van 500. `metKleur` zet ook het kleur-id en stempelt
 * `srs_gezien_op` — dat laatste alleen bij de SRS-weg, want het betekent
 * letterlijk "vandaag in de feed gezien".
 */
async function schrijfNummers(rijen: { id: string; nr: string; kleur?: string }[], metKleur = false): Promise<void> {
  if (!rijen.length) return;
  const db = getDb();
  for (let i = 0; i < rijen.length; i += 500) {
    const blok = rijen.slice(i, i + 500);
    const waarden = blok.map((r) => sql`(${r.id}::uuid, ${r.nr}::text, ${r.kleur ?? ""}::text)`);
    await db.execute(sql`
      update products p set
        srs_artikel_nummer = b.nr,
        ${metKleur ? sql`srs_kleur_id = b.kleur, srs_gezien_op = now(),` : sql``}
        updated_at = now()
      from (values ${sql.join(waarden, sql`, `)}) as b(id, nr, kleur)
      where p.id = b.id`);
  }
}

/** Hoe ver staat de koppeling — voor het scherm en de controle achteraf. */
export async function koppelStand(): Promise<{
  totaal: number;
  metNummer: number;
  metKleur: number;
  gezienInSrs: number;
  laatstGezien: string | null;
}> {
  const db = getDb();
  const r = (
    await db.execute<{ totaal: number; met_nummer: number; met_kleur: number; gezien: number; laatst: string | null }>(sql`
      select count(*)::int totaal,
             count(*) filter (where coalesce(srs_artikel_nummer,'') <> '')::int met_nummer,
             count(*) filter (where coalesce(srs_kleur_id,'') <> '')::int met_kleur,
             count(*) filter (where srs_gezien_op is not null)::int gezien,
             to_char(max(srs_gezien_op), 'YYYY-MM-DD HH24:MI') laatst
      from products where status <> 'archived'`)
  ).rows[0];
  return {
    totaal: r?.totaal ?? 0,
    metNummer: r?.met_nummer ?? 0,
    metKleur: r?.met_kleur ?? 0,
    gezienInSrs: r?.gezien ?? 0,
    laatstGezien: r?.laatst ?? null,
  };
}
