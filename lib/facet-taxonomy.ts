/**
 * Filter-taxonomie: rauwe catalogus-waarden → begrijpelijke filterkeuzes.
 *
 * De bron levert samenstellingen ("Polyester viscose", "Wol polyester viscose
 * lin") en losse motieven ("Varens", "Pelikaan", "Palmblad") als aparte
 * waarden. Dat gaf 80 materialen en 43 dessins, waarvan tientallen met één of
 * twee producten — en een klant die op wol zoekt miste alles waar wol ín zit.
 *
 * Daarom bucketen we op HOOFDCOMPONENT en matchen we in de query op patroon:
 * "Wol" vindt ook "Polyester wol". Eén product kan in meerdere buckets vallen
 * (een wol-polyestermix staat onder beide) — dat is wat de klant verwacht.
 *
 * De bucket-naam staat in de URL; onbekende waarden vallen terug op een exacte
 * match, zodat oude/gedeelde filterlinks blijven werken.
 */

export type FacetBucket = {
  /** Zichtbare naam én URL-waarde. */
  key: string;
  /** Herkent de rauwe bronwaarde (case-insensitief). */
  match: RegExp;
  /** Postgres-regex voor de filterquery (zonder flags; we matchen met ~*). */
  sql: string;
};

/** Volgorde = weergavevolgorde; specifieke stoffen vóór de generieke. */
export const MATERIAL_BUCKETS: FacetBucket[] = [
  // Geen woordgrens áchter "wol": anders viel "Wolblend"/"wollen" buiten de bucket.
  { key: "Wol", match: /\bwol|merino|tweed/i, sql: "wol|merino|tweed" },
  { key: "Kasjmier", match: /kasjmier|cashmere/i, sql: "kasjmier|cashmere" },
  { key: "Katoen", match: /katoen|cotton|twill|piqué|pique/i, sql: "katoen|cotton|twill|piqu" },
  { key: "Linnen", match: /linnen|linen|\blin\b/i, sql: "linnen|linen|(^|[^a-z])lin([^a-z]|$)" },
  { key: "Zijde", match: /zijde|silk/i, sql: "zijde|silk" },
  { key: "Leer", match: /\bleer\b|leder|suède|suede|nubuck/i, sql: "leer|leder|su[èe]de|nubuck" },
  { key: "Denim", match: /denim|jeans/i, sql: "denim|jeans" },
  { key: "Viscose", match: /viscose|lyocell|modal|tencel|bamboe/i, sql: "viscose|lyocell|modal|tencel|bamboe" },
  { key: "Polyester", match: /polyester|\bpoly\b/i, sql: "polyester" },
  { key: "Stretch", match: /elasta|spandex|elastane|stretch/i, sql: "elasta|spandex|stretch" },
];

/** Dessins: motieven samengevat tot wat een klant zoekt. */
export const PATTERN_BUCKETS: FacetBucket[] = [
  { key: "Gestreept", match: /streep|strepen|stripe/i, sql: "streep|stripe" },
  { key: "Geruit", match: /ruit|check|pied-de-poule|glencheck|tartan|schotse/i, sql: "ruit|check|pied-de-poule|glencheck|tartan" },
  { key: "Bloemen & botanisch", match: /bloem|floral|blad|varen|palm|plant|botanisch/i, sql: "bloem|floral|blad|varen|palm|plant|botanisch" },
  { key: "Stippen & cirkels", match: /stip|dot|cirkel|bol|punt/i, sql: "stip|dot|cirkel|bol" },
  { key: "Paisley", match: /paisley/i, sql: "paisley" },
  { key: "Structuur", match: /structuur|melange|mélange|honingraat|birdseye|weef|jacquard|rib/i, sql: "structuur|m[eé]lange|honingraat|birdseye|weef|jacquard|rib" },
  { key: "Dieren & figuren", match: /pelikaan|vogel|dier|vis|zee|anker|olifant|hert|paard|schaap/i, sql: "pelikaan|vogel|dier|vis|zee|anker|olifant|hert|paard|schaap" },
];

/** In welke buckets valt deze rauwe waarde? (kan er meer dan één zijn) */
/** Drempel voor waarden die in géén bucket vallen (staart-onderdrukking). */
export const LOOSE_MIN_COUNT = 5;

export function bucketsFor(raw: string, buckets: FacetBucket[]): string[] {
  const v = (raw || "").trim();
  if (!v) return [];
  const hits = buckets.filter((b) => b.match.test(v)).map((b) => b.key);
  // Geen enkele bucket herkend → de waarde zelf blijft bruikbaar als filter,
  // maar alleen als 'ie kort en leesbaar is (geen samenstelling van 3 stoffen).
  if (!hits.length && v.split(/[\s,/+]+/).length <= 2) return [v];
  return hits;
}

/** Postgres-patroon voor een bucket-key; null = geen bucket (exacte match). */
export function sqlPatternFor(key: string, buckets: FacetBucket[]): string | null {
  return buckets.find((b) => b.key === key)?.sql ?? null;
}

/* ─────────────────────────────── Type (subgroep) ─────────────────────────
 *
 * `subgroep` uit de bron zegt alleen iets BINNEN zijn hoofdgroep: bij
 * stropdassen is het de stof (Zijde/Poly), bij overhemden de mouwlengte, bij
 * pakken het aantal delen. Alles in één "Type"-lijst gooien gaf op een listing
 * die soorten mengt (Nieuwe collectie, Alle producten, Grote maten) een rij
 * waar een klant niets mee kan: "Zijde 55 · 2-delig 11 · Casual 10 · Lange
 * mouw 10 · Riva 2".
 *
 * Daarom kiest de klant eerst SOORT (hoofdgroep) en toont het type-filter
 * alleen de subgroepen van die soort. Daarbovenop poetsen we de bronwaarden:
 *  - materialen eruit: Zijde/Poly/Katoen/Leer/Suede staan al in het
 *    materiaal-filter, en vinden daar óók de mixen ("Zijde katoen linnen");
 *  - synonymen samengevoegd (Turtleneck + Coltrui, Halfzip + Halfzip knopen);
 *  - Engels naar Nederlands (V-neck → V-hals, Full-zip → Met rits);
 *  - modelnamen die buiten de winkel niemand kent eruit (Riva);
 *  - waarden die letterlijk de hoofdgroep herhalen eruit (Sokken → Sokken).
 *
 * De genormaliseerde naam staat in de URL; expandType() zet 'm terug naar alle
 * rauwe bronwaarden, zodat oude en gedeelde filterlinks blijven werken.
 */
const TYPE_NORMALISATIE: Record<string, string> = {
  "Pakken Modern Fit": "Pakken",
  "Pakken Slim Fit": "Pakken",
  MM: "Mix & match",
  "Gilet MM": "Mix & match",
  // Turtleneck en coltrui zijn hetzelfde kledingstuk; ze stonden als twee
  // losse keuzes van 19 en 17 naast elkaar in dezelfde lijst.
  Turtleneck: "Coltrui",
  "V-neck": "V-hals",
  Rond: "Ronde hals",
  "Halfzip knopen": "Halfzip",
  // Sluiting in gewone taal, en in beide categorieën hetzelfde woord: "Rits"
  // stond bij polo's, "Full-zip" bij vesten.
  "Full-zip": "Met rits",
  Rits: "Met rits",
  Knopen: "Met knopen",
};

/** Interne/technische waarden en modelnamen: geen klantfilter. */
const TYPE_VERBERG = new Set([
  "Verpakking",
  "Verpakkingsmateriaal",
  "Onbekend",
  "Overig",
  "Diversen",
  // Interne stof-/modelnaam ("Polo riva katoen") — zegt de klant niets.
  "Riva",
]);

/** Materiaalwoorden die tóch een echt type zijn: een jeans is geen stofkeuze. */
const TYPE_MATERIAAL_UITZONDERING = new Set(["Jeans", "Denim"]);

/** Onder deze telling is een type-keuze meer ruis dan hulp. */
export const TYPE_MIN_COUNT = 2;

/** Alleen letters, zodat "T-Shirts" en "t shirts" hetzelfde zijn. */
const kaal = (v: string) => v.toLowerCase().replace(/[^a-z]/g, "");

/** Staat deze typewaarde eigenlijk voor een materiaal? Dan hoort 'ie daar. */
function isMateriaalWaarde(v: string): boolean {
  if (TYPE_MATERIAAL_UITZONDERING.has(v)) return false;
  return MATERIAL_BUCKETS.some((b) => b.match.test(v));
}

/** Genormaliseerde typenaam → alle rauwe bronwaarden die eronder vallen. */
export function expandType(normalized: string): string[] {
  const uit = [normalized];
  for (const [raw, norm] of Object.entries(TYPE_NORMALISATIE)) {
    if (norm === normalized) uit.push(raw);
  }
  return uit;
}

/**
 * Rauwe subgroep → zichtbare typenaam, of null als het geen filterkeuze hoort
 * te zijn. `hoofdgroep` is optioneel: zonder soort kunnen we de "herhaalt de
 * kop"-regel niet toepassen, de rest wél.
 */
export function normalizeType(raw: string, hoofdgroep = ""): string | null {
  const v = (raw || "").trim();
  if (!v || TYPE_VERBERG.has(v)) return null;
  if (isMateriaalWaarde(v)) return null;
  if (hoofdgroep && kaal(v) === kaal(hoofdgroep)) return null;
  return TYPE_NORMALISATIE[v] ?? v;
}
