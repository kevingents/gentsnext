import { sql, type SQL } from "drizzle-orm";

/**
 * De regelmotor achter doelgroepen.
 *
 * Een doelgroep wordt in de portal geklikt en opgeslagen als DATA — een boom
 * van regels — nooit als SQL-tekst. Dit bestand is het enige punt waar die data
 * SQL wordt, en het doet dat tegen een vaste veldenlijst: staat een veld hier
 * niet in, dan bestaat het niet. Een kolomnaam die uit een jsonb-kolom komt en
 * ongezien in een query beland is een injectiedeur die vanzelf een keer
 * opengaat; met deze opzet kán dat niet, ook niet als iemand later de
 * API rechtstreeks aanroept.
 *
 * Alle waarden gaan als parameter mee (drizzle's `sql` template), dus ook de
 * inhoud van een regel kan nooit als SQL worden gelezen.
 */

export type VeldType = "getal" | "bedrag" | "dagen" | "datum" | "tekst" | "keuze" | "jaNee" | "lijst";

export type VeldDef = {
  key: string;
  label: string;
  type: VeldType;
  /** Kolomnaam in customer_profiles. Alleen uit deze lijst — nooit uit invoer. */
  kolom: string;
  /** Vaste keuzes (type 'keuze'), voor het uitklapmenu in de portal. */
  opties?: { waarde: string; label: string }[];
  uitleg?: string;
};

export const VELDEN: VeldDef[] = [
  /* Waarde */
  { key: "besteed_totaal", label: "Totaal besteed", type: "bedrag", kolom: "besteed_totaal_cents", uitleg: "Online + winkel samen, ontdubbeld." },
  { key: "besteed_online", label: "Online besteed", type: "bedrag", kolom: "besteed_online_cents" },
  { key: "besteed_winkel", label: "In de winkel besteed", type: "bedrag", kolom: "besteed_winkel_cents" },
  { key: "gem_orderwaarde", label: "Gemiddelde orderwaarde", type: "bedrag", kolom: "gem_orderwaarde_cents" },
  { key: "klantwaarde", label: "Verwachte klantwaarde (2 jaar)", type: "bedrag", kolom: "klantwaarde_cents" },
  { key: "orders_totaal", label: "Aantal aankopen", type: "getal", kolom: "orders_totaal" },
  { key: "orders_online", label: "Aantal online orders", type: "getal", kolom: "orders_online" },
  { key: "orders_winkel", label: "Aantal winkelaankopen", type: "getal", kolom: "orders_winkel" },

  /* Tijd */
  { key: "dagen_sinds_aankoop", label: "Dagen sinds laatste aankoop", type: "dagen", kolom: "dagen_sinds_aankoop" },
  { key: "eerste_aankoop", label: "Eerste aankoop", type: "datum", kolom: "eerste_aankoop" },
  { key: "laatste_aankoop", label: "Laatste aankoop", type: "datum", kolom: "laatste_aankoop" },
  { key: "laatst_gezien", label: "Laatst op de site", type: "datum", kolom: "laatst_gezien" },
  { key: "kar_verlaten_op", label: "Winkelwagen laten staan op", type: "datum", kolom: "kar_verlaten_op", uitleg: "Laatste keer iets in de wagen zónder aankoop erna." },

  /* Segmentatie */
  {
    key: "segment", label: "Segment", type: "keuze", kolom: "segment",
    opties: [
      { waarde: "vip", label: "VIP" },
      { waarde: "trouw", label: "Trouw" },
      { waarde: "nieuw", label: "Nieuw" },
      { waarde: "eenmalig", label: "Eenmalige koper" },
      { waarde: "slapend", label: "Slapend (>1 jaar)" },
      { waarde: "risico", label: "Risico (waardevol maar weg)" },
      { waarde: "verloren", label: "Verloren (>2 jaar)" },
      { waarde: "geen", label: "Nog geen aankoop" },
    ],
  },
  {
    key: "kanaal", label: "Kanaal", type: "keuze", kolom: "kanaal",
    opties: [
      { waarde: "online", label: "Alleen online" },
      { waarde: "winkel", label: "Alleen winkel" },
      { waarde: "omni", label: "Beide (omnichannel)" },
      { waarde: "geen", label: "Nog niets gekocht" },
    ],
  },
  { key: "favoriete_winkel", label: "Favoriete winkel", type: "tekst", kolom: "favoriete_winkel" },
  { key: "rfm_r", label: "RFM — recentheid (1–5)", type: "getal", kolom: "rfm_r" },
  { key: "rfm_f", label: "RFM — frequentie (1–5)", type: "getal", kolom: "rfm_f" },
  { key: "rfm_m", label: "RFM — waarde (1–5)", type: "getal", kolom: "rfm_m" },

  /* Gedrag */
  { key: "sessies_30d", label: "Bezoeken (30 dagen)", type: "getal", kolom: "sessies_30d" },
  { key: "productviews_30d", label: "Producten bekeken (30 dagen)", type: "getal", kolom: "productviews_30d" },
  { key: "zoekopdrachten_30d", label: "Zoekopdrachten (30 dagen)", type: "getal", kolom: "zoekopdrachten_30d" },

  /* Affiniteit */
  { key: "top_categorieen", label: "Koopt in categorie", type: "lijst", kolom: "top_categorieen" },
  { key: "top_merken", label: "Koopt merk", type: "lijst", kolom: "top_merken" },
  { key: "top_kleuren", label: "Koopt kleur", type: "lijst", kolom: "top_kleuren" },

  /* Retour & loyaliteit */
  { key: "retourquote", label: "Retourpercentage", type: "getal", kolom: "retourquote" },
  { key: "retouren", label: "Aantal retouren", type: "getal", kolom: "retouren" },
  { key: "punten_beschikbaar", label: "Beschikbare clubpunten", type: "getal", kolom: "punten_beschikbaar" },
  { key: "tegoed_cents", label: "Openstaand tegoed", type: "bedrag", kolom: "tegoed_cents" },
  { key: "actieve_vouchers", label: "Actieve vouchers", type: "getal", kolom: "actieve_vouchers" },
  { key: "wallet_pas", label: "Heeft Apple Wallet-pas", type: "jaNee", kolom: "wallet_pas" },
  {
    key: "maatprofiel", label: "Heeft maten opgegeven", type: "jaNee", kolom: "maatprofiel",
    uitleg: "Minstens twee van colbert/broek/overhemd/schoen zelf ingevuld. Nee = de groep waar de meeste verkeerde-maat-retouren vandaan komen.",
  },
  {
    key: "profiel_compleet", label: "Profiel compleet", type: "jaNee", kolom: "profiel_compleet",
    uitleg: "Naam, telefoon, leeftijd, kleuren, vaste winkel en gelegenheden — de checklist waar de puntenbonus op staat.",
  },
  {
    key: "welkomstbonus", label: "Welkomstpunten gehad", type: "jaNee", kolom: "welkomstbonus",
    uitleg: "Nee = klant van vóór 13 aug 2026, toen de welkomstbonus inging. Die groep heeft 'm nooit gekregen.",
  },
  {
    key: "bonus_punten", label: "Punten uit bonusacties", type: "getal", kolom: "bonus_punten",
    uitleg: "Hoeveel van z'n punten uit de eenmalige acties komen. Hoog = reageert op een prikkel.",
  },

  /* Binding & toestemming */
  { key: "marketing_opt_in", label: "Marketing-toestemming", type: "jaNee", kolom: "marketing_opt_in" },
  {
    key: "nieuwsbrief", label: "Nieuwsbrief", type: "keuze", kolom: "nieuwsbrief",
    opties: [
      { waarde: "subscribed", label: "Ingeschreven" },
      { waarde: "pending", label: "Nog niet bevestigd" },
      { waarde: "unsubscribed", label: "Uitgeschreven" },
      { waarde: "geen", label: "Nooit ingeschreven" },
    ],
  },
  { key: "whatsapp_optin", label: "WhatsApp-toestemming", type: "jaNee", kolom: "whatsapp_opt_in" },
  { key: "tickets", label: "Aantal klantvragen", type: "getal", kolom: "tickets" },
  { key: "afspraken", label: "Aantal afspraken", type: "getal", kolom: "afspraken" },
  { key: "reviews", label: "Aantal reviews", type: "getal", kolom: "reviews" },

  /* Plaats */
  { key: "postcode", label: "Postcode", type: "tekst", kolom: "postcode" },
  { key: "plaats", label: "Plaats", type: "tekst", kolom: "plaats" },
  { key: "land", label: "Land", type: "tekst", kolom: "land" },

  /* Pasvorm & maat */
  {
    key: "grote_maten", label: "Draagt grote maten", type: "jaNee", kolom: "grote_maten",
    uitleg: "Kocht maat 58+ of XXL en hoger. Afgeleid uit de daadwerkelijk gekochte maat, niet uit de collectie.",
  },
  {
    key: "maatprofiel_compleet", label: "Maatprofiel compleet", type: "jaNee", kolom: "maatprofiel_compleet",
    uitleg: "Van minstens drie categorieën is de maat bekend — genoeg om echt advies te geven.",
  },

  /* Koopgedrag */
  {
    key: "kortingsaandeel", label: "Percentage orders met korting", type: "getal", kolom: "kortingsaandeel",
    uitleg: "100 = koopt uitsluitend met korting. Stuur deze groep nooit vol tarief, en de tegenovergestelde groep nooit een kortingsmail.",
  },
  { key: "orders_met_korting", label: "Aantal orders met korting", type: "getal", kolom: "orders_met_korting" },
  { key: "zakelijk", label: "Bestelt zakelijk", type: "jaNee", kolom: "zakelijk" },
  { key: "cadeaukoper", label: "Kocht ooit een cadeaubon", type: "jaNee", kolom: "cadeaukoper" },
  { key: "betaalmethode", label: "Betaalmethode", type: "tekst", kolom: "betaalmethode" },
  {
    key: "bezorgvoorkeur", label: "Bezorgvoorkeur", type: "keuze", kolom: "bezorgvoorkeur",
    opties: [
      { waarde: "standard", label: "Standaard bezorging" },
      { waarde: "express", label: "Express" },
      { waarde: "pickup", label: "Afhalen in de winkel" },
    ],
  },
  {
    key: "taal", label: "Taal", type: "keuze", kolom: "taal",
    opties: [
      { waarde: "nl", label: "Nederlands" }, { waarde: "en", label: "Engels" },
      { waarde: "de", label: "Duits" }, { waarde: "fr", label: "Frans" }, { waarde: "es", label: "Spaans" },
    ],
  },

  /* Mailgedrag */
  {
    key: "mail_openratio", label: "Mail-openratio (%)", type: "getal", kolom: "mail_openratio",
    uitleg: "0 = ontvangt wel maar opent nooit. Zo'n adres sleept je afzenderreputatie omlaag.",
  },
  { key: "mail_verstuurd", label: "Aantal mails ontvangen", type: "getal", kolom: "mail_verstuurd" },
  { key: "mail_geklikt", label: "Aantal mailkliks", type: "getal", kolom: "mail_geklikt" },
  { key: "mail_laatst_geopend", label: "Laatst een mail geopend", type: "datum", kolom: "mail_laatst_geopend" },

  /* Kanalen */
  {
    key: "orders_bol", label: "Aantal Bol-bestellingen", type: "getal", kolom: "orders_bol",
    uitleg: "Koopt bij ons én op Bol. Die klant kun je met een reden naar het eigen kanaal halen — dat scheelt marge.",
  },
  { key: "besteed_bol", label: "Besteed via Bol", type: "bedrag", kolom: "besteed_bol_cents" },
  { key: "retour_redenen", label: "Retourreden", type: "lijst", kolom: "retour_redenen" },

  /* Persoon (uit Spotler) */
  {
    key: "geboortemaand",
    label: "Jarig in maand (1–12)",
    type: "getal",
    kolom: "geboortemaand",
    uitleg:
      "Verjaardagscampagne. Een verjaardag is het enige campagnemoment dat je precies één keer per jaar per klant hebt — en dat we tot nu toe helemaal niet kenden.",
  },
  { key: "verjaardag", label: "Verjaardag bekend", type: "datum", kolom: "verjaardag" },
  {
    key: "leeftijdsgroep",
    label: "Leeftijdsgroep",
    type: "tekst",
    kolom: "leeftijdsgroep",
    uitleg: "Zoals de klant zelf opgaf op /account, voor wie liever geen exacte datum geeft.",
  },
  {
    key: "favoriete_kleuren",
    label: "Favoriete kleur",
    type: "lijst",
    kolom: "favoriete_kleuren",
    uitleg: "Zelf opgegeven, niet afgeleid uit aankopen — dit is wat hij wíl, niet wat hij kocht.",
  },
  {
    key: "gelegenheden",
    label: "Shopt voor gelegenheid",
    type: "lijst",
    kolom: "gelegenheden",
    uitleg: "Werk & zakelijk, bruiloft, gala & black tie, casual. Het antwoord op 'waarvoor shop je?'.",
  },
  {
    key: "vaste_winkel",
    label: "Vaste winkel (zelf gekozen)",
    type: "tekst",
    kolom: "vaste_winkel",
    uitleg: "Los van `favoriete_winkel`, die uit de aankopen volgt. Deze koos de klant zélf.",
  },
  {
    key: "geslacht",
    label: "Geslacht",
    type: "tekst",
    kolom: "geslacht",
    uitleg: "Zoals in Spotler vastgelegd. Leeg = onbekend, en dat is voorlopig de grootste groep.",
  },
];

const VELD_INDEX = new Map(VELDEN.map((v) => [v.key, v]));

/** Welke operatoren bij welk veldtype horen — stuurt ook het portal-menu aan. */
export const OPERATOREN: Record<VeldType, { key: string; label: string; waarden: 0 | 1 | 2 }[]> = {
  getal: [
    { key: "is", label: "is precies", waarden: 1 },
    { key: "minstens", label: "is minstens", waarden: 1 },
    { key: "hoogstens", label: "is hoogstens", waarden: 1 },
    { key: "tussen", label: "ligt tussen", waarden: 2 },
  ],
  bedrag: [
    { key: "minstens", label: "is minstens (€)", waarden: 1 },
    { key: "hoogstens", label: "is hoogstens (€)", waarden: 1 },
    { key: "tussen", label: "ligt tussen (€)", waarden: 2 },
  ],
  dagen: [
    { key: "hoogstens", label: "hoogstens ... dagen geleden", waarden: 1 },
    { key: "minstens", label: "minstens ... dagen geleden", waarden: 1 },
    { key: "tussen", label: "tussen ... en ... dagen geleden", waarden: 2 },
  ],
  datum: [
    { key: "binnen_dagen", label: "in de afgelopen ... dagen", waarden: 1 },
    { key: "langer_dan_dagen", label: "langer dan ... dagen geleden", waarden: 1 },
    { key: "gevuld", label: "is bekend", waarden: 0 },
    { key: "leeg", label: "is onbekend", waarden: 0 },
  ],
  tekst: [
    { key: "is", label: "is", waarden: 1 },
    { key: "is_niet", label: "is niet", waarden: 1 },
    { key: "bevat", label: "bevat", waarden: 1 },
    { key: "gevuld", label: "is ingevuld", waarden: 0 },
    { key: "leeg", label: "is leeg", waarden: 0 },
  ],
  keuze: [
    { key: "is_een_van", label: "is een van", waarden: 1 },
    { key: "is_geen_van", label: "is géén van", waarden: 1 },
  ],
  jaNee: [
    { key: "ja", label: "ja", waarden: 0 },
    { key: "nee", label: "nee", waarden: 0 },
  ],
  lijst: [
    { key: "bevat", label: "bevat", waarden: 1 },
    { key: "bevat_niet", label: "bevat niet", waarden: 1 },
  ],
};

export type Regel = { veld: string; operator: string; waarde?: unknown; waarde2?: unknown };
export type RegelGroep = { op: "en" | "of"; regels: (Regel | RegelGroep)[] };

function isGroep(r: Regel | RegelGroep): r is RegelGroep {
  return typeof (r as RegelGroep).op === "string" && Array.isArray((r as RegelGroep).regels);
}

const getal = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** Bedragen worden in de portal in euro's ingevoerd maar in centen opgeslagen. */
const centen = (v: unknown) => Math.round(getal(v) * 100);

/**
 * Eén regel naar SQL. Retourneert null bij een onbekend veld of een onbekende
 * operator — de aanroeper laat die regel dan vallen in plaats van de hele
 * doelgroep te laten klappen. Een half-werkende doelgroep is nog steeds fout,
 * dus `valideerDefinitie` meldt het apart aan de gebruiker.
 */
function regelNaarSql(r: Regel): SQL | null {
  const veld = VELD_INDEX.get(r.veld);
  if (!veld) return null;
  const toegestaan = OPERATOREN[veld.type].some((o) => o.key === r.operator);
  if (!toegestaan) return null;

  // De kolomnaam komt uit onze eigen constante, nooit uit de invoer.
  const k = sql.raw(`p."${veld.kolom}"`);
  const num = veld.type === "bedrag" ? centen(r.waarde) : getal(r.waarde);
  const num2 = veld.type === "bedrag" ? centen(r.waarde2) : getal(r.waarde2);

  switch (r.operator) {
    case "is":
      return veld.type === "tekst" ? sql`lower(${k}) = lower(${String(r.waarde ?? "")})` : sql`${k} = ${num}`;
    case "is_niet":
      return sql`lower(${k}) <> lower(${String(r.waarde ?? "")})`;
    case "minstens":
      return sql`${k} >= ${num}`;
    case "hoogstens":
      return sql`${k} <= ${num}`;
    case "tussen":
      return sql`${k} between ${Math.min(num, num2)} and ${Math.max(num, num2)}`;
    case "bevat":
      // Bij een lijstveld (jsonb [{waarde,aantal}]) zoeken we in de waarden, bij
      // een tekstveld in de tekst zelf.
      return veld.type === "lijst"
        ? sql`exists (select 1 from jsonb_array_elements(${k}) e where lower(e->>'waarde') = lower(${String(r.waarde ?? "")}))`
        : sql`${k} ilike ${"%" + String(r.waarde ?? "") + "%"}`;
    case "bevat_niet":
      return sql`not exists (select 1 from jsonb_array_elements(${k}) e where lower(e->>'waarde') = lower(${String(r.waarde ?? "")}))`;
    case "gevuld":
      return veld.type === "datum" ? sql`${k} is not null` : sql`coalesce(${k}, '') <> ''`;
    case "leeg":
      return veld.type === "datum" ? sql`${k} is null` : sql`coalesce(${k}, '') = ''`;
    case "binnen_dagen":
      return sql`${k} > now() - make_interval(days => ${Math.max(0, Math.round(getal(r.waarde)))})`;
    case "langer_dan_dagen":
      return sql`${k} < now() - make_interval(days => ${Math.max(0, Math.round(getal(r.waarde)))})`;
    case "is_een_van": {
      const lijst = (Array.isArray(r.waarde) ? r.waarde : [r.waarde]).map((x) => String(x ?? "")).filter(Boolean);
      if (!lijst.length) return null;
      return sql`${k} in (${sql.join(lijst.map((x) => sql`${x}`), sql`, `)})`;
    }
    case "is_geen_van": {
      const lijst = (Array.isArray(r.waarde) ? r.waarde : [r.waarde]).map((x) => String(x ?? "")).filter(Boolean);
      if (!lijst.length) return null;
      return sql`${k} not in (${sql.join(lijst.map((x) => sql`${x}`), sql`, `)})`;
    }
    case "ja":
      return sql`${k} = true`;
    case "nee":
      return sql`${k} = false`;
    default:
      return null;
  }
}

/**
 * De hele boom naar één WHERE-uitdrukking.
 *
 * Een lege groep levert bewust `true` op ("iedereen") en niet `false`: de
 * gebruiker die een nieuwe doelgroep opent moet het totale klantenbestand als
 * uitgangspunt zien en dat vervolgens versmallen. Een lege doelgroep die 0
 * toont voelt als een fout.
 */
export function definitieNaarSql(def: RegelGroep | null | undefined): SQL {
  if (!def || !Array.isArray(def.regels) || !def.regels.length) return sql`true`;
  const delen = def.regels
    .map((r) => (isGroep(r) ? definitieNaarSql(r) : regelNaarSql(r)))
    .filter((x): x is SQL => x !== null);
  if (!delen.length) return sql`true`;
  const koppel = def.op === "of" ? sql` or ` : sql` and `;
  return sql`(${sql.join(delen, koppel)})`;
}

/**
 * Controleer een definitie vóór opslag. Geeft per fout een leesbare melding
 * terug, zodat de portal kan zeggen wát er mis is in plaats van "ongeldig".
 */
export function valideerDefinitie(def: unknown, diepte = 0): string[] {
  const fouten: string[] = [];
  if (diepte > 4) return ["Regels zijn te diep genest (maximaal 4 niveaus)."];
  const g = def as RegelGroep;
  if (!g || (g.op !== "en" && g.op !== "of")) return ["Ontbrekende of onbekende koppeling (en/of)."];
  if (!Array.isArray(g.regels)) return ["Regels ontbreken."];
  if (g.regels.length > 50) fouten.push("Meer dan 50 regels in één groep — splits dit op.");

  for (const r of g.regels) {
    if (isGroep(r)) {
      fouten.push(...valideerDefinitie(r, diepte + 1));
      continue;
    }
    const veld = VELD_INDEX.get(r.veld);
    if (!veld) {
      fouten.push(`Onbekend veld: ${String(r.veld).slice(0, 40)}`);
      continue;
    }
    const op = OPERATOREN[veld.type].find((o) => o.key === r.operator);
    if (!op) {
      fouten.push(`"${veld.label}" kent de bewerking "${String(r.operator).slice(0, 30)}" niet.`);
      continue;
    }
    if (op.waarden >= 1 && (r.waarde === undefined || r.waarde === null || r.waarde === "")) {
      fouten.push(`"${veld.label}" mist een waarde.`);
    }
    if (op.waarden === 2 && (r.waarde2 === undefined || r.waarde2 === null || r.waarde2 === "")) {
      fouten.push(`"${veld.label}" mist de tweede waarde.`);
    }
  }
  return fouten;
}

/** Leesbare samenvatting van een definitie — voor de doelgroeplijst in de portal. */
export function omschrijfDefinitie(def: RegelGroep | null | undefined): string {
  if (!def?.regels?.length) return "Alle klanten";
  const delen = def.regels.map((r) => {
    if (isGroep(r)) return `(${omschrijfDefinitie(r)})`;
    const veld = VELD_INDEX.get(r.veld);
    if (!veld) return "?";
    const op = OPERATOREN[veld.type]?.find((o) => o.key === r.operator);
    const waarde = Array.isArray(r.waarde) ? r.waarde.join(", ") : String(r.waarde ?? "");
    const tweede = r.waarde2 !== undefined && r.waarde2 !== "" ? ` en ${r.waarde2}` : "";
    return `${veld.label} ${op?.label ?? r.operator}${waarde ? ` ${waarde}${tweede}` : ""}`.trim();
  });
  return delen.join(def.op === "of" ? " OF " : " EN ");
}
