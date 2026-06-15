/**
 * Kleurvarianten afleiden uit de producttitel.
 *
 * Veel artikelen staan in de catalogus als losse producten die alleen in kleur
 * verschillen — het duidelijkst bij stropdassen ("Stropdas PE rood", "Stropdas
 * PE blauw", …) en sets ("Set das manchet pochet rood/blauw/…"). We voegen die
 * samen tot één product met kleurkeuze.
 *
 * AANPAK (bewust conservatief, zodat het kloppend en duidelijk blijft):
 * - We strippen alleen een KLEUR/DESSIN-RUN AAN HET EIND van de titel.
 *   "Stropdas PE off-white" → basis "Stropdas PE", kleur "off-white".
 * - Zit de kleur middenin de titel (bv. "GENTS Luxe Rood-Witte Zijde Stropdas"),
 *   dan strippen we niets → het product blijft op zichzelf staan. Liever geen
 *   groep dan een verkeerde groep.
 * - De basis moet minimaal 2 betekenisvolle woorden houden, anders geen groep.
 */

const COLOR_WORDS = new Set([
  "blauw", "lichtblauw", "donkerblauw", "navy", "kobaltblauw", "royalblue", "royal",
  "marineblauw", "staalblauw", "petrol", "aqua", "turquoise", "jeansblauw", "witblauw",
  "zwart", "antraciet", "antra", "grijs", "lichtgrijs", "donkergrijs", "blauwgrijs", "grijsbruin",
  "wit", "offwhite", "off-white", "ecru", "creme", "crème", "gebroken",
  "bruin", "cognac", "camel", "taupe", "chocolade", "khaki", "kaki",
  "groen", "lichtgroen", "donkergroen", "olijfgroen", "olijf", "mintgroen", "mint", "flessengroen", "legergroen",
  "rood", "donkerrood", "bordeaux", "wijnrood", "kersrood", "rood-wit", "roodwit",
  "beige", "zand", "sand", "taupe", "champagne", "champagnebeige", "kaki",
  "roze", "oudroze", "fuchsia", "lila", "paars", "lichtpaars", "donkerpaars", "aubergine",
  "geel", "goudgeel", "okergeel", "oker", "mosterd", "mosterdgeel",
  "oranje", "zalm", "koraal",
  "goud", "zilver", "brons", "multikleur", "multi",
]);

const PATTERN_WORDS = new Set([
  "stip", "stippen", "streep", "strepen", "gestreept", "ruit", "ruiten", "geruit", "geblokt",
  "paisley", "structuur", "gestructureerd", "bloem", "bloemen", "fijn", "mix", "dessin",
  "print", "vierkant", "textuur", "glad", "motief", "effen", "uni", "fantasie", "blok",
]);

const CONNECTORS = new Set(["met", "en", "/", "-", "&", "+", "in"]);

function deburr(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function tokenize(title: string): string[] {
  return deburr(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s/+&-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Maximaal aantal kleuren in één groep. Grotere "groepen" (bv. 169 zijden
 * stropdassen onder één generieke basis) zijn vrijwel altijd verschillende
 * dessins, geen kleurvarianten — die laten we los staan. Liever duidelijk dan
 * over-gegroepeerd.
 */
export const MAX_GROUP_SIZE = 24;

export type DerivedVariant = {
  /** Genormaliseerde basisnaam (zonder kleur-suffix). Leeg = niet groepeerbaar. */
  baseKey: string;
  /** Mooie kleur-/dessinlabel uit het gestripte deel ("rood met stip"). */
  colorLabel: string;
};

/**
 * Splitst een titel in een basis + trailing kleurlabel. Geeft baseKey="" terug
 * als er geen veilige groepering te maken is.
 */
export function deriveVariant(title: string, hoofdgroep = ""): DerivedVariant {
  const tokens = tokenize(title);
  if (tokens.length < 2) return { baseKey: "", colorLabel: "" };

  // Loop van achteren: verzamel een aaneengesloten run van PURE KLEUR-woorden
  // (en connectors daartussen). PATROON-woorden (stip/ruit/print/…) breken de
  // run bewust af: die horen bij het dessin, niet bij de kleur — zo blijven
  // verschillende dessins aparte producten.
  let cut = tokens.length;
  let sawColor = false;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const tok = tokens[i];
    if (COLOR_WORDS.has(tok)) {
      sawColor = true;
      cut = i;
    } else if (CONNECTORS.has(tok) && sawColor) {
      cut = i;
    } else {
      break;
    }
  }

  const baseTokens = tokens.slice(0, cut).filter((t) => !CONNECTORS.has(t));

  // Geen kleur gevonden, of basis te kort → niet groeperen.
  if (!sawColor || baseTokens.length < 2) return { baseKey: "", colorLabel: "" };
  // Pattern-woorden in de basis houden = ander dessin = aparte groep. Goed.

  const baseKey = baseTokens.join(" ") + "|" + deburr(hoofdgroep).toLowerCase();
  const colorLabel = titleCase(tokens.slice(cut).join(" "));
  return { baseKey, colorLabel };
}

function titleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
    .replace(/\boff-white\b/i, "Off-white");
}
