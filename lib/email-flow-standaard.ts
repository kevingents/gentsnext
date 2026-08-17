import type { Stap } from "@/lib/email-flows";
import type { RegelGroep } from "@/lib/audience-regels";

/**
 * De startflows.
 *
 * Elke flow hieronder heeft een uitstapregel die je bijna gratis krijgt maar
 * die het verschil maakt tussen een journey en een spamkanon: zodra de klant
 * heeft gedaan waar de flow om vraagt, stapt hij eruit. Een mail "je vergat
 * iets in je winkelwagen" ná de aankoop laat zien dat je niet weet wat hij
 * deed, en dat is schadelijker dan geen mail.
 *
 * De wachttijden zijn bewust ruim. Vier uur na het verlaten van een winkelwagen
 * is de klant vaak nog aan het vergelijken; een mail binnen het uur leest als
 * meekijken over de schouder.
 */

export type FlowDefinitie = {
  slug: string;
  naam: string;
  omschrijving: string;
  triggerSoort: "doelgroep" | "gebeurtenis";
  triggerDoelgroepSlug?: string;
  triggerEvent?: string;
  stappen: Stap[];
  uitstap: RegelGroep;
  herhaalbaar: boolean;
  herhaalNaDagen: number;
};

const en = (...regels: RegelGroep["regels"]): RegelGroep => ({ op: "en", regels });
const of = (...regels: RegelGroep["regels"]): RegelGroep => ({ op: "of", regels });

export const STANDAARD_FLOWS: FlowDefinitie[] = [
  {
    slug: "winkelwagen-verlaten",
    naam: "Winkelwagen laten staan",
    omschrijving:
      "Twee mails na een achtergelaten winkelwagen: een herinnering na 4 uur en een laatste na 3 dagen. " +
      "Bewust géén korting in de tweede — wie leert dat wachten korting oplevert, wacht voortaan altijd, " +
      "en dan betaal je voor omzet die er toch al was.",
    triggerSoort: "doelgroep",
    triggerDoelgroepSlug: "winkelwagen-verlaten-7d",
    stappen: [
      { soort: "wacht", uren: 4 },
      { soort: "mail", sjabloon: "kar-herinnering" },
      { soort: "wacht", uren: 68 },
      { soort: "mail", sjabloon: "kar-laatste-kans" },
    ],
    // Kocht hij inmiddels? Eruit. Dit is de belangrijkste regel van de hele set.
    uitstap: en({ veld: "dagen_sinds_aankoop", operator: "hoogstens", waarde: 1 }),
    herhaalbaar: true,
    herhaalNaDagen: 30,
  },
  {
    slug: "na-eerste-aankoop",
    naam: "Na de eerste aankoop",
    omschrijving:
      "Bedankt + de vraag om maten door te geven, en twee weken later passend advies. " +
      "De tweede aankoop is het scharnierpunt: wie twee keer koopt blijft meestal.",
    triggerSoort: "gebeurtenis",
    triggerEvent: "eerste_aankoop",
    stappen: [
      { soort: "wacht", uren: 48 },
      { soort: "mail", sjabloon: "eerste-aankoop-bedankt" },
      { soort: "wacht", uren: 336 },
      // Heeft hij z'n maten inmiddels? Dan het maatverzoek overslaan.
      { soort: "voorwaarde", regel: en({ veld: "maatprofiel", operator: "ja" }), danNaarStap: 6 },
      { soort: "mail", sjabloon: "maatprofiel-uitnodiging" },
      { soort: "wacht", uren: 168 },
      { soort: "mail", sjabloon: "tweede-aankoop-advies" },
    ],
    // Kocht hij al een tweede keer, dan is de flow overbodig.
    uitstap: en({ veld: "orders_totaal", operator: "minstens", waarde: 2 }),
    herhaalbaar: false,
    herhaalNaDagen: 0,
  },
  {
    slug: "terugwinnen",
    naam: "Terugwinnen",
    omschrijving:
      "Voor wie meer dan een jaar niet kocht maar nog geen twee. Eén mail, en twee weken later " +
      "een puntenherinnering als hij die heeft staan. Na twee jaar (segment 'verloren') doen we niets meer: " +
      "de kans is dan zo laag dat elke mail alleen je afzenderreputatie kost.",
    triggerSoort: "doelgroep",
    triggerDoelgroepSlug: "slapend-terugwinnen",
    stappen: [
      { soort: "mail", sjabloon: "terugwin" },
      { soort: "wacht", uren: 336 },
      // Alleen doorgaan als er punten staan die het noemen waard zijn.
      { soort: "voorwaarde", regel: en({ veld: "punten_beschikbaar", operator: "hoogstens", waarde: 99 }), danNaarStap: 99 },
      { soort: "mail", sjabloon: "punten-herinnering" },
    ],
    uitstap: of(
      { veld: "dagen_sinds_aankoop", operator: "hoogstens", waarde: 30 },
      { veld: "segment", operator: "is_een_van", waarde: ["verloren"] },
    ),
    herhaalbaar: true,
    herhaalNaDagen: 180,
  },
  {
    slug: "maten-ophalen",
    naam: "Maten ophalen bij kopers",
    omschrijving:
      "Kocht al, maar gaf nooit z'n maten door. Precies de groep waar de verkeerde-maat-retouren vandaan komen: " +
      "wij weten niet wat past en hij ziet nergens 'in jouw maat'. Eén mail, geen herhaling — " +
      "wie het na één verzoek niet invult, wil het niet.",
    triggerSoort: "doelgroep",
    triggerDoelgroepSlug: "kopers-zonder-maatprofiel",
    stappen: [{ soort: "mail", sjabloon: "maatprofiel-uitnodiging" }],
    uitstap: en({ veld: "maatprofiel", operator: "ja" }),
    herhaalbaar: false,
    herhaalNaDagen: 0,
  },
];
