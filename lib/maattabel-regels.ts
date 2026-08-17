import type { ChartCategory, ChartRow, BoordRow, SizeChart } from "@/lib/size-chart";

/**
 * Het lezen en KEUREN van een geüpload maatblad.
 *
 * ALLEEN `import type` in dit bestand, en dat is geen stijlkeuze: de tests draaien
 * met `node --test` op de .ts rechtstreeks, en Node kent de `@/`-alias niet.
 * Types worden weggestript, waardes niet — dus wat de keuring aan lijstjes nodig
 * heeft (bekende categorieën, hoofdgroepen, catalogusmaten) krijgt hij als
 * KeurContext mee in plaats van dat het hier geïmporteerd wordt. Zelfde reden
 * dat de andere geteste modules in lib/ zelfstandig zijn.
 *
 * Waarom keuren en niet alleen inlezen: deze tabel bepaalt wat het maatadvies
 * adviseert aan iedere bezoeker. Een blad met een gat tussen maat 48 en 52 laat
 * de matcher "dichtstbijzijnde" pakken en dan adviseert hij stilletjes de
 * verkeerde maat — geen foutmelding, geen kapotte pagina, alleen klanten met een
 * colbert dat niet past. Dat wil je zien vóór je op activeren klikt.
 *
 * FOUT = we weigeren de upload (de site zou er slechter van worden).
 * WAARSCHUWING = we lezen hem in, maar de portal vertelt wat er raar is.
 */

export type MaatRij = {
  productType: "TOP" | "BOTTOM" | "FULL_BODY";
  categorie: string;
  maat: string;
  boordCm: string;
  borstMin: number | null;
  borstMax: number | null;
  tailleMin: number | null;
  tailleMax: number | null;
  binnenbeenMin: number | null;
  binnenbeenMax: number | null;
  sortering: number;
};

export type Bevinding = {
  ernst: "fout" | "waarschuwing";
  soort:
    | "kop-onvindbaar"
    | "maatkolom-ontbreekt"
    | "geen-rijen"
    | "onbekende-categorie"
    | "geen-maatgegevens"
    | "dubbele-maat"
    | "categorie-leeg"
    | "kerncategorie-ontbreekt"
    | "gat"
    | "overlap"
    | "niet-oplopend"
    | "boord-ontbreekt"
    | "catalogusmaat-zonder-rij";
  categorie?: string;
  maat?: string;
  /** Regelnummer in het blad, 1-gebaseerd inclusief de koprij. */
  regel?: number;
  tekst: string;
};

/**
 * Categorieën waar de site op leunt. Zonder colbertrijen kan recommendSizes geen
 * colbertmaat geven en zonder boordrijen geen boordmaat — dat zijn precies de
 * twee dingen die het maatadvies teruggeeft. Een blad zonder deze rijen mag niet
 * actief worden.
 */
const KERNCATEGORIEEN: ChartCategory[] = ["Colberts (Standaard)", "Overhemden (Boordmaat)"];

/**
 * Wat de keuring van buiten nodig heeft. Verplicht meegeven i.p.v. importeren
 * (zie de kop): zo kan het niet gebeuren dat een aanroeper de catalogus-controle
 * stil overslaat omdat hij een optioneel argument vergat.
 */
export type KeurContext = {
  /** Categorieën die de site kent — CHART_CATEGORIES uit lib/size-chart. */
  bekendeCategorieen: readonly string[];
  /** Categorie → hoofdgroepen, uit de maattabellen-hub. */
  hoofdgroepen: Map<string, string[]>;
  /** Hoofdgroep → maten die in de catalogus voorkomen. Weglaten = die check niet doen. */
  catalogusMaten?: Map<string, string[]>;
  /**
   * Maat → lettermaat-rij (sizeRowLabel uit lib/size-taxonomy), met de hoofdgroep
   * als familie.
   *
   * Waarom dit erbij moet: één hoofdgroep bevat meerdere maatsystemen door
   * elkaar. "Broeken" heeft standaardmaten (46–64), lengtematen (90–118) én
   * kwartmaten (23–33), terwijl de maattabel die in drie categorieën splitst.
   * Ruwe maten vergelijken meldt dan elke lengtemaat als "ontbreekt bij Pantalon
   * (Standaard)" — 56 valse bevindingen waar niemand meer naar kijkt. Op de
   * lettermaat-rij vergelijken stelt de vraag die telt: is er een rij waarmee het
   * maatadvies dít formaat kan omrekenen?
   */
  rijLabel?: (maat: string, hoofdgroep: string) => string;
  /**
   * Maat → maatsysteem (sizeGroup uit lib/size-taxonomy): 'regular' voor
   * standaardmaten, 'long' voor lengtematen, 'short' voor kwartmaten.
   *
   * Nodig omdat "Broeken" alle drie de systemen bevat terwijl de maattabel ze in
   * drie categorieën splitst. Zonder deze scheiding meldt Pantalon (Lang) de
   * kwartmaten als ontbrekend en omgekeerd.
   */
  maatGroep?: (maat: string) => "regular" | "long" | "short";
};

/** Welke categorieën gaan over precies één maatsysteem binnen hun hoofdgroep. */
const CATEGORIE_SYSTEEM: Record<string, "regular" | "long" | "short"> = {
  "Pantalon (Standaard)": "regular",
  "Pantalon (Lang)": "long",
  "Pantalon (Kwart)": "short",
};

/* ─────────────────────────── Koppen herkennen ─────────────────────────── */

/**
 * Kopsynoniemen. Ruim opgezet omdat het blad uit meerdere handen kan komen: de
 * Faslet-export is Engels, een met de hand bijgewerkt blad is Nederlands, en
 * iemand die het in Excel natypt schrijft "borst van" en "borst tot".
 */
const KOPPEN: Record<string, string[]> = {
  productType: ["producttype", "product type", "type", "soort"],
  categorie: ["categorie", "category", "groep"],
  maat: ["maat", "size", "confectiemaat", "confectie"],
  boord: ["boord", "boordmaat", "boord cm", "boord_cm", "collar", "hals", "halsomvang"],
  borst: ["borst", "borstomvang", "chest"],
  borstMin: ["borst min", "borstmin", "borst van", "chest min", "chestmin", "chest from"],
  borstMax: ["borst max", "borstmax", "borst tot", "chest max", "chestmax", "chest to"],
  taille: ["taille", "tailleomvang", "waist", "middel"],
  tailleMin: ["taille min", "taillemin", "taille van", "waist min", "waistmin", "waist from"],
  tailleMax: ["taille max", "taillemax", "taille tot", "waist max", "waistmax", "waist to"],
  binnenbeen: ["binnenbeen", "binnenbeenlengte", "inner leg", "innerleg", "inseam"],
  binnenbeenMin: ["binnenbeen min", "binnenbeenmin", "inner leg min", "innerlegmin", "inseam min"],
  binnenbeenMax: ["binnenbeen max", "binnenbeenmax", "inner leg max", "innerlegmax", "inseam max"],
};

function normaliseer(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[()._/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Welke kolom is welk veld. Langste synoniem eerst matchen: "borst min" moet
 * niet als "borst" wegvallen, want dan belandt een min-kolom in het
 * gecombineerde bereikveld en verdwijnt de max.
 */
function kolomkaart(kop: string[]): Record<string, number> {
  const kaart: Record<string, number> = {};
  const paren = Object.entries(KOPPEN).flatMap(([veld, syns]) => syns.map((s) => ({ veld, syn: s })));
  paren.sort((a, b) => b.syn.length - a.syn.length);

  kop.forEach((cel, i) => {
    const n = normaliseer(cel);
    if (!n) return;
    for (const { veld, syn } of paren) {
      if (kaart[veld] !== undefined) continue;
      if (n === syn || n.startsWith(syn + " ") || n.endsWith(" " + syn)) {
        kaart[veld] = i;
        return;
      }
    }
  });
  return kaart;
}

/** De koprij is de eerste rij waarin we een maat-kolom herkennen. */
function vindKop(rijen: string[][]): number {
  for (let i = 0; i < Math.min(rijen.length, 20); i++) {
    const kaart = kolomkaart(rijen[i]);
    if (kaart.maat !== undefined) return i;
  }
  return -1;
}

/* ─────────────────────────── Waarden lezen ─────────────────────────── */

function getal(v: string | undefined): number | null {
  if (v === undefined) return null;
  const s = String(v).replace(",", ".").replace(/[^\d.]/g, "");
  if (!s) return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * "96-100" → [96,100]; "107" → [107,107]; leeg → [null,null].
 *
 * Een puntwaarde is geen slordigheid: colbert en pak stáán zo in de bron
 * (maat 50 = 107 cm, geen bereik). Die betekenis houden we vast — min===max is
 * hoe pickByRange in size-chart een exacte treffer herkent.
 */
export function cmBereik(v: string | undefined): [number | null, number | null] {
  const s = String(v ?? "").trim();
  if (!s) return [null, null];
  const delen = s.split(/\s*(?:-|–|—|t\/m|tot|\/)\s*/).filter(Boolean);
  if (delen.length >= 2) {
    const lo = getal(delen[0]);
    const hi = getal(delen[1]);
    if (lo != null && hi != null) return lo <= hi ? [lo, hi] : [hi, lo];
    return [lo ?? hi, hi ?? lo];
  }
  const n = getal(s);
  return [n, n];
}

/** Boordtekst uniform als "39-40" — de site splitst daarop (boordByCollar). */
function boordTekst(v: string | undefined): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  const [lo, hi] = cmBereik(s);
  if (lo == null) return "";
  return hi == null || hi === lo ? String(lo) : `${lo}-${hi}`;
}

function productTypeVan(ruw: string, categorie: string): MaatRij["productType"] {
  const n = normaliseer(ruw);
  if (n.includes("full") || n.includes("body") || n.includes("pak")) return "FULL_BODY";
  if (n.includes("bottom") || n.includes("broek") || n.includes("pantalon")) return "BOTTOM";
  if (n.includes("top")) return "TOP";
  // Geen (bruikbare) typekolom? Leid het af uit de categorie — dat is waar het
  // in de praktijk toch uit volgt.
  const c = normaliseer(categorie);
  if (c.startsWith("pakken")) return "FULL_BODY";
  if (c.startsWith("pantalon") || c.startsWith("broek")) return "BOTTOM";
  return "TOP";
}

/* ─────────────────────────── Inlezen ─────────────────────────── */

/**
 * Blad → maatrijen + bevindingen. Leest zowel losse min/max-kolommen als één
 * gecombineerde kolom ("96-100"), want een blad dat iemand zelf bijhoudt heeft
 * bijna altijd het tweede.
 */
export function leesMaatblad(rijen: string[][]): { rijen: MaatRij[]; bevindingen: Bevinding[] } {
  const bevindingen: Bevinding[] = [];
  const kopIndex = vindKop(rijen);
  if (kopIndex < 0) {
    return {
      rijen: [],
      bevindingen: [{
        ernst: "fout",
        soort: "kop-onvindbaar",
        tekst: "Geen koprij gevonden. Zorg dat er een rij met kolomkoppen staat, met in elk geval een kolom \"Maat\" (of \"Size\").",
      }],
    };
  }

  const kaart = kolomkaart(rijen[kopIndex]);
  if (kaart.maat === undefined) {
    return {
      rijen: [],
      bevindingen: [{ ernst: "fout", soort: "maatkolom-ontbreekt", regel: kopIndex + 1, tekst: "De koprij heeft geen kolom \"Maat\"." }],
    };
  }

  const cel = (rij: string[], veld: string): string | undefined =>
    kaart[veld] === undefined ? undefined : rij[kaart[veld]];

  const uit: MaatRij[] = [];
  // Laatst geziene categorie: bladen laten de categoriekolom vaak leeg bij
  // vervolgrijen ("Colberts" staat alleen bij de eerste maat). Doorschuiven is
  // hier de juiste lezing, geen gok.
  let laatsteCategorie = "";
  const gezien = new Set<string>();

  for (let i = kopIndex + 1; i < rijen.length; i++) {
    const rij = rijen[i];
    const regel = i + 1;
    const maat = String(cel(rij, "maat") ?? "").trim();
    const categorieRuw = String(cel(rij, "categorie") ?? "").trim();
    if (categorieRuw) laatsteCategorie = categorieRuw;
    const categorie = categorieRuw || laatsteCategorie;

    // Volledig lege rij = een scheiding in het blad, geen fout.
    if (!maat && !categorieRuw && rij.every((c) => !c)) continue;
    if (!maat) continue;
    if (!categorie) {
      bevindingen.push({ ernst: "waarschuwing", soort: "onbekende-categorie", maat, regel, tekst: `Regel ${regel}: maat "${maat}" heeft geen categorie en is overgeslagen.` });
      continue;
    }

    const [borstMin, borstMax] = kaart.borstMin !== undefined || kaart.borstMax !== undefined
      ? [getal(cel(rij, "borstMin")), getal(cel(rij, "borstMax"))]
      : cmBereik(cel(rij, "borst"));
    const [tailleMin, tailleMax] = kaart.tailleMin !== undefined || kaart.tailleMax !== undefined
      ? [getal(cel(rij, "tailleMin")), getal(cel(rij, "tailleMax"))]
      : cmBereik(cel(rij, "taille"));
    const [beenMin, beenMax] = kaart.binnenbeenMin !== undefined || kaart.binnenbeenMax !== undefined
      ? [getal(cel(rij, "binnenbeenMin")), getal(cel(rij, "binnenbeenMax"))]
      : cmBereik(cel(rij, "binnenbeen"));

    const boordCm = boordTekst(cel(rij, "boord"));

    if (borstMin == null && tailleMin == null && beenMin == null && !boordCm) {
      bevindingen.push({ ernst: "waarschuwing", soort: "geen-maatgegevens", categorie, maat, regel, tekst: `Regel ${regel}: "${categorie} ${maat}" heeft geen enkele lichaamsmaat en is overgeslagen.` });
      continue;
    }

    const sleutel = `${categorie}||${maat}`;
    if (gezien.has(sleutel)) {
      bevindingen.push({ ernst: "waarschuwing", soort: "dubbele-maat", categorie, maat, regel, tekst: `Regel ${regel}: "${categorie} ${maat}" staat meer dan één keer in het blad; de eerste rij is gebruikt.` });
      continue;
    }
    gezien.add(sleutel);

    uit.push({
      productType: productTypeVan(String(cel(rij, "productType") ?? ""), categorie),
      categorie,
      maat,
      boordCm,
      // Één-punt-bereik houden: min===max is de "exacte maat"-betekenis.
      borstMin, borstMax: borstMax ?? borstMin,
      tailleMin, tailleMax: tailleMax ?? tailleMin,
      binnenbeenMin: beenMin, binnenbeenMax: beenMax ?? beenMin,
      sortering: uit.length,
    });
  }

  if (!uit.length) {
    bevindingen.push({ ernst: "fout", soort: "geen-rijen", tekst: "Er staat geen enkele bruikbare maatrij in dit blad." });
  }
  return { rijen: uit, bevindingen };
}

/* ─────────────────────────── Keuren ─────────────────────────── */

/**
 * De lettermaat-rijen die de taxonomie kent. Levert `rijLabel` iets anders op,
 * dan heeft hij die maat níet kunnen plaatsen ("20L", "26R", "32S", "One") en
 * zegt dat iets over de catalogus, niet over de maattabel. Zulke maten hier
 * melden levert per categorie dezelfde handvol onoplosbare regels op, en dan
 * kijkt niemand meer naar de rest.
 */
const RIJ_LABEL = /^(XXS|XS|S|M|M\/L|L|XL|XXL|3XL|4XL|5XL|6XL)$/;

/** Welke lichaamsmaat is leidend voor deze categorie — dat bepaalt waar gaten tellen. */
function leidendeMaat(categorie: string): "borst" | "taille" {
  return normaliseer(categorie).startsWith("pantalon") ? "taille" : "borst";
}

/**
 * Keurt een set maatrijen. Zit `catalogusMaten` in de context, dan checkt hij ook
 * of er verkochte maten zijn waar de tabel niets over zegt. Dat is de stille
 * fout die niemand ziet: de klant kiest maat 62, en het maatadvies kan er niets
 * mee omdat er geen rij voor bestaat.
 */
export function controleerTabel(rijen: MaatRij[], ctx: KeurContext): Bevinding[] {
  const bevindingen: Bevinding[] = [];
  const perCategorie = new Map<string, MaatRij[]>();
  for (const r of rijen) {
    if (!perCategorie.has(r.categorie)) perCategorie.set(r.categorie, []);
    perCategorie.get(r.categorie)!.push(r);
  }

  for (const kern of KERNCATEGORIEEN) {
    const rows = perCategorie.get(kern) ?? [];
    const bruikbaar = kern === "Overhemden (Boordmaat)"
      ? rows.filter((r) => r.boordCm && r.borstMin != null)
      : rows.filter((r) => r.borstMin != null);
    if (!bruikbaar.length) {
      bevindingen.push({
        ernst: "fout",
        soort: "kerncategorie-ontbreekt",
        categorie: kern,
        tekst: kern === "Overhemden (Boordmaat)"
          ? "Geen bruikbare boordmaten (categorie \"Overhemden (Boordmaat)\" met een boordkolom). Zonder deze rijen kan het maatadvies geen boordmaat geven."
          : "Geen bruikbare colbertrijen (categorie \"Colberts (Standaard)\" met borstmaten). Zonder deze rijen kan het maatadvies geen colbertmaat geven.",
      });
    }
  }

  for (const [categorie, rows] of perCategorie) {
    if (!ctx.bekendeCategorieen.includes(categorie)) {
      bevindingen.push({
        ernst: "waarschuwing",
        soort: "onbekende-categorie",
        categorie,
        tekst: `"${categorie}" is geen categorie die de site kent. De rijen zijn bewaard, maar er is geen maattabel-pagina die ze toont.`,
      });
    }

    const meet = leidendeMaat(categorie);
    const paar = (r: MaatRij): [number | null, number | null] =>
      meet === "borst" ? [r.borstMin, r.borstMax] : [r.tailleMin, r.tailleMax];

    const bruikbaar = rows.filter((r) => paar(r)[0] != null);
    if (!bruikbaar.length) {
      bevindingen.push({
        ernst: "waarschuwing",
        soort: "categorie-leeg",
        categorie,
        tekst: `"${categorie}" heeft geen enkele rij met een ${meet}maat; het maatadvies kan binnen deze categorie niets matchen.`,
      });
      continue;
    }

    // Op de leidende maat sorteren en niet op de maatnaam: "44" en "S" staan in
    // hetzelfde blad en sorteren alfabetisch tot onzin.
    const gesorteerd = [...bruikbaar].sort((a, b) => (paar(a)[0] ?? 0) - (paar(b)[0] ?? 0));

    for (let i = 0; i < gesorteerd.length - 1; i++) {
      const dit = gesorteerd[i];
      const volgend = gesorteerd[i + 1];
      const [, ditMax] = paar(dit);
      const [volgMin] = paar(volgend);
      if (ditMax == null || volgMin == null) continue;

      if (volgMin < ditMax) {
        bevindingen.push({
          ernst: "waarschuwing",
          soort: "overlap",
          categorie,
          maat: `${dit.maat} / ${volgend.maat}`,
          tekst: `${categorie}: maat ${dit.maat} loopt tot ${ditMax} cm terwijl ${volgend.maat} al bij ${volgMin} cm begint. Bij een ${meet}maat in dat gebied kiest de site de eerste van de twee.`,
        });
      } else if (volgMin > ditMax + 1) {
        // Puntwaarden (min===max, zoals colbert) hebben van nature ruimte tussen
        // de maten — een stap van 4 cm is daar de bedoeling, geen gat. Alleen
        // echte bereiken horen op elkaar aan te sluiten.
        const ditIsBereik = paar(dit)[0] !== paar(dit)[1];
        const volgIsBereik = paar(volgend)[0] !== paar(volgend)[1];
        if (ditIsBereik && volgIsBereik) {
          bevindingen.push({
            ernst: "waarschuwing",
            soort: "gat",
            categorie,
            maat: `${dit.maat} / ${volgend.maat}`,
            tekst: `${categorie}: tussen ${dit.maat} (tot ${ditMax} cm) en ${volgend.maat} (vanaf ${volgMin} cm) zit een gat van ${volgMin - ditMax - 1} cm. Wie daarin valt krijgt de dichtstbijzijnde maat, zonder waarschuwing.`,
          });
        }
      }
    }

    for (const r of rows) {
      const [lo, hi] = paar(r);
      if (lo != null && hi != null && hi < lo) {
        bevindingen.push({
          ernst: "waarschuwing",
          soort: "niet-oplopend",
          categorie,
          maat: r.maat,
          tekst: `${categorie} ${r.maat}: de ${meet}maat loopt van ${lo} naar ${hi} cm — dat is omgekeerd.`,
        });
      }
    }
  }

  // Boordrijen zonder boordmaat: die kunnen we niet aan een hals koppelen.
  for (const r of perCategorie.get("Overhemden (Boordmaat)") ?? []) {
    if (!r.boordCm) {
      bevindingen.push({
        ernst: "waarschuwing",
        soort: "boord-ontbreekt",
        categorie: r.categorie,
        maat: r.maat,
        tekst: `Overhemd ${r.maat} heeft geen boordmaat; deze rij doet niets voor het boordadvies.`,
      });
    }
  }

  if (ctx.catalogusMaten) {
    // Zonder rijLabel zou dit ruwe maten uit verschillende maatsystemen
    // vergelijken; dan liever de check niet doen dan tientallen valse meldingen.
    const label = ctx.rijLabel;
    for (const [categorie, rows] of perCategorie) {
      const groepen = ctx.hoofdgroepen.get(categorie) ?? [];
      if (!groepen.length) continue;
      const familie = groepen[0];

      const inTabel = new Set<string>();
      for (const r of rows) inTabel.add(label ? label(r.maat, familie) || r.maat : r.maat);

      // Per ontbrekende rij één voorbeeldmaat bewaren: "4XL (bv. 66)" is te
      // begrijpen, een kaal "4XL" laat je zoeken naar wat je moet toevoegen.
      const ontbreekt = new Map<string, string>();
      // Gaat deze categorie over één maatsysteem (de drie pantalons), dan alleen
      // de catalogusmaten uit dát systeem vergelijken.
      const systeem = CATEGORIE_SYSTEEM[categorie];
      for (const g of groepen) {
        for (const m of ctx.catalogusMaten.get(g) ?? []) {
          if (systeem && ctx.maatGroep && ctx.maatGroep(m) !== systeem) continue;
          const rij = label ? label(m, g) : m;
          if (!rij) continue;
          /* Alleen filteren als er ÉCHT op rijen vergeleken wordt. Zonder
             `rijLabel` vergelijken we ruwe maten, en dan zou deze test elke
             getalsmaat wegstrepen — de check zou stil niets meer doen, wat erger
             is dan een ruwe vergelijking. */
          if (label && !RIJ_LABEL.test(rij)) continue;
          if (inTabel.has(rij) || ontbreekt.has(rij)) continue;
          ontbreekt.set(rij, m);
        }
      }

      if (ontbreekt.size) {
        const lijst = [...ontbreekt.entries()].map(([rij, vb]) => (rij === vb ? rij : `${rij} (bv. ${vb})`));
        bevindingen.push({
          ernst: "waarschuwing",
          soort: "catalogusmaat-zonder-rij",
          categorie,
          tekst: `${categorie}: de catalogus verkoopt ${lijst.length === 1 ? "een formaat" : `${lijst.length} formaten`} waar deze tabel niets over zegt — ${lijst.slice(0, 8).join(", ")}${lijst.length > 8 ? ", …" : ""}. Het maatadvies kan die niet omrekenen naar lichaamsmaten.`,
        });
      }
    }
  }

  return bevindingen;
}

/* ─────────────────────────── Naar de vorm die de site leest ─────────────────────────── */

/**
 * Maatrijen → de SizeChart-vorm uit lib/size-chart, zodat het maatadvies en de
 * maattabellen op de site er niets van merken dat de bron veranderd is.
 *
 * De boordlijst wordt afgeleid uit de overhemdenrijen: in de code waren dat twee
 * arrays met dezelfde borst/taille eronder, hier is het één set rijen waarvan de
 * overhemden een boordkolom hebben.
 */
export function naarSizeChart(rijen: MaatRij[], versie: number): SizeChart {
  const rows: ChartRow[] = rijen.map((r) => ({
    productType: r.productType,
    category: r.categorie as ChartCategory,
    size: r.maat,
    chestMin: r.borstMin,
    chestMax: r.borstMax,
    waistMin: r.tailleMin,
    waistMax: r.tailleMax,
    innerLegMin: r.binnenbeenMin,
    innerLegMax: r.binnenbeenMax,
  }));

  const boord: BoordRow[] = rijen
    .filter((r) => r.categorie === "Overhemden (Boordmaat)" && r.boordCm && r.borstMin != null)
    .map((r) => ({
      confectie: r.maat,
      boordCm: r.boordCm,
      chestMin: r.borstMin as number,
      chestMax: (r.borstMax ?? r.borstMin) as number,
      waistMin: r.tailleMin ?? 0,
      waistMax: r.tailleMax ?? r.tailleMin ?? 0,
    }));

  return { rows, boord, versie };
}

/** Ernstigste bevinding eerst — de portal toont fouten boven waarschuwingen. */
export function sorteerBevindingen(b: Bevinding[]): Bevinding[] {
  return [...b].sort((a, x) => (a.ernst === x.ernst ? 0 : a.ernst === "fout" ? -1 : 1));
}
