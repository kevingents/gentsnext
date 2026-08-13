/**
 * Pure regels van de klik-heatmap, zonder Next- of DB-afhankelijkheden, zodat
 * `node --test` erbij kan (zelfde opzet als lib/ab-regels.js). lib/heatmap-
 * paginas.ts zet er de types omheen en regelt het locale-prefix.
 *
 * Wat hier staat is precies het deel waar een stille fout het duurst is: welke
 * pagina's gemeten worden, en wat er in een label terechtkomt. Een te ruime
 * regex meet ineens de bestelpagina mee; een lekkend label zet een klantnaam in
 * de database. Vandaar tests op deze twee.
 */

/** @typedef {"mobiel"|"tablet"|"desktop"} Apparaat */

export const APPARATEN = ["mobiel", "tablet", "desktop"];

/**
 * De breedte waarop de viewer de pagina rendert. Klik-x staat in promille van
 * de vensterbreedte, dus elke breedte binnen de emmer valt op dezelfde plek —
 * maar de voorbeeldweergave moet ergens op renderen, en dat moet een breedte
 * zijn die écht in die emmer valt.
 */
export const REFERENTIE_BREEDTE = { mobiel: 390, tablet: 834, desktop: 1440 };

/** Zelfde grenzen als de Tailwind-breakpoints md (768) en lg (1024). */
export function apparaatVoorBreedte(breedte) {
  const b = Number(breedte) || 0;
  if (b < 768) return "mobiel";
  if (b < 1024) return "tablet";
  return "desktop";
}

/**
 * De gemeten pagina's — een ALLOWLIST, geen bloklijst. Dat is niet uit
 * zuinigheid maar uit privacy: op /bestelling/[orderNumber], /account,
 * /review/[orderNumber] en /vraag/[ref] staat klantinformatie, en een heatmap
 * die dáár klikposities en elementteksten verzamelt is een datalek in de dop.
 * Staat een pagina er niet in, dan wordt hij niet gemeten — punt.
 *
 * Een pagina toevoegen = hier één regel, en eerst nagaan of er klantgegevens
 * op staan.
 */
const SJABLONEN = [
  { key: "/", titel: "Homepage", test: /^\/$/ },
  { key: "/products/[handle]", titel: "Productpagina (PDP)", test: /^\/products\/[^/]+$/ },
  { key: "/categorie/[slug]", titel: "Categorie (PLP)", test: /^\/categorie\/[^/]+$/ },
  { key: "/collections/[handle]", titel: "Collectie (PLP)", test: /^\/collections\/[^/]+$/ },
  { key: "/collections", titel: "Alle collecties", test: /^\/collections$/ },
  { key: "/zoeken", titel: "Zoekresultaten", test: /^\/zoeken$/ },
  { key: "/winkelwagen", titel: "Winkelwagen", test: /^\/winkelwagen$/ },
  { key: "/afrekenen", titel: "Afrekenen", test: /^\/afrekenen$/ },
];

export const GEMETEN_PAGINAS = SJABLONEN.map((s) => ({ key: s.key, titel: s.titel }));

export function titelVoorPagina(key) {
  const s = SJABLONEN.find((x) => x.key === key);
  return s ? s.titel : String(key || "");
}

/**
 * Kaal pad (zónder locale-prefix) → paginasjabloon. Lege string = niet meten.
 *
 * Querystring en hash gaan eraf. Dat is niet alleen opruimen: `/zoeken?q=…`
 * draagt de zoekterm mee en `?utm_…` de campagne, en die horen niet als
 * onderdeel van een paginasleutel in een aggregatietabel te belanden.
 */
export function sjabloonVoorKaalPad(pad) {
  if (!pad) return "";
  let p = String(pad).split("?")[0].split("#")[0];
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  const s = SJABLONEN.find((x) => x.test.test(p));
  return s ? s.key : "";
}

/**
 * Pagina's waarop we GEEN elementtekst vastleggen. Op /afrekenen staan de
 * bezorg- en factuurgegevens van de klant, en een opgeslagen adres zit in een
 * <label> om de radioknop heen — dan legt een "labeltje bij de klik" ineens een
 * naam en adres vast. De selector blijft wél bewaard, dus de heatmap werkt er
 * gewoon; alleen de leesbare naam ontbreekt in de elementenlijst.
 */
const GEEN_LABELS = new Set(["/afrekenen"]);

export function magLabelVastleggen(paginaKey) {
  return !GEEN_LABELS.has(paginaKey);
}

/**
 * Patronen die nooit in een label mogen staan. Labels komen van links en
 * knoppen — daar hoort geen persoonsgegeven in — maar "hoort niet" is geen
 * garantie, dus we halen het er hoe dan ook uit. Zowel de browser als de server
 * draait dit; de server omdat een aangepaste client alles kan sturen.
 */
const PII_PATRONEN = [
  /[\w.+-]+@[\w-]+\.[\w.]{2,}/g, // e-mailadres
  /\b(?:\+31|0031|0)\s?6[\s.-]?\d{4}[\s.-]?\d{4}\b/g, // 06-nummer
  /\b\d{4}\s?[A-Za-z]{2}\b/g, // postcode
  /\b[A-Z]{2}\d{2}[A-Z0-9]{9,}\b/g, // IBAN
  /\b\d{5,}\b/g, // order-, klant- en bonnummers
];

const MAX_LABEL = 60;

/**
 * Maakt een klik-label geschikt om op te slaan: witruimte plat, mogelijke
 * persoonsgegevens eruit, afgekapt op 60 tekens. Levert "" als er niets
 * zinnigs overblijft — liever geen label dan een half gemaskeerd stukje
 * klanttekst.
 */
export function schoonLabel(ruw) {
  let s = String(ruw || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  for (const p of PII_PATRONEN) s = s.replace(p, "");
  s = s.replace(/\s+/g, " ").trim();
  if (s.length > MAX_LABEL) s = `${s.slice(0, MAX_LABEL - 1).trimEnd()}…`;
  return s.replace(/[…\s]/g, "").length >= 2 ? s : "";
}

/**
 * Van opgeslagen selector naar een echte CSS-selector. `@iets` staat voor een
 * `data-heat`-markering; die zetten we hier terug.
 */
export function selectorNaarCss(selector) {
  return String(selector || "")
    .split(">")
    .map((deel) => (deel.startsWith("@") ? `[data-heat="${deel.slice(1)}"]` : deel))
    .join(" > ");
}

/**
 * Diepste drempel die nog door minstens de helft van de weergaven gehaald is.
 * `buckets` is een Map van drempel (0,5,…,100) naar aantal weergaven dat die
 * drempel haalde; bucket 0 is dus het totaal.
 */
export function medianeUitBuckets(buckets) {
  const totaal = buckets.get(0) || 0;
  if (totaal <= 0) return 0;
  let mediaan = 0;
  for (const b of [...buckets.keys()].sort((a, z) => a - z)) {
    if ((buckets.get(b) || 0) * 2 >= totaal) mediaan = b;
  }
  return mediaan;
}

/** Rastermaat van de rollup: 50 kolommen breed, rijen van 20 CSS-pixels hoog. */
export const CEL_KOLOMMEN = 50;
export const CEL_RIJ_PX = 20;
