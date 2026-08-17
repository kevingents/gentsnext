import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, mailEngagement } from "@/db/schema";
import { koppelIdentiteit } from "@/lib/identity";

/**
 * Import van de Spotler-export (CSV) — de weg om de API heen.
 *
 * De REST-API bleek onbruikbaar voor bulk: `GET contact` geeft er 250 en
 * bladert niet, en het filter wordt genegeerd. De export uit Spotler zelf lost
 * dat in één keer op.
 *
 * Gemeten op de echte export (1.687.715 rijen): 252.997 profielen met een
 * e-mailadres, en daarvan is 98,8% van ONS klantbestand terug te vinden —
 * 47.946 van 48.507. Wat dat oplevert dat we niet hadden:
 *
 *     SRS-klantnummer   39.073   (in de database: 633)
 *     postcode          42.286   (26.679)
 *     telefoon          18.431
 *     nieuwsbrief=ja    19.533
 *     geslacht          15.587
 *     verjaardag         2.826   (1)
 *
 * Het SRS-klantnummer is de belangrijkste: dat is de brug web ↔ winkel waar het
 * hele omnichannel-deel van het profiel op wacht.
 *
 *   npm run import:spotler -- <pad-naar-export.csv> [--proef]
 *
 * Streamt regel voor regel; het bestand is 344 MB en past niet in het geheugen.
 * Idempotent: alles gaat via upsert, en bestaande waarden worden alleen
 * aangevuld, nooit overschreven — wat de klant zelf bij ons invulde is leidend.
 */

const PROEF = process.argv.includes("--proef");
const PAD = process.argv.find((a) => a.endsWith(".csv"));

/** CSV-splitser die quotes respecteert; velden bevatten komma's (audience_names). */
function splitsCsv(regel: string): string[] {
  const uit: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < regel.length; i++) {
    const c = regel[i];
    if (c === '"') {
      if (inQuote && regel[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuote = !inQuote;
    } else if (c === "," && !inQuote) {
      uit.push(cur);
      cur = "";
    } else cur += c;
  }
  uit.push(cur);
  return uit;
}

/** jjjj-mm-dd, niet in de toekomst, niet vóór 1900 — anders null. */
function datum(raw: string): string | null {
  const s = (raw || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  if (d > new Date() || d < new Date("1900-01-01")) return null;
  return s;
}

type Rij = {
  email: string;
  verjaardag: string | null;
  geslacht: string;
  mobiel: string;
  postcode: string;
  plaats: string;
  srs: string;
  afgemeld: boolean;
  nieuwsbriefSpotler: string;
  fase: string;
  doelgroepen: string;
};

async function main() {
  if (!PAD) throw new Error("Geef het pad naar de Spotler-export mee (.csv).");
  const db = getDb();

  // Onze klanten één keer inlezen: 48k e-mailadressen in het geheugen is niets,
  // en het scheelt 250.000 losse lookups tijdens het streamen.
  const klantRijen = await db.execute<{ id: string; email: string }>(
    sql`select id, lower(email) email from ${customers} where trim(email) <> ''`,
  );
  const klantPerMail = new Map(klantRijen.rows.map((r) => [r.email, r.id]));
  console.log(`Onze klanten: ${klantPerMail.size.toLocaleString("nl-NL")}`);

  const rl = createInterface({ input: createReadStream(PAD, { encoding: "utf8" }), crlfDelay: Infinity });
  let kop: string[] | null = null;
  const idx: Record<string, number> = {};
  let gelezen = 0;
  let gematcht = 0;
  let zonderSrs = 0;
  const buffer: Rij[] = [];
  const telling = { srs: 0, verjaardag: 0, geslacht: 0, mobiel: 0, postcode: 0, nieuwsbriefJa: 0 };

  const wegschrijven = async () => {
    if (!buffer.length || PROEF) {
      buffer.length = 0;
      return;
    }
    // Ontdubbelen: Spotler kan hetzelfde adres meerdere keren bevatten, en
    // Postgres weigert ON CONFLICT DO UPDATE met dezelfde sleutel in één batch.
    const perMail = new Map(buffer.map((r) => [r.email, r]));
    const rijen = [...perMail.values()];

    await db
      .insert(mailEngagement)
      .values(
        rijen.map((r) => ({
          email: r.email,
          bron: "spotler-export",
          customerId: klantPerMail.get(r.email) ?? null,
          afgemeld: r.afgemeld,
          verjaardag: r.verjaardag,
          geslacht: r.geslacht,
          mobiel: r.mobiel,
          postcode: r.postcode,
          plaats: r.plaats,
          spotlerNieuwsbrief: r.nieuwsbriefSpotler,
          spotlerFase: r.fase,
          spotlerDoelgroepen: r.doelgroepen,
        })),
      )
      .onConflictDoUpdate({
        target: mailEngagement.email,
        set: {
          // Aanvullen, niet overschrijven: wat we al hadden is meestal
          // recenter of door de klant zelf opgegeven.
          verjaardag: sql`coalesce(${mailEngagement.verjaardag}, excluded.verjaardag)`,
          geslacht: sql`coalesce(nullif(${mailEngagement.geslacht}, ''), excluded.geslacht)`,
          mobiel: sql`coalesce(nullif(${mailEngagement.mobiel}, ''), excluded.mobiel)`,
          postcode: sql`coalesce(nullif(${mailEngagement.postcode}, ''), excluded.postcode)`,
          plaats: sql`coalesce(nullif(${mailEngagement.plaats}, ''), excluded.plaats)`,
          spotlerNieuwsbrief: sql`excluded.spotler_nieuwsbrief`,
          spotlerFase: sql`excluded.spotler_fase`,
          spotlerDoelgroepen: sql`excluded.spotler_doelgroepen`,
          customerId: sql`coalesce(${mailEngagement.customerId}, excluded.customer_id)`,
          bijgewerktOp: sql`now()`,
        },
      });

    // SRS-klantnummers: alleen waar het nog leeg is. Een bestaand nummer
    // overschrijven zou een handmatige correctie ongedaan maken.
    const metSrs = rijen.filter((r) => r.srs && klantPerMail.has(r.email));
    for (const r of metSrs) {
      const uit = await db
        .update(customers)
        .set({ srsCustomerId: r.srs, updatedAt: sql`now()` })
        .where(sql`lower(${customers.email}) = ${r.email} and coalesce(${customers.srsCustomerId}, '') = ''`)
        .returning({ id: customers.id });
      if (uit.length) await koppelIdentiteit(uit[0].id, "srs", r.srs, { bron: "spotler-export" });
    }
    buffer.length = 0;
  };

  for await (const regel of rl) {
    if (!kop) {
      kop = splitsCsv(regel);
      kop.forEach((k, i) => (idx[k.trim()] = i));
      continue;
    }
    if (!regel.trim()) continue;
    gelezen++;
    const r = splitsCsv(regel);
    const v = (k: string) => (r[idx[k]] ?? "").trim();

    const email = v("email").toLowerCase();
    if (!email.includes("@")) continue;
    // Alleen ónze klanten. De andere 205.000 Spotler-profielen zijn winkel- en
    // nieuwsbriefcontacten zonder webaccount; die hier binnenhalen zou een
    // tweede klantenbestand maken naast het echte.
    if (!klantPerMail.has(email)) continue;

    /* En alleen wie een SRS-KLANTNUMMER heeft (Kevin, 13 aug). Dat nummer is
     * het bewijs dat deze persoon ook echt in de winkeladministratie bestaat.
     * Zonder nummer is het een los Spotler-profiel — dan nemen we er niets van
     * over, ook geen verjaardag of postcode. Dat scheelt 8.873 mensen van wie
     * we persoonsgegevens zouden opslaan zonder dat er een winkelrelatie
     * tegenover staat.
     *
     * Deze regel staat vóór alle andere velden en niet erna: hij bepaalt of we
     * het record überhaupt aanraken, niet welke kolom we vullen.
     */
    const srsNummer = v("custom_srsklantnummer").trim();
    if (!srsNummer) {
      zonderSrs++;
      continue;
    }
    gematcht++;

    const geslacht = v("gender");
    const rij: Rij = {
      email,
      verjaardag: datum(v("birthdate")),
      geslacht: geslacht === "U" ? "" : geslacht.slice(0, 20),
      mobiel: v("phone").slice(0, 40),
      postcode: v("zipcode").slice(0, 20),
      plaats: v("city").slice(0, 120),
      srs: srsNummer.slice(0, 40),
      /* BEWUST NIET als afmelding opslaan.
       *
       * Eerst deed dit `newsletter=no && optin=no` → afgemeld, wat op 20.896
       * van de 39.073 uitkwam. Maar in de héle export staat 96% op `no`
       * (1.628.406 van 1.687.715). Dat is niet "uitgeschreven" maar "nooit
       * ingeschreven" — en die twee door elkaar halen zou tienduizenden mensen
       * een opt-out geven die ze nooit hebben gegeven. Andersom net zo erg:
       * iemand die écht afmeldde tóch mailen.
       *
       * De export kent het verschil niet, dus we bewaren de rauwe stand en
       * beslissen er hier niets op. `newsletter=yes` is wél harde POSITIEVE
       * toestemming; dat is de kant die veilig is om te gebruiken.
       */
      nieuwsbriefSpotler: v("newsletter").toLowerCase() === "yes" ? "yes" : "no",
      afgemeld: false,
      fase: v("customer_phase").slice(0, 40),
      doelgroepen: v("audience_names").slice(0, 500),
    };
    if (rij.srs) telling.srs++;
    if (rij.verjaardag) telling.verjaardag++;
    if (rij.geslacht) telling.geslacht++;
    if (rij.mobiel) telling.mobiel++;
    if (rij.postcode) telling.postcode++;
    if (rij.nieuwsbriefSpotler === "yes") telling.nieuwsbriefJa++;

    buffer.push(rij);
    if (buffer.length >= 500) await wegschrijven();
    if (gematcht % 5000 === 0) process.stdout.write(`\r  ${gelezen.toLocaleString("nl-NL")} gelezen · ${gematcht.toLocaleString("nl-NL")} eigen klanten…`);
  }
  await wegschrijven();
  process.stdout.write("\n");

  console.log(`\nGelezen: ${gelezen.toLocaleString("nl-NL")} · eigen klanten: ${gematcht.toLocaleString("nl-NL")}`);
  console.log(PROEF ? "PROEF — niets weggeschreven.\n" : "Weggeschreven.\n");
  for (const [k, n] of Object.entries(telling)) console.log(`  ${k.padEnd(12)} ${n.toLocaleString("nl-NL")}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
