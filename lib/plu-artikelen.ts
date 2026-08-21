/**
 * StorePos-PLU → PIM: de RESERVE-ROUTE voor nieuwe artikelen (21 aug 2026).
 *
 * WAAROM. SRS' product-export (get_product_info) geeft sinds 19-8 HTTP 500,
 * waardoor de nachtelijke artikelen-import stilstaat. StorePos zelf heeft daar
 * géén last van: elke kassa-pc downloadt 's ochtends een PLU-bestand en laadt
 * dat in een lokale Postgres (tabel `artikel`, ±178k rijen — barcode, artikel,
 * omschrijving, groep, kleur, maat, prijzen). De kassa-agent leest die tabel
 * uit (alleen-lezen) en de kassa uploadt 'm hierheen naar `plu_catalog`.
 *
 * Deze module maakt daar vervolgens ontbrekende artikelen uit aan, via EXACT
 * dezelfde kern als de SRS-import (maakUitRijen): nooit aanmaken als een
 * barcode al bestaat, één product per (artikelnummer, kleur-id), status draft.
 *
 * VOORLOPIG STANDAARD DROOGDRAAIEN. De PLU-kolommen label1/2/3 en klr_id zijn
 * nog niet tegen echte data geverifieerd (het PLU-bestand is versleuteld; pas
 * na de eerste upload zien we echte rijen). Tot die controle maakt dit pad
 * niets aan tenzij expliciet om gevraagd — een preview verschijnt wel in de
 * import-status, zodat meteen te zien is wat er WEL zou worden aangemaakt.
 */

import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { maakUitRijen, type SrsArtikel, type UitRijenResultaat } from "@/lib/srs-artikelen";

const clean = (v: unknown) => String(v ?? "").trim();

type PluRij = {
  barcode: string;
  art_id: string;
  art_nr: string;
  oms: string;
  hoofdgroep: string;
  label1: string;
  label2: string;
  label3: string;
  leverancier_nr: string;
  size_oms: string;
  maatbalk: string;
  klr_id: string;
  prijs_cents: number;
};

/** PLU-rij → de vorm die de aanmaak-kern kent. Velden die de PLU niet heeft
 *  (merk, seizoen, foto's) blijven leeg — het draft-product komt dan vanzelf
 *  laag in de compleetheidsscore en dus in de PIM-werklijsten terecht. */
function naarArtikel(r: PluRij): SrsArtikel {
  return {
    artikelNummer: clean(r.art_nr),
    artikelId: clean(r.art_id),
    omschrijving: clean(r.oms),
    hoofdgroepId: "",
    hoofdgroep: clean(r.hoofdgroep),
    leverancier: clean(r.leverancier_nr),
    kleurId: clean(r.klr_id),
    /* Kleur-omschrijving: nog niet bewezen welk PLU-veld 'm draagt (klr_id kan
       een code zijn). Leeg laten is veilig — de kleur-code zit in kleurId en de
       labels reizen mee in het droogdraai-rapport voor de mapping-controle. */
    kleur: "",
    maat: clean(r.size_oms),
    barcode: clean(r.barcode),
    verkoopprijsCents: Math.max(0, Math.round(Number(r.prijs_cents) || 0)),
    merk: "",
    seizoen: "",
    jaar: "",
    materiaal: "",
    samenstelling: "",
    pasvorm: "",
    fotos: [],
  };
}

export async function vulUitPlu(
  { droogdraaien = true, max = 200 }: { droogdraaien?: boolean; max?: number } = {},
): Promise<UitRijenResultaat | { error: string }> {
  const db = getDb();
  const rows = (
    await db.execute<PluRij>(sql`
      select barcode, art_id, art_nr, oms, hoofdgroep, label1, label2, label3,
             leverancier_nr, size_oms, maatbalk, klr_id, prijs_cents
      from plu_catalog`)
  ).rows;
  /* Noodrem, zelfde gedachte als bij de SRS-feed: een "volledige" PLU met een
     handvol rijen is een mislukte upload, geen catalogus. */
  if (rows.length < 50000) {
    return { error: `PLU-staging bevat maar ${rows.length} rijen — aanmaken geweigerd (upload onvolledig?).` };
  }
  const rijen = rows.map(naarArtikel).filter((r) => r.barcode && r.artikelNummer);
  return maakUitRijen(rijen, { droogdraaien, max, bron: "STOREPOS-PLU" });
}
