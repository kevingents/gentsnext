import type { AudienceInvoer } from "@/lib/audiences";
import type { RegelGroep } from "@/lib/audience-regels";

/**
 * De startset doelgroepen.
 *
 * Bewust géén lijst van alles wat technisch kan. Elke doelgroep hieronder
 * beantwoordt een vraag die iemand daadwerkelijk stelt ("wie moet ik bellen",
 * "waar zet ik mijn advertentiebudget", "wie mag ik nooit meer een korting
 * sturen"), en heeft een duidelijke ACTIE. Een doelgroep zonder actie is een
 * rapportage met een dure naam.
 *
 * Drie soorten:
 *   BEREIKEN   — mensen die je wilt aanschrijven of adverteren.
 *   UITSLUITEN — mensen die je juist NIET wilt bereiken. Dit is het meest
 *                ondergewaardeerde stuk: geld verbrandt niet aan wie je mist,
 *                maar aan wie je overbodig bereikt.
 *   ZAAILIJST  — de beste klanten, als basis voor een lookalike bij Meta of
 *                Google. Daar wil je juist je meest waardevolle mensen in, niet
 *                iedereen die ooit iets kocht.
 */

const en = (...regels: RegelGroep["regels"]): RegelGroep => ({ op: "en", regels });

export const STANDAARD_DOELGROEPEN: (AudienceInvoer & { doel: "bereiken" | "uitsluiten" | "zaailijst" })[] = [
  /* ───────────────────────────── Bereiken ─────────────────────────────── */
  {
    slug: "vip-klanten",
    naam: "VIP-klanten",
    doel: "bereiken",
    omschrijving:
      "Meest waardevolle en meest frequente kopers. Actie: eerste toegang tot nieuwe collectie, persoonlijke uitnodiging, en NOOIT een generieke korting — die verlaagt alleen de marge op omzet die er toch al was.",
    definitie: en({ veld: "segment", operator: "is_een_van", waarde: ["vip"] }),
  },
  {
    slug: "risico-waardevol-maar-weg",
    naam: "Risico — waardevol maar weg",
    doel: "bereiken",
    omschrijving:
      "Kocht veel, maar is al meer dan een jaar niet geweest. De duurste groep om te verliezen en de goedkoopste om terug te winnen. Actie: persoonlijk bericht van de eigen winkel, geen massamail.",
    definitie: en({ veld: "segment", operator: "is_een_van", waarde: ["risico"] }),
  },
  {
    slug: "nooit-welkomstpunten-gehad",
    naam: "Nooit welkomstpunten gehad",
    doel: "bereiken",
    omschrijving:
      "Klanten van vóór de welkomstbonus. Met terugwerkende kracht uitbetalen kost ± € 120.000 en levert niets terug — " +
      "een klant die stil 50 punten krijgt doet er niets voor en merkt het meestal niet eens. Actie: geef ze in plaats " +
      "daarvan een REDEN om iets te doen dat wél helpt (maten opgeven, profiel afmaken) en laat ze de punten verdienen. " +
      "Dezelfde punten, wel een tegenprestatie, en het drukt het retourpercentage.",
    definitie: en(
      { veld: "welkomstbonus", operator: "nee" },
      { veld: "marketing_opt_in", operator: "ja" }
    ),
  },
  {
    slug: "kopers-zonder-maatprofiel",
    naam: "Kocht al, maar gaf z'n maat nooit door",
    doel: "bereiken",
    omschrijving:
      "Heeft besteld zonder ooit z'n maten op te geven. Precies de groep waar de verkeerde-maat-retouren vandaan komen: wij weten niet wat past, en hij ziet nergens 'in jouw maat'. Actie: één mail met het maatadvies en de punten die daaraan hangen. Dit is de goedkoopste retour-ingreep die er is — een retour kost meer dan de bonus.",
    definitie: en(
      { veld: "maatprofiel", operator: "nee" },
      { veld: "orders_totaal", operator: "minstens", waarde: 1 },
      { veld: "marketing_opt_in", operator: "ja" }
    ),
  },
  {
    slug: "hoge-retourquote-zonder-maatprofiel",
    naam: "Veel retouren én geen maatprofiel",
    doel: "bereiken",
    omschrijving:
      "Stuurt bovengemiddeld veel terug én gaf nooit een maat door. Bij deze klanten is de retour waarschijnlijk een pasvormprobleem en geen spijt — dus oplosbaar. Actie: persoonlijk maatadvies of een afspraak in z'n eigen winkel, geen korting.",
    definitie: en(
      { veld: "retourquote", operator: "minstens", waarde: 25 },
      { veld: "maatprofiel", operator: "nee" },
      { veld: "orders_totaal", operator: "minstens", waarde: 2 }
    ),
  },
  {
    slug: "winkelwagen-verlaten-7d",
    naam: "Winkelwagen laten staan (7 dagen)",
    doel: "bereiken",
    omschrijving:
      "Had de afgelopen week iets in de wagen en kocht niet. Hoogste conversiekans van alle doelgroepen. Actie: herinnering + gerichte retargeting.",
    definitie: en(
      { veld: "kar_verlaten_op", operator: "binnen_dagen", waarde: 7 },
      { veld: "marketing_opt_in", operator: "ja" }
    ),
  },
  {
    slug: "alleen-winkel-nooit-online",
    naam: "Koopt alleen in de winkel",
    doel: "bereiken",
    omschrijving:
      "Trouwe winkelklant die de webshop nog nooit gebruikte. Actie: laat zien dat zijn maat en voorkeuren al bekend zijn — de drempel is onbekendheid, niet prijs. Dit is de groep die het omnichannel-verhaal moet dragen.",
    definitie: en(
      { veld: "kanaal", operator: "is_een_van", waarde: ["winkel"] },
      { veld: "orders_winkel", operator: "minstens", waarde: 2 }
    ),
  },
  {
    slug: "alleen-online-nooit-winkel",
    naam: "Koopt alleen online",
    doel: "bereiken",
    omschrijving:
      "Kent de winkels niet. Actie: nodig uit voor pasadvies of een afspraak in de winkel het dichtst bij — een klant die één keer in de winkel is geweest besteedt structureel meer.",
    definitie: en(
      { veld: "kanaal", operator: "is_een_van", waarde: ["online"] },
      { veld: "orders_online", operator: "minstens", waarde: 2 }
    ),
  },
  {
    slug: "eenmalige-koper-90d",
    naam: "Eenmalige koper — tweede aankoop",
    doel: "bereiken",
    omschrijving:
      "Kocht één keer, meer dan 90 dagen geleden. De tweede aankoop is het scharnierpunt: wie twee keer koopt blijft meestal. Actie: aanvullend advies op wat hij kocht, geen willekeurige aanbieding.",
    definitie: en({ veld: "segment", operator: "is_een_van", waarde: ["eenmalig"] }),
  },
  {
    slug: "slapend-terugwinnen",
    naam: "Slapend — terugwinnen",
    doel: "bereiken",
    omschrijving:
      "Meer dan een jaar niet gekocht, maar nog geen twee jaar. Actie: terugwin-campagne. Na twee jaar (segment 'verloren') is de kans zo laag dat adverteren geld weggooien is — die zitten daarom in de uitsluitlijst.",
    definitie: en({ veld: "segment", operator: "is_een_van", waarde: ["slapend"] }),
  },
  {
    slug: "prospect-actief-niet-gekocht",
    naam: "Actief maar nooit gekocht",
    doel: "bereiken",
    omschrijving:
      "Was deze maand meerdere keren op de site en kocht nog nooit iets. Actie: retargeting op wat hij bekeek, plus een reden om nú te komen (maatadvies, voorraad in zijn winkel).",
    definitie: en(
      { veld: "orders_totaal", operator: "is", waarde: 0 },
      { veld: "sessies_30d", operator: "minstens", waarde: 2 }
    ),
  },
  {
    slug: "punten-onbenut",
    naam: "Onbenutte clubpunten",
    doel: "bereiken",
    omschrijving:
      "Heeft een noemenswaardig puntensaldo staan en kwam al een half jaar niet. Actie: herinner aan het saldo — dat is een reden om te komen die niets kost aan marge, want de punten zijn al verdiend.",
    definitie: en(
      { veld: "punten_beschikbaar", operator: "minstens", waarde: 250 },
      { veld: "dagen_sinds_aankoop", operator: "minstens", waarde: 180 }
    ),
  },
  {
    slug: "pak-kopers",
    naam: "Pakkenkopers",
    doel: "bereiken",
    omschrijving:
      "Kocht een pak of maakte een afspraak. Actie: accessoire-advies (overhemd, das, schoenen) en het juiste seizoensmoment. De categorie is 'Pakken' — de hoofdgroep zoals die uit SRS komt; er bestaat geen aparte trouwcategorie in de catalogus.",
    definitie: {
      op: "of",
      regels: [
        { veld: "afspraken", operator: "minstens", waarde: 1 },
        { veld: "top_categorieen", operator: "bevat", waarde: "Pakken" },
      ],
    },
  },
  {
    slug: "overhemd-aanvulling",
    naam: "Colbert gekocht, geen overhemd",
    doel: "bereiken",
    omschrijving:
      "Kocht colberts of pakken maar nooit een overhemd. De meest voor de hand liggende aanvulling die we hebben, en meteen de meest gemiste. Actie: overhemd-advies in zijn eigen maat.",
    definitie: {
      op: "en",
      regels: [
        { veld: "top_categorieen", operator: "bevat", waarde: "Colberts" },
        { veld: "top_categorieen", operator: "bevat_niet", waarde: "Overhemden" },
      ],
    },
  },
  {
    slug: "wallet-pashouders",
    naam: "Wallet-pashouders",
    doel: "bereiken",
    omschrijving:
      "Heeft de loyaliteitspas in Apple Wallet. Actie: push via de pas in plaats van mail — hoger bereik, geen inbox-concurrentie.",
    definitie: en({ veld: "wallet_pas", operator: "ja" }),
  },

  {
    slug: "grote-maten",
    naam: "Grote maten",
    doel: "bereiken",
    omschrijving:
      "Kocht maat 58+ of XXL en hoger. Deze klant loopt bij de meeste winkels tegen een lege rekken aan; laat zien dat het assortiment hier wél doorloopt. Afgeleid uit de gekochte maat, niet uit de collectie 'Grote maten' — die bevat driekwart van de catalogus en zegt alleen dat een artikel óók in grote maten leverbaar is.",
    definitie: en({ veld: "grote_maten", operator: "ja" }),
  },
  {
    slug: "vol-tarief-kopers",
    naam: "Betaalt vol tarief",
    doel: "bereiken",
    omschrijving:
      "Kocht meerdere keren en vrijwel nooit met korting. De meest winstgevende groep die er is. Actie: nieuwe collectie en persoonlijk advies — en NOOIT een kortingsmail, want je verlaagt de marge op omzet die er toch al was.",
    definitie: en(
      { veld: "kortingsaandeel", operator: "hoogstens", waarde: 10 },
      { veld: "orders_totaal", operator: "minstens", waarde: 2 }
    ),
  },
  {
    slug: "kortingsjagers",
    naam: "Koopt alleen met korting",
    doel: "bereiken",
    omschrijving:
      "Meer dan driekwart van de orders had korting. Deze groep reageert op sale-momenten en vrijwel nergens anders op. Actie: bewaar ze voor opruiming en einde-seizoen; een campagne op vol tarief is aan hen verspild.",
    definitie: en(
      { veld: "kortingsaandeel", operator: "minstens", waarde: 75 },
      { veld: "orders_totaal", operator: "minstens", waarde: 2 }
    ),
  },
  {
    slug: "bol-klanten-terughalen",
    naam: "Koopt ook op Bol",
    doel: "bereiken",
    omschrijving:
      "Bestelt bij ons én via Bol.com. Elke Bol-order kost commissie; deze klant kent ons al, dus er is een reden nodig om rechtstreeks te kopen (punten, maatprofiel, afhalen). Direct margewerk.",
    definitie: en({ veld: "orders_bol", operator: "minstens", waarde: 1 }),
  },
  {
    slug: "mail-slapers",
    naam: "Ontvangt mail, opent nooit",
    doel: "bereiken",
    omschrijving:
      "Kreeg minstens tien mails en opende er geen. Actie: één heractivatiemail met een andere insteek, en daarna uit de reguliere verzending halen — dode adressen slepen je afzenderreputatie omlaag en daarmee de bezorging bij iedereen.",
    definitie: en(
      { veld: "mail_verstuurd", operator: "minstens", waarde: 10 },
      { veld: "mail_openratio", operator: "hoogstens", waarde: 0 }
    ),
  },
  {
    slug: "cadeaukopers",
    naam: "Cadeaukopers",
    doel: "bereiken",
    omschrijving:
      "Kocht ooit een cadeaubon. Reageert op heel andere momenten dan wie voor zichzelf koopt: feestdagen, Vaderdag, verjaardagen. Actie: seizoensherinnering, geen productaanbod.",
    definitie: en({ veld: "cadeaukoper", operator: "ja" }),
  },

  {
    slug: "verjaardag-bekend",
    naam: "Verjaardag bekend",
    doel: "bereiken",
    omschrijving:
      "Van deze klanten kennen we de geboortedatum (uit Spotler). Een verjaardag is het enige campagnemoment dat je precies één keer per jaar per klant hebt en dat volledig ontbrak in ons klantbeeld. Maak hiervan twaalf maand-doelgroepen, of filter op 'jarig in maand'. Actie: felicitatie met iets kleins — geen generieke aanbieding, want dan is het geen felicitatie.",
    definitie: en({ veld: "verjaardag", operator: "gevuld" }),
  },

  /* ──────────────────────────── Uitsluiten ────────────────────────────── */
  {
    slug: "uitsluiten-recent-gekocht",
    naam: "Uitsluiten — kocht net",
    doel: "uitsluiten",
    omschrijving:
      "Kocht de afgelopen 14 dagen. Sluit deze groep uit bij elke wervingscampagne: je betaalt voor een klik van iemand die al klant is, en een kortingsmail vlak na een aankoop tegen vol tarief kost je een retour én goodwill.",
    definitie: en({ veld: "dagen_sinds_aankoop", operator: "hoogstens", waarde: 14 }),
  },
  {
    slug: "uitsluiten-hoog-retour",
    naam: "Uitsluiten — hoog retourpercentage",
    doel: "uitsluiten",
    omschrijving:
      "Stuurt meer dan de helft terug over minstens drie retouren. Deze klant kost geld op elke extra order. Actie: niet uitsluiten van dienstverlening, wél van betaalde werving — en beter maatadvies aanbieden, want daar zit meestal de oorzaak.",
    definitie: en(
      { veld: "retourquote", operator: "minstens", waarde: 50 },
      { veld: "retouren", operator: "minstens", waarde: 3 }
    ),
  },
  {
    slug: "uitsluiten-verloren",
    naam: "Uitsluiten — verloren klanten",
    doel: "uitsluiten",
    omschrijving:
      "Meer dan twee jaar niets gekocht. Adverteren op deze groep levert vrijwel niets op; ze vertekenen wel je doelgroepgroottes en je kosten per conversie.",
    definitie: en({ veld: "segment", operator: "is_een_van", waarde: ["verloren"] }),
  },
  {
    slug: "uitsluiten-geen-toestemming",
    naam: "Uitsluiten — geen toestemming",
    doel: "uitsluiten",
    omschrijving:
      "Uitgeschreven of nooit toestemming gegeven. Hoort in élke uitsluitlijst. Staat hier expliciet zodat het zichtbaar is en niet alleen impliciet in de code.",
    definitie: {
      op: "of",
      regels: [
        { veld: "nieuwsbrief", operator: "is_een_van", waarde: ["unsubscribed"] },
        {
          op: "en",
          regels: [
            { veld: "marketing_opt_in", operator: "nee" },
            { veld: "nieuwsbrief", operator: "is_geen_van", waarde: ["subscribed"] },
          ],
        },
      ],
    },
  },

  /* ──────────────────────────── Zaailijsten ───────────────────────────── */
  {
    slug: "zaailijst-beste-klanten",
    naam: "Zaailijst — beste klanten (lookalike)",
    doel: "zaailijst",
    omschrijving:
      "Top-kopers van de afgelopen twee jaar. Gebruik dit als BRON voor een lookalike bij Meta of een vergelijkbaar publiek bij Google — niet om zelf te bereiken. Een lookalike op 'iedereen die ooit kocht' levert een kopie van je gemiddelde; op deze lijst levert het een kopie van je beste klant.",
    definitie: en(
      { veld: "besteed_totaal", operator: "minstens", waarde: 750 },
      { veld: "orders_totaal", operator: "minstens", waarde: 2 },
      { veld: "dagen_sinds_aankoop", operator: "hoogstens", waarde: 730 }
    ),
  },
  {
    slug: "zaailijst-hoge-orderwaarde",
    naam: "Zaailijst — hoge orderwaarde",
    doel: "zaailijst",
    omschrijving:
      "Klanten met een structureel hoge gemiddelde orderwaarde, ongeacht hoe vaak ze komen. Bruikbaar als aparte lookalike-bron naast de beste klanten: het zoekt een ander soort mens (de eenmalige grote aankoop, zoals een compleet trouwpak).",
    definitie: en(
      { veld: "gem_orderwaarde", operator: "minstens", waarde: 500 },
      { veld: "orders_totaal", operator: "minstens", waarde: 1 }
    ),
  },
];
