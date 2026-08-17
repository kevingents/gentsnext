import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customerProfiles } from "@/db/schema";
import { brandedEmailHtml, sendEmail } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";
import { formatEuro } from "@/lib/format";

/**
 * De sjablonen die een flow kan versturen.
 *
 * Bewust een vaste lijst en geen vrije HTML uit de database: een flow-definitie
 * wordt in de portal geklikt, en wie daar willekeurige HTML mag invoeren kan
 * ook een phishingmail versturen op ons afzenderadres. De flow kiest een
 * sjabloon; wat erin staat blijft code.
 *
 * Elk sjabloon haalt zelf op wat het nodig heeft uit het klantprofiel. Dat is
 * bewust: een flow die persoonsgegevens moet doorgeven zou die in de
 * flow-toestand opslaan, en dan staat er een kopie van het klantbeeld op een
 * plek waar niemand hem onderhoudt.
 */

export type FlowSjabloon =
  | "kar-herinnering"
  | "kar-laatste-kans"
  | "eerste-aankoop-bedankt"
  | "tweede-aankoop-advies"
  | "maatprofiel-uitnodiging"
  | "terugwin"
  | "punten-herinnering";

type Profiel = {
  punten_beschikbaar: number;
  tegoed_cents: number;
  favoriete_winkel: string;
  maatprofiel: boolean;
  laatst_bekeken: string[];
};

async function profiel(customerId: string): Promise<Profiel | null> {
  const db = getDb();
  const r = await db.execute<Profiel>(sql`
    select punten_beschikbaar, tegoed_cents, favoriete_winkel, maatprofiel,
           coalesce(laatst_bekeken, '[]'::jsonb) laatst_bekeken
    from ${customerProfiles} where customer_id = ${customerId}::uuid
  `);
  return r.rows[0] ?? null;
}

/** "Hallo Kevin" of "Hallo" — nooit "Hallo ," bij een lege naam. */
const hallo = (naam: string) => (naam.trim() ? `Hallo ${naam.trim()}` : "Hallo");

export async function sendFlowEmail(
  sjabloon: FlowSjabloon,
  email: string,
  voornaam: string,
  customerId: string,
): Promise<boolean> {
  const site = getSiteUrl();
  const p = await profiel(customerId);

  switch (sjabloon) {
    case "kar-herinnering":
      return sendEmail(
        email,
        "Je hebt nog iets klaarstaan",
        brandedEmailHtml({
          heading: hallo(voornaam),
          bodyHtml: `<p>Je liet iets in je winkelwagen achter. We hebben het voor je bewaard —
            je kunt zo verder waar je gebleven was.</p>
            ${p?.favoriete_winkel ? `<p>Liever even passen? Het ligt mogelijk ook in ${p.favoriete_winkel}.</p>` : ""}`,
          cta: { label: "Verder winkelen", href: `${site}/winkelwagen` },
        }),
      );

    case "kar-laatste-kans":
      return sendEmail(
        email,
        "Nog steeds interesse?",
        brandedEmailHtml({
          heading: hallo(voornaam),
          // Bewust géén korting. Wie een paar dagen wacht en dan korting krijgt,
          // leert wachten — en dan betaal je voortaan voor omzet die er toch al was.
          bodyHtml: `<p>Je winkelwagen staat er nog. Twijfel je over de maat, dan denken we graag mee:
            in onze winkels meten we je op, en online helpt het maatadvies je verder.</p>`,
          cta: { label: "Bekijk je winkelwagen", href: `${site}/winkelwagen` },
          footnote: "Liever niet meer? Onderaan elke mail staat een afmeldlink.",
        }),
      );

    case "eerste-aankoop-bedankt":
      return sendEmail(
        email,
        "Bedankt voor je eerste bestelling",
        brandedEmailHtml({
          heading: hallo(voornaam),
          bodyHtml: `<p>Je eerste bestelling bij GENTS is onderweg. Fijn dat je ons gevonden hebt.</p>
            <p>Eén tip die de meeste retouren voorkomt: geef je maten door. Dan zie je voortaan
            meteen wat er in jouw maat ligt, en vullen we ze bij een volgende bestelling vast in.</p>`,
          cta: { label: "Maten doorgeven", href: `${site}/account` },
        }),
      );

    case "tweede-aankoop-advies":
      return sendEmail(
        email,
        "Past hier goed bij",
        brandedEmailHtml({
          heading: hallo(voornaam),
          bodyHtml: `<p>Je bestelde onlangs bij ons. Bij wat je koos hoort meestal nog iets:
            een overhemd onder een colbert, een das bij een pak, of schoenen die erbij kleuren.</p>
            <p>We hebben een paar combinaties klaargezet die passen bij wat je hebt.</p>`,
          cta: { label: "Bekijk de combinaties", href: `${site}/looks` },
        }),
      );

    case "maatprofiel-uitnodiging":
      return sendEmail(
        email,
        "Zo weten we wat jou past",
        brandedEmailHtml({
          heading: hallo(voornaam),
          bodyHtml: `<p>We kennen je maten nog niet. Zonder die gegevens kunnen we niet laten zien
            wat er echt in jouw maat ligt — en dat is precies waar de meeste retouren vandaan komen.</p>
            <p>Het invullen kost een minuut en levert je spaarpunten op.</p>`,
          cta: { label: "Maten invullen", href: `${site}/account` },
        }),
      );

    case "terugwin": {
      const tegoed = p?.tegoed_cents ?? 0;
      const punten = p?.punten_beschikbaar ?? 0;
      // Alleen noemen wat er écht staat: "je hebt 0 punten" is geen argument.
      const extra =
        tegoed > 0
          ? `<p>Je hebt trouwens nog <strong>${formatEuro(tegoed)}</strong> aan tegoed openstaan.</p>`
          : punten >= 100
            ? `<p>Je hebt nog <strong>${punten.toLocaleString("nl-NL")} spaarpunten</strong> staan.</p>`
            : "";
      return sendEmail(
        email,
        "We hebben je een tijdje niet gezien",
        brandedEmailHtml({
          heading: hallo(voornaam),
          bodyHtml: `<p>Er is sinds je laatste bezoek het nodige veranderd in de collectie.</p>${extra}
            ${p?.favoriete_winkel ? `<p>Je bent altijd welkom in ${p.favoriete_winkel} voor persoonlijk advies.</p>` : ""}`,
          cta: { label: "Bekijk de nieuwe collectie", href: `${site}/collections/nieuwe-collectie-gents` },
        }),
      );
    }

    case "punten-herinnering":
      return sendEmail(
        email,
        "Je spaarpunten staan klaar",
        brandedEmailHtml({
          heading: hallo(voornaam),
          bodyHtml: `<p>Je hebt <strong>${(p?.punten_beschikbaar ?? 0).toLocaleString("nl-NL")} spaarpunten</strong>
            staan bij The Club of GENTS. Die zijn van jou en verlopen niet — maar ze doen ook niets
            zolang je ze niet gebruikt.</p>`,
          cta: { label: "Bekijk je punten", href: `${site}/account` },
        }),
      );

    default:
      return false;
  }
}
