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
import { products, productVariants, productImages } from "@/db/schema";
import { slugify } from "@/lib/catalog-import";
import { colorFamily } from "@/lib/colors";
import { sizeRowLabel } from "@/lib/size-taxonomy";
import { leesArtikelen, meestVoorkomend, normaliseerArtikelNummer } from "@/lib/srs-artikelen-regels";

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
  return Boolean(
    (process.env.SRS_PRODUCTINFO_USER || process.env.SRS_API_USER || process.env.SRS_API_USERNAME) &&
    (process.env.SRS_PRODUCTINFO_PASSWORD || process.env.SRS_API_PASSWORD),
  );
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
  /* SRS_PRODUCTINFO_* gaat vóór (19 aug): de bestaande SRS_API_USER in deze
     Vercel-omgeving kreeg een 403 op get_product_info — dat account heeft geen
     si_webshop-productinfo-rechten. De variabelen zijn sensitive (niet terug te
     lezen), dus overschrijven zou de huidige waarden onherstelbaar wissen en kan
     ánder SRS-verkeer breken. Daarom een eigen naam voor precies deze feed, met
     dezelfde inlog die storegents 's nachts al met succes gebruikt. */
  const user = process.env.SRS_PRODUCTINFO_USER || process.env.SRS_API_USER || process.env.SRS_API_USERNAME || "";
  const password = process.env.SRS_PRODUCTINFO_PASSWORD || process.env.SRS_API_PASSWORD || "";
  if (!user || !password) {
    return { ok: false, error: "SRS_API_USER en/of SRS_API_PASSWORD ontbreken (si_webshop)." };
  }
  /* SRS_API_BASE_URL staat eerst: zo heet de variabele in de Vercel-omgeving.
     De andere twee namen komen uit oudere storegents-code en blijven staan als
     wisselgeld — een koppeling die stilvalt omdat de variabele net anders heet
     is een uur zoeken naar niets. */
  const base = (
    process.env.SRS_PRODUCTINFO_BASE_URL ||
    process.env.SRS_API_BASE_URL ||
    process.env.SRS_WEBSERVICES_BASE_URL ||
    process.env.SRS_BASE_URL ||
    DEFAULT_BASE
  ).replace(/\/$/, "");
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

  /* Normaliseren naar de SRS-vorm (8 cijfers met voorloopnullen). Onze
     brondata heeft ze kaal; sla je dát op, dan matcht een latere vergelijking
     met SRS op niets. */
  const perNummer = new Map<string, { id: string; handle: string; huidig: string }[]>();
  for (const r of rijen) {
    const nr = normaliseerArtikelNummer(r.nr);
    const lijst = perNummer.get(nr) ?? [];
    lijst.push({ id: r.id, handle: r.handle, huidig: r.huidig });
    perNummer.set(nr, lijst);
  }

  const botsingen: KoppelResultaat["botsingen"] = [];
  const teZetten: { id: string; nr: string }[] = [];
  /* Bij een botsing weten we níet welk van de twee producten dit SRS-artikel is.
     Staat er dan toch nog een nummer (bijvoorbeeld uit een eerdere run, of in de
     oude ongepadde vorm), dan halen we het weg. De invariant blijft zo simpel:
     srs_artikel_nummer is leeg óf de canonieke SRS-vorm, en nooit dubbelzinnig.
     Een half-waar nummer laten staan betekent dat een latere koppeling stil het
     verkeerde product pakt. */
  const teWissen: string[] = [];
  let ongewijzigd = 0;

  for (const [nr, lijst] of perNummer) {
    if (lijst.length > 1) {
      botsingen.push({ artikelNummer: nr, handles: lijst.map((x) => x.handle) });
      for (const p of lijst) if (p.huidig) teWissen.push(p.id);
      continue;
    }
    if (lijst[0].huidig === nr) ongewijzigd += 1;
    else teZetten.push({ id: lijst[0].id, nr });
  }

  if (!droogdraaien) {
    await schrijfNummers(teZetten);
    await wisNummers(teWissen);
  }

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
    /* SRS levert 'm al gepad; normaliseren houdt beide wegen gelijk als dat
       ooit verandert. */
    if (r.barcode && r.artikelNummer) {
      opBarcode.set(r.barcode, { nr: normaliseerArtikelNummer(r.artikelNummer), kleur: r.kleurId });
    }
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

/** Haalt het artikelnummer weg bij producten waar het dubbelzinnig is. */
async function wisNummers(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = getDb();
  for (let i = 0; i < ids.length; i += 500) {
    const blok = ids.slice(i, i + 500).map((id) => sql`${id}::uuid`);
    await db.execute(sql`
      update products set srs_artikel_nummer = '', srs_kleur_id = '', updated_at = now()
      where id in (${sql.join(blok, sql`, `)})`);
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

/* ══════════════════════════════════════════════════════════════════════════
   3. Nieuwe artikelen AANMAKEN
   ══════════════════════════════════════════════════════════════════════════

   Koppelen (hierboven) verbindt wat er al is. Maar nieuwe collectie ligt soms
   eerder fysiek in de winkel dan in het PIM (Den Bosch, 19 aug: drager
   T000001298 met twee overhemden die nergens bestonden — niet te zien op het
   ontvangstscherm, niet te scannen, niet te verkopen). SRS kent ze dan al wél,
   compleet met omschrijving, kleur, maten, barcodes, prijs en leveranciersfoto's.

   Deze functie haalt precies die artikelen binnen als CONCEPT-product:

   - Eén product per (artikelnummer, kleur-id) — dezelfde korrel als de rest van
     de catalogus, en de unieke index op die twee kolommen bewaakt het.
   - status 'draft': de site toont niets totdat content het artikel afmaakt. De
     compleetheidsscore is laag (geen tekst, geen SEO) — zo verschijnt het
     vanzelf in de PIM-werklijsten.
   - attributes.bron = 'SRS' → daar filtert de productenlijst op ("Herkomst"),
     zodat content de verse instroom als werklijst kan pakken.
   - sku = de SRS-barcode (29…): dat is de join-sleutel naar voorraad, kassa en
     goederenontvangst. `barcode` (leveranciers-EAN) kennen we hier niet → leeg.

   NOOIT aanmaken als er al iets van het artikel bestaat: een groep waarvan ook
   maar één barcode als variant-sku voorkomt is een KOPPEL-kwestie, geen
   aanmaak-kwestie — anders ontstaan duplicaten naast het bestaande product. */

export type NieuwArtikelResultaat = {
  feedRijen: number;
  kandidaten: number;
  aangemaakt: number;
  varianten: number;
  /** Kandidaten die deze run niet meegingen (max bereikt) — volgende run pakt ze. */
  restant: number;
  producten: { handle: string; titel: string; kleur: string; varianten: number }[];
  droogdraaien: boolean;
  /** true = deze run draaide op de delta-feed (laatste 72u) i.p.v. de volledige export. */
  delta: boolean;
};

export async function maakNieuweArtikelen(
  { droogdraaien = false, max = 200, delta = false }: { droogdraaien?: boolean; max?: number; delta?: boolean } = {},
): Promise<NieuwArtikelResultaat | { error: string }> {
  /* DELTA-MODUS (Kevin, 19 aug: "kan jij dat niet nabouwen [zoals StorePos]"):
     StorePos leeft ín SRS en ziet nieuwe artikelen meteen; het dichtst daarbij
     komt overdag de kleine delta-export (laatste 72u) elke paar uur pollen —
     een vandaag ingeboekt artikel staat dan binnen ~2 uur in het PIM i.p.v.
     morgenochtend. Zelfde aanmaak-machinerie en dezelfde veiligheden; alleen de
     noodrem hieronder geldt niet (een delta van een rustige dag is legitiem
     klein of zelfs leeg). */
  const feed = await haalSrsArtikelen({ delta });
  if (!feed.ok) return { error: feed.error };
  /* Noodrem, zelfde gedachte als bij de products-cache: een "volledige" feed met
     een handvol rijen is een storing bij SRS, geen catalogus — en zou hier
     hooguit troep aanmaken. Geldt alleen voor de volledige export: een delta is
     legitiem klein (of leeg op een rustige dag). */
  if (!delta && feed.rijen.length < 1000) {
    return { error: `SRS-feed bevat maar ${feed.rijen.length} rijen — aanmaken geweigerd (storing?).` };
  }

  const kern = await maakUitRijen(feed.rijen, { droogdraaien, max });
  return { feedRijen: feed.rijen.length, delta, ...kern };
}

/** Resultaat van de aanmaak-kern, zonder de feed-specifieke velden. */
export type UitRijenResultaat = Omit<NieuwArtikelResultaat, "feedRijen" | "delta">;

/**
 * De AANMAAK-KERN, losgetrokken uit maakNieuweArtikelen (21 aug) zodat 'ie ook
 * op andere bronnen kan draaien — concreet de StorePos-PLU-catalogus
 * (lib/plu-artikelen.ts), de reserveroute nu SRS' eigen export stuk is. Alle
 * veiligheden zitten HIER: nooit aanmaken als één barcode al als variant-sku
 * bestaat, één product per (artikelnummer, kleur-id), status draft, en
 * attributes.bron vertelt waar het vandaan kwam.
 */
export async function maakUitRijen(
  bronRijen: SrsArtikel[],
  { droogdraaien = false, max = 200, bron = "SRS" }: { droogdraaien?: boolean; max?: number; bron?: string } = {},
): Promise<UitRijenResultaat> {
  const db = getDb();
  /* Wat we al kennen. Sku's als Set in het geheugen: ~23k strings, en dan is de
     controle per groep een lookup i.p.v. een query per artikel. */
  const bekendeSkus = new Set(
    (await db.execute<{ sku: string }>(sql`select sku from product_variants where coalesce(sku, '') <> ''`)).rows.map((r) => r.sku),
  );
  const bekendeParen = new Set(
    (
      await db.execute<{ nr: string; kleur: string }>(sql`
        select srs_artikel_nummer nr, coalesce(srs_kleur_id, '') kleur
        from products where coalesce(srs_artikel_nummer, '') <> ''`)
    ).rows.map((r) => `${r.nr}|${r.kleur}`),
  );
  const bestaandeHandles = new Set(
    (await db.execute<{ handle: string }>(sql`select handle from products`)).rows.map((r) => r.handle),
  );

  /* Groepeer de bron op (artikelnummer, kleur-id); binnen een groep wint per
     barcode de laatste rij (zelfde afspraak als bij het koppelen). */
  const groepen = new Map<string, Map<string, SrsArtikel>>();
  for (const r of bronRijen) {
    if (!r.barcode || !r.artikelNummer) continue;
    const key = `${normaliseerArtikelNummer(r.artikelNummer)}|${r.kleurId || ""}`;
    const g = groepen.get(key) ?? new Map<string, SrsArtikel>();
    g.set(r.barcode, r);
    groepen.set(key, g);
  }

  const nieuw: { key: string; rijen: SrsArtikel[] }[] = [];
  for (const [key, g] of groepen) {
    if (bekendeParen.has(key)) continue;
    const rijen = [...g.values()];
    if (rijen.some((r) => bekendeSkus.has(r.barcode))) continue;
    nieuw.push({ key, rijen });
  }

  const teDoen = nieuw.slice(0, Math.max(1, max));
  const resultaat: UitRijenResultaat = {
    kandidaten: nieuw.length,
    aangemaakt: 0,
    varianten: 0,
    restant: Math.max(0, nieuw.length - teDoen.length),
    producten: [],
    droogdraaien,
  };

  for (const { key, rijen } of teDoen) {
    const [nr, kleurId] = key.split("|");
    /* De meest voorkomende waarde over de groep, niet de eerste: staat één maat
       verkeerd in SRS, dan wint de rest (zelfde regel als bij het koppelen). */
    const vaakst = (kies: (r: SrsArtikel) => string): string => {
      const telling = new Map<string, number>();
      for (const r of rijen) {
        const v = (kies(r) || "").trim();
        if (v) telling.set(v, (telling.get(v) || 0) + 1);
      }
      let beste = "";
      let hoogste = 0;
      for (const [v, n] of telling) {
        if (n > hoogste) {
          beste = v;
          hoogste = n;
        }
      }
      return beste;
    };

    const omschrijving = vaakst((r) => r.omschrijving);
    const kleur = vaakst((r) => r.kleur);
    const hoofdgroep = vaakst((r) => r.hoofdgroep);
    const titel = omschrijving || `Artikel ${nr}`;

    /* Handle: leesbaar waar het kan, gegarandeerd uniek waar het moet. */
    const basis = slugify(titel) || `artikel-${nr}`;
    let handle = basis;
    if (bestaandeHandles.has(handle) && kleur) handle = `${basis}-${slugify(kleur)}`;
    if (bestaandeHandles.has(handle)) handle = `${basis}-${nr.replace(/^0+/, "") || nr}`;
    if (bestaandeHandles.has(handle)) continue; // dan is er écht iets vreemds — overslaan, volgende run kijkt opnieuw
    bestaandeHandles.add(handle);

    /* Alleen gevulde attributen: de facetten tonen '(leeg)' voor wat ontbreekt,
       en een lege sleutel erin schrijven maakt dat niet beter. */
    const attributes: Record<string, string> = { bron };
    const zet = (k: string, v: string) => {
      if ((v || "").trim()) attributes[k] = v.trim();
    };
    zet("artikel_nummer", nr);
    zet("artikel_id", vaakst((r) => r.artikelId));
    zet("hoofdgroep_id", vaakst((r) => r.hoofdgroepId));
    zet("hoofdgroep_omschrijving", hoofdgroep);
    zet("merk", vaakst((r) => r.merk));
    zet("jaar", vaakst((r) => r.jaar));
    zet("seizoen", vaakst((r) => r.seizoen));
    zet("materiaal", vaakst((r) => r.materiaal));
    zet("samenstelling", vaakst((r) => r.samenstelling));
    zet("pasvorm", vaakst((r) => r.pasvorm));

    const fotos = [...new Set(rijen.flatMap((r) => r.fotos || []))].slice(0, 6);

    resultaat.aangemaakt += 1;
    resultaat.varianten += rijen.length;
    resultaat.producten.push({ handle, titel, kleur, varianten: rijen.length });
    if (droogdraaien) continue;

    const [product] = await db
      .insert(products)
      .values({
        handle,
        title: titel,
        vendor: vaakst((r) => r.merk) || vaakst((r) => r.leverancier),
        status: "draft",
        attributes,
        srsArtikelNummer: nr,
        srsKleurId: kleurId,
        srsGezienOp: new Date(),
        variantColorLabel: kleur,
        hasImage: fotos.length > 0,
      })
      .returning({ id: products.id });

    await db.insert(productVariants).values(
      rijen.map((r, i) => ({
        productId: product.id,
        sku: r.barcode, // de SRS-barcode is de sku — zie de kolomdocumentatie
        barcode: "", // leveranciers-EAN onbekend; NOOIT de sku hierin zetten
        position: i,
        size: r.maat || "",
        sizeLabel: r.maat ? sizeRowLabel(r.maat, hoofdgroep) : "",
        color: r.kleur || kleur,
        colorFamily: r.kleur || kleur ? colorFamily(r.kleur || kleur) : "",
        priceCents: r.verkoopprijsCents || 0,
        srsArtikelId: r.artikelId || "",
      })),
    );

    if (fotos.length) {
      await db.insert(productImages).values(
        fotos.map((url, i) => ({ productId: product.id, url, alt: titel, position: i })),
      );
    }
  }

  return resultaat;
}
