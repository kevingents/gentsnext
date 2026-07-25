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

/**
 * Interne/technische typewaarden die geen klantfilter horen te zijn, plus
 * normalisaties (pasvorm hoort in het pasvorm-filter, niet in het type).
 */
const TYPE_NORMALISATIE: Record<string, string> = {
  "Pakken Modern Fit": "Pakken",
  "Pakken Slim Fit": "Pakken",
  "Gilet MM": "Gilet (mix & match)",
  MM: "Mix & match",
};
const TYPE_VERBERG = new Set(["Knopen", "Verpakking", "Verpakkingsmateriaal", "Onbekend", "Overig", "Diversen"]);

/** Genormaliseerde typenaam → alle rauwe bronwaarden die eronder vallen. */
export function expandType(normalized: string): string[] {
  const uit = [normalized];
  for (const [raw, norm] of Object.entries(TYPE_NORMALISATIE)) {
    if (norm === normalized) uit.push(raw);
  }
  return uit;
}

export function normalizeType(raw: string): string | null {
  const v = (raw || "").trim();
  if (!v || TYPE_VERBERG.has(v)) return null;
  return TYPE_NORMALISATIE[v] ?? v;
}
