import { sql, type SQL } from "drizzle-orm";
import { getSettings, updateSettings } from "@/lib/settings";
import { pinKey, type PinContextKind } from "@/lib/merchandising";

/**
 * Merchandising-REGELS — de automatische tegenhanger van de pins.
 *
 * Een pin zet één product bovenaan; een regel verschuift een hele groep
 * ("alles van jaar 2026 omhoog", "NOS omlaag", "Herfst/Winter omhoog vanaf
 * 1 september"). Beheerd vanuit de portal, opgeslagen in de settings-store
 * (app_settings.global → merchandisingRegels) — nooit hardcoded, nooit env.
 *
 * Drie eigenschappen die bewust zo zijn:
 *
 *  1. **Regels herschikken, ze filteren niet.** Net als de bestaande boosts is
 *     het resultaat een ORDER BY-prefix, geen WHERE. De totaaltelling en de
 *     paginering blijven dus kloppen, en een te scherpe regel kan nooit
 *     producten laten verdwijnen — hooguit naar achteren duwen.
 *  2. **Een regel kan aflopen** (`vanaf`/`tot`). Seizoensmerchandising is de
 *     hoofdreden dat dit bestaat: "Herfst/Winter omhoog" moet in maart vanzelf
 *     stoppen, niet blijven staan tot iemand het toevallig opmerkt. De
 *     venstertoets gebeurt in JS op NL-datum, zodat een verlopen regel niet
 *     eens in de query terechtkomt.
 *  3. **Alleen op "Aanbevolen".** "Nieuwste" en "Prijs" moeten voorspelbaar
 *     blijven doen wat het label belooft; daar mag geen merchandising doorheen
 *     fietsen. Zelfde afspraak als de pins.
 *
 * Volgorde binnen "Aanbevolen":
 *   pins → in-jouw-maat → REGELS → populariteit → smaak → maatbreedte →
 *   voorraad → versheid.
 * Regels staan bewust bóven populariteit: een merchandiser die "nieuwe collectie
 * omhoog" zet, bedoelt dat het zichtbaar gebeurt en niet dat het wegvalt tegen
 * 30 dagen klikgedrag. Ze staan bewust ónder de maat van de klant: iets tonen
 * dat niet in zijn maat leverbaar is, verkoopt sowieso niet.
 */

export type RegelVeld =
  | "jaar"
  | "seizoen"
  | "hoofdgroep"
  | "subgroep"
  | "merk"
  | "materiaal"
  | "pasvorm"
  | "kleur"
  | "collectie"
  | "voorraad"
  | "prijs";

export type RegelOperator = "is" | "is-niet" | "groter-dan" | "kleiner-dan";
export type RegelEffect = "omhoog" | "omlaag";

export type MerchRegel = {
  id: string;
  naam: string;
  actief: boolean;
  /** Waar de regel geldt: "*" = de hele site, anders `${kind}:${slug}`. */
  context: string;
  veld: RegelVeld;
  operator: RegelOperator;
  /** Waarden voor is/is-niet; bij groter-dan/kleiner-dan telt alleen de eerste. */
  waarden: string[];
  effect: RegelEffect;
  /** 1–100. Hoger = sterker. Regels tellen bij elkaar op. */
  gewicht: number;
  /** Optioneel venster (YYYY-MM-DD, NL-datum). Buiten het venster telt de regel niet mee. */
  vanaf?: string;
  tot?: string;
  aangemaakt?: string;
  /**
   * Alleen voor bezoekers in één variant van één experiment: "<experiment>:<variant>".
   *
   * Hiermee is een hele merchandising-regelset A/B-testbaar zonder een tweede
   * rangschik-engine: je bouwt de regels in hetzelfde scherm, hangt er een
   * variant aan, en alleen die helft van de bezoekers krijgt ze. Leeg = geldt
   * voor iedereen, zoals altijd.
   */
  alleenVoor?: string;
};

export const MAX_REGELS = 40;
const MAX_WAARDEN = 25;

/** Numerieke velden — alleen die snappen groter-dan/kleiner-dan. */
const NUMERIEK: ReadonlySet<RegelVeld> = new Set<RegelVeld>(["jaar", "voorraad", "prijs"]);

const VELDEN: ReadonlySet<string> = new Set<RegelVeld>([
  "jaar", "seizoen", "hoofdgroep", "subgroep", "merk", "materiaal",
  "pasvorm", "kleur", "collectie", "voorraad", "prijs",
]);
const OPERATOREN: ReadonlySet<string> = new Set<RegelOperator>(["is", "is-niet", "groter-dan", "kleiner-dan"]);

/** Label per veld — de portal toont deze, hier één bron van waarheid. */
export const VELD_LABELS: Record<RegelVeld, string> = {
  jaar: "Jaar (SRS)",
  seizoen: "Seizoen (SRS)",
  hoofdgroep: "Hoofdgroep",
  subgroep: "Subgroep",
  merk: "Merk",
  materiaal: "Materiaal",
  pasvorm: "Pasvorm",
  kleur: "Kleurfamilie",
  collectie: "Collectie",
  voorraad: "Voorraad (stuks)",
  prijs: "Prijs (euro)",
};

/* ─────────────────────────── Opslag + validatie ─────────────────────────── */

/** Maakt er een geldige regel van, of null als het onbruikbaar is. */
function schoon(raw: unknown, index: number): MerchRegel | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const veld = String(r.veld || "");
  const operator = String(r.operator || "is");
  if (!VELDEN.has(veld) || !OPERATOREN.has(operator)) return null;
  // Niet-numerieke velden kennen geen groter/kleiner — dat zou stil 0 opleveren.
  if (!NUMERIEK.has(veld as RegelVeld) && operator !== "is" && operator !== "is-niet") return null;

  const waarden = [
    ...new Set(
      (Array.isArray(r.waarden) ? r.waarden : [])
        .map((w) => String(w ?? "").trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_WAARDEN);
  if (!waarden.length) return null;
  // Bij een numerieke vergelijking moet de waarde ook echt een getal zijn.
  if (operator === "groter-dan" || operator === "kleiner-dan") {
    if (!Number.isFinite(Number(waarden[0]))) return null;
  }

  const gewicht = Math.min(100, Math.max(1, Math.round(Number(r.gewicht) || 10)));
  const context = String(r.context || "*").trim().toLowerCase() || "*";
  return {
    id: String(r.id || `regel-${index + 1}-${veld}`).trim().slice(0, 64),
    naam: String(r.naam || "").trim().slice(0, 80) || `${VELD_LABELS[veld as RegelVeld]} ${operator}`,
    actief: r.actief !== false,
    context,
    veld: veld as RegelVeld,
    operator: operator as RegelOperator,
    waarden,
    effect: r.effect === "omlaag" ? "omlaag" : "omhoog",
    gewicht,
    vanaf: datum(r.vanaf),
    tot: datum(r.tot),
    aangemaakt: datum(r.aangemaakt) || undefined,
    // Vorm: "<experiment>:<variant>", zelfde slugs als de A/B-motor. Verwijst
    // hij naar een experiment dat niet (meer) draait, dan matcht hij nooit —
    // de regel is dan stil uit, en dat is de veilige kant.
    alleenVoor: (() => {
      const v = String(r.alleenVoor ?? "").trim().toLowerCase();
      return /^[a-z0-9-]{1,40}:[a-z0-9-]{1,12}$/.test(v) ? v : undefined;
    })(),
  };
}

function datum(v: unknown): string | undefined {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

/** Alle opgeslagen regels (ook inactieve/verlopen) — voor het portal-overzicht. */
export async function getAlleRegels(): Promise<MerchRegel[]> {
  const s = await getSettings();
  const raw = Array.isArray(s.merchandisingRegels) ? s.merchandisingRegels : [];
  return raw.map(schoon).filter((r): r is MerchRegel => r !== null).slice(0, MAX_REGELS);
}

/**
 * Schoont + valideert een regelset zónder op te slaan. Ongeldige regels vallen
 * weg (de aanroeper hoort het verschil in aantal te melden — stil verdwijnen is
 * hier de vervelendste fout). Ook gebruikt door de voorbeeldweergave, zodat het
 * voorbeeld exact dezelfde regels doorrekent als wat opslaan zou bewaren.
 */
export function valideerRegels(regels: unknown[]): MerchRegel[] {
  const schone = (Array.isArray(regels) ? regels : [])
    .map(schoon)
    .filter((r): r is MerchRegel => r !== null)
    .slice(0, MAX_REGELS);
  // Dubbele id's zouden de portal-editor laten stuiteren bij verwijderen.
  const gezien = new Set<string>();
  return schone.map((r, i) => {
    if (!gezien.has(r.id)) {
      gezien.add(r.id);
      return r;
    }
    const id = `${r.id}-${i}`;
    gezien.add(id);
    return { ...r, id };
  });
}

/** Overschrijft de volledige regelset. Ongeldige regels vallen weg. */
export async function setRegels(regels: unknown[]): Promise<MerchRegel[]> {
  const uniek = valideerRegels(regels);
  await updateSettings({ merchandisingRegels: uniek });
  return uniek;
}

/* ─────────────────────────── Venster + context ──────────────────────────── */

/** Vandaag als YYYY-MM-DD in NL-tijd (niet de serverzone — die staat op UTC). */
export function vandaagNl(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Amsterdam",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Telt deze regel vandaag mee in deze PLP-context? */
export function regelGeldt(
  regel: MerchRegel,
  kind: PinContextKind,
  slug: string,
  vandaag = vandaagNl(),
  abSleutels: string[] = [],
): boolean {
  if (!regel.actief) return false;
  if (regel.context !== "*" && regel.context !== pinKey(kind, slug)) return false;
  if (regel.vanaf && vandaag < regel.vanaf) return false;
  if (regel.tot && vandaag > regel.tot) return false;
  // Variant-regel: alleen voor bezoekers die in díé variant zitten. Wie geen
  // toewijzing heeft (geen cookie, experiment gestopt) valt er dus buiten en
  // ziet de gewone rangschikking — de veilige kant.
  if (regel.alleenVoor && !abSleutels.includes(regel.alleenVoor)) return false;
  return true;
}

/**
 * De regels die nú gelden voor deze PLP — dit is wat de query in gaat.
 * `abSleutels` zijn de toewijzingen van deze bezoeker ("<experiment>:<variant>");
 * zonder die lijst doen variant-regels niet mee.
 */
export async function getActieveRegels(
  kind: PinContextKind,
  slug: string,
  abSleutels: string[] = [],
): Promise<MerchRegel[]> {
  const alle = await getAlleRegels();
  const vandaag = vandaagNl();
  return alle.filter((r) => regelGeldt(r, kind, slug, vandaag, abSleutels));
}

/* ───────────────────────────── SQL-compilatie ───────────────────────────── */

/**
 * Tekstuele veldexpressie. Uit een vaste allowlist — er komt nooit invoer van de
 * beheerder in de SQL-structuur terecht, alleen in geparametriseerde waarden.
 */
function tekstExpr(veld: RegelVeld): SQL | null {
  switch (veld) {
    case "jaar": return sql`coalesce(products.attributes ->> 'jaar', '')`;
    case "seizoen": return sql`coalesce(products.attributes ->> 'seizoen', '')`;
    case "hoofdgroep": return sql`coalesce(products.attributes ->> 'hoofdgroep_omschrijving', '')`;
    case "subgroep": return sql`coalesce(products.attributes ->> 'subgroep', '')`;
    case "merk": return sql`coalesce(nullif(products.attributes ->> 'merk', ''), products.vendor, '')`;
    case "materiaal": return sql`coalesce(products.attributes ->> 'materiaal', '')`;
    case "pasvorm": return sql`coalesce(products.attributes ->> 'pasvorm', '')`;
    default: return null;
  }
}

/** Numerieke veldexpressie. `jaar` is tekst in SRS ("2026", maar ook "NOS"). */
function getalExpr(veld: RegelVeld): SQL | null {
  switch (veld) {
    // Niet-cijfers eruit, dan pas casten: "NOS" wordt NULL i.p.v. een crash.
    case "jaar":
      return sql`nullif(regexp_replace(coalesce(products.attributes ->> 'jaar', ''), '\\D', '', 'g'), '')::int`;
    case "voorraad":
      return sql`coalesce(products.stock_qty, 0)`;
    // Prijs in euro's. `mp` uit de select is hier niet bruikbaar: Postgres staat
    // een select-alias alleen als losse ORDER BY-term toe, niet in een expressie.
    case "prijs":
      return sql`(select min(v.price_cents) from product_variants v where v.product_id = products.id) / 100.0`;
    default:
      return null;
  }
}

/** De WHERE-achtige conditie van één regel (als boolean-expressie). */
function conditie(regel: MerchRegel): SQL | null {
  const { veld, operator, waarden } = regel;

  if (operator === "groter-dan" || operator === "kleiner-dan") {
    const expr = getalExpr(veld);
    if (!expr) return null;
    const n = Number(waarden[0]);
    if (!Number.isFinite(n)) return null;
    return operator === "groter-dan" ? sql`${expr} > ${n}` : sql`${expr} < ${n}`;
  }

  // is / is-niet
  let basis: SQL | null = null;
  if (veld === "kleur") {
    basis = sql`exists (select 1 from product_variants vk where vk.product_id = products.id
      and vk.color_family in (${sql.join(waarden.map((w) => sql`${w}`), sql`, `)}))`;
  } else if (veld === "collectie") {
    basis = sql`exists (select 1 from product_collections pcr join collections cr on cr.id = pcr.collection_id
      where pcr.product_id = products.id and cr.handle in (${sql.join(waarden.map((w) => sql`${w}`), sql`, `)}))`;
  } else if (veld === "voorraad" || veld === "prijs") {
    const expr = getalExpr(veld);
    if (!expr) return null;
    const getallen = waarden.map(Number).filter((n) => Number.isFinite(n));
    if (!getallen.length) return null;
    basis = sql`${expr} in (${sql.join(getallen.map((n) => sql`${n}`), sql`, `)})`;
  } else {
    const expr = tekstExpr(veld);
    if (!expr) return null;
    basis = sql`${expr} in (${sql.join(waarden.map((w) => sql`${w}`), sql`, `)})`;
  }

  // "is-niet" met NOT: bij kleur/collectie betekent dat "heeft geen enkele
  // variant/koppeling met die waarde", wat precies de bedoeling is.
  return regel.operator === "is-niet" ? sql`not (${basis})` : basis;
}

/**
 * Bouwt de regel-score: som van de gewichten van alle matchende regels
 * (omhoog telt op, omlaag trekt af). Null als er niets te scoren valt, zodat de
 * ORDER BY dan letterlijk ongewijzigd blijft t.o.v. vóór deze feature.
 */
export function buildRegelScore(regels: MerchRegel[]): SQL | null {
  const termen: SQL[] = [];
  for (const regel of regels) {
    const cond = conditie(regel);
    if (!cond) continue;
    const punten = regel.effect === "omlaag" ? -regel.gewicht : regel.gewicht;
    termen.push(sql`(case when ${cond} then ${punten} else 0 end)`);
  }
  if (!termen.length) return null;
  return sql`(${sql.join(termen, sql` + `)})`;
}
