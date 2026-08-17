/**
 * Pure PIM-regels: welke velden bewerkbaar zijn, wat een geldige waarde is,
 * waar de compleetheidsscore uit opgebouwd is, en welke velden de SRS-import
 * met rust moet laten.
 *
 * Bewust een los JS-bestand zonder Next- of drizzle-imports zodat `node --test`
 * erbij kan (zelfde patroon als lib/ab-regels.js). lib/pim.ts hangt hier de
 * SQL-condities en de database-kant aan.
 *
 * De reden dat juist dit onder test staat: `products.handmatige_velden` bestond
 * jaren als kolom en werd door niemand gelezen — het slot zat op de deur zonder
 * schoot, en elke import wiste de verrijking. De laatste test in
 * test/pim-regels.test.js bewaakt dat die situatie niet terugkomt.
 */

/** @typedef {{sleutel: string, kolom: string, label: string, type: "tekst"|"keuze", opties?: string[], maxLengte: number, uitleg: string, bulk: boolean}} PimVeld */

/**
 * De kolommen op `products` die een mens mag zetten.
 * @type {PimVeld[]}
 */
export const PIM_VELDEN = [
  {
    sleutel: "title",
    kolom: "title",
    label: "Titel",
    type: "tekst",
    maxLengte: 300,
    uitleg: "Wat de klant als productnaam ziet. De kleurvariant-groepering leest hier ook uit mee.",
    bulk: false,
  },
  {
    sleutel: "vendor",
    kolom: "vendor",
    label: "Merk",
    type: "tekst",
    maxLengte: 120,
    uitleg: "Het merk zoals het op de merkpagina en in de filters staat.",
    bulk: true,
  },
  {
    sleutel: "productType",
    kolom: "product_type",
    label: "Producttype",
    type: "tekst",
    maxLengte: 120,
    uitleg: "Grove indeling. De PLP filtert op de hoofdgroep uit de metavelden, niet hierop.",
    bulk: true,
  },
  {
    sleutel: "status",
    kolom: "status",
    label: "Status",
    type: "keuze",
    /**
     * `unlisted` hoort er wél bij en is zelfs de GROOTSTE groep: 1.606 van de
     * 2.973 artikelen op productie staan zo. Hij ontbrak in de eerste versie,
     * met twee gevolgen: het bewerkscherm toonde bij zo'n artikel de eerste
     * optie ("active") terwijl de waarde iets anders was — je las dus dat een
     * verborgen artikel live stond — en de lijst kon er niet op filteren.
     *
     * De volgorde is die van zichtbaarheid, niet alfabetisch: wat de klant ziet
     * bovenaan.
     */
    opties: ["active", "unlisted", "draft", "archived"],
    maxLengte: 20,
    uitleg:
      "Alleen 'active' komt op de site, en dan nog alleen mét foto en voorraad. 'unlisted' = wel in de database, niet in de winkel.",
    bulk: true,
  },
  {
    sleutel: "variantColorLabel",
    kolom: "variant_color_label",
    label: "Kleurlabel",
    type: "tekst",
    maxLengte: 120,
    uitleg: 'De kleurnaam van dít artikel binnen de kleurgroep, bv. "marine".',
    bulk: false,
  },
];

/**
 * De override-laag: velden die naar app_settings gaan in plaats van naar
 * `products`, omdat de productpagina dáár leest. Geen slot nodig — een import
 * komt er niet bij.
 */
export const PIM_LAGEN = [
  { sleutel: "descriptionHtml", label: "Omschrijving", maxLengte: 8000 },
  { sleutel: "seoTitle", label: "SEO-titel", maxLengte: 200 },
  { sleutel: "seoDescription", label: "SEO-omschrijving", maxLengte: 320 },
];

/**
 * Waar een artikel aan moet voldoen om "af" te zijn — labels en zwaarte.
 * De bijbehorende SQL-condities staan in lib/pim.ts, op dezelfde sleutels.
 * Zwaarte: 3 = het artikel functioneert niet zonder, 2 = belangrijk,
 * 1 = verrijking.
 */
export const PIM_CHECK_META = [
  { sleutel: "foto", label: "Foto", gewicht: 3, uitleg: "Zonder foto laat de catalogus het artikel niet zien." },
  { sleutel: "sku", label: "SKU op de varianten", gewicht: 3, uitleg: "De sku is de sleutel naar de voorraad. Zonder sku is het artikel niet te verkopen." },
  { sleutel: "prijs", label: "Prijs", gewicht: 3, uitleg: "Minstens één variant met een prijs boven nul." },
  { sleutel: "omschrijving", label: "Omschrijving", gewicht: 3, uitleg: "Minstens 120 tekens échte tekst (HTML-tags tellen niet mee)." },
  { sleutel: "seoTitel", label: "SEO-titel", gewicht: 2, uitleg: "Eigen meta-titel; anders valt Google terug op de productnaam." },
  { sleutel: "seoOmschrijving", label: "SEO-omschrijving", gewicht: 2, uitleg: "Eigen meta-omschrijving; anders knipt Google de eerste 160 tekens van de tekst." },
  { sleutel: "merk", label: "Merk", gewicht: 2, uitleg: "Uit het merkveld of het metaveld 'merk'. Voedt de merkpagina en het filter." },
  { sleutel: "categorie", label: "Categorie", gewicht: 2, uitleg: "Producttype of hoofdgroep. Zonder categorie valt het artikel uit de navigatie." },
  { sleutel: "materiaal", label: "Materiaal", gewicht: 1, uitleg: "Materiaal of samenstelling — de meest gestelde vraag bij formele kleding." },
  { sleutel: "pasvorm", label: "Pasvorm", gewicht: 1, uitleg: "Slim fit, modern fit — voedt het maatadvies." },
  { sleutel: "kleur", label: "Kleurlabel", gewicht: 1, uitleg: "Nodig om kleurvarianten als één artikel te tonen." },
  { sleutel: "modelbeeld", label: "Modelfoto", gewicht: 1, uitleg: "Beeld uit de modellen-studio; leidt de galerij op de productpagina." },
];

export const PIM_MAX_SCORE = PIM_CHECK_META.reduce((n, c) => n + c.gewicht, 0);

/**
 * Welke kolommen de SRS-import met rust moet laten als het bijbehorende veld
 * vergrendeld is. Dit is de lijst die lib/catalog-import.ts moet nakomen; de
 * test bewaakt dat.
 *
 * `variantColorLabel` staat er niet bij: die kolom wordt niet door de import
 * gezet maar door de kleurgroepering afgeleid. Een slot beloven op een veld
 * waar de import toch niet aan komt is alleen maar verwarrend.
 *
 * `descriptionHtml`, `seoTitle` en `seoDescription` staan er wél bij terwijl het
 * PIM ze via de override-laag bewerkt: het slot is generiek, en als er ooit
 * rechtstreeks op de kolom gezet wordt hoort de import er ook dan vanaf te
 * blijven.
 */
export const IMPORT_BESCHERMD = [
  { sleutel: "title", kolom: "title" },
  { sleutel: "descriptionHtml", kolom: "description_html" },
  { sleutel: "vendor", kolom: "vendor" },
  { sleutel: "productType", kolom: "product_type" },
  { sleutel: "status", kolom: "status" },
  { sleutel: "seoTitle", kolom: "seo_title" },
  { sleutel: "seoDescription", kolom: "seo_description" },
];

const VELD_OP_SLEUTEL = new Map(PIM_VELDEN.map((v) => [v.sleutel, v]));

/** Het veld achter een sleutel, of undefined. */
export function veldVoor(sleutel) {
  return VELD_OP_SLEUTEL.get(sleutel);
}

/**
 * Valideert en normaliseert één waarde.
 * @returns {{ok: true, waarde: string} | {ok: false, error: string}}
 */
export function valideerVeld(sleutel, ruw) {
  const veld = VELD_OP_SLEUTEL.get(sleutel);
  if (!veld) return { ok: false, error: `Onbekend veld: ${sleutel}.` };
  const waarde = String(ruw ?? "").slice(0, veld.maxLengte).trim();
  if (veld.type === "keuze" && !(veld.opties || []).includes(waarde)) {
    return { ok: false, error: `Ongeldige waarde voor ${veld.label}: "${waarde}".` };
  }
  /* De titel is de enige die niet leeg mag: een product zonder naam is in elke
     lijst, zoekopdracht en orderregel een lege regel. De rest mag je bewust
     leegmaken — dat betekent "deze verrijking klopte niet". */
  if (veld.sleutel === "title" && !waarde) return { ok: false, error: "De titel mag niet leeg zijn." };
  return { ok: true, waarde };
}

/**
 * De compleetheidsscore (0-100) uit een map check-sleutel → geslaagd.
 * Dezelfde rekensom als compleetheidScoreSql() in lib/pim.ts — die draait 'm in
 * postgres over de hele catalogus, deze hier is voor losse berekeningen en voor
 * de test die de gewichten vastlegt.
 */
export function scoreUit(checks) {
  let behaald = 0;
  for (const c of PIM_CHECK_META) if (checks && checks[c.sleutel]) behaald += c.gewicht;
  return Math.round((100 * behaald) / PIM_MAX_SCORE);
}

/** Het label van een logboek-veld, voor de portal. */
export function veldLabel(veld) {
  if (typeof veld !== "string") return String(veld ?? "");
  if (veld.startsWith("attr:")) return `Metaveld · ${veld.slice(5)}`;
  if (veld.startsWith("override:")) return "Omschrijving (eigen tekst)";
  if (veld === "seo:title") return "SEO-titel";
  if (veld === "seo:description") return "SEO-omschrijving";
  const v = VELD_OP_SLEUTEL.get(veld);
  return v ? v.label : veld;
}

/** De slot-sleutel van een metaveld. Eén plek, want de import leest 'm ook. */
export function metaSlotSleutel(naam) {
  return `attr:${naam}`;
}
