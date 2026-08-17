import { getContentDoc } from "@/lib/content-store";

/**
 * Indeling van de homepage: welke blokken er staan, in welke volgorde, en of
 * ze aan staan. Bron van waarheid = content-document `content:homepage`
 * (portal-beheerbaar); ontbreekt dat, dan valt de pagina terug op DEFAULT_HOME
 * hieronder — die de homepage reproduceert zoals hij vóór deze wijziging in de
 * code stond. Een lege of kapotte store verandert dus niets aan de winkel.
 *
 * Waarom een document en niet losse instellingen: de vraag is bijna nooit "wat
 * staat er in dit blok", maar "wat staat er bovenaan, en wat kan weg". Volgorde
 * en zichtbaarheid zijn hier eerste-rangs, niet iets wat je per blok apart moet
 * gaan zoeken.
 *
 * TEKSTEN EN TALEN — belangrijk. Laat je `titel` (of `eyebrow`, `tekst`) leeg,
 * dan gebruikt de pagina de ingebouwde vertaalsleutel en is het blok in alle
 * talen goed. Vul je zelf iets in, dan staat díé tekst er in élke taal, ook op
 * /en en /de. Dat is bewust: een eigen tekst hoort te doen wat je typt. Wil je
 * het meertalig, laat het veld dan leeg en pas de tekst aan bij Vertalingen.
 */

export type HomeSectionType =
  | "hero"
  | "usps"
  | "voor-jou"
  | "gelegenheden"
  | "populair"
  | "producten"
  | "banner"
  | "categorieen"
  | "look"
  | "recent"
  | "vertrouwen";

/** Velden die (bijna) elk blok kent. Leeg = ingebouwde, vertaalde tekst. */
type Kop = {
  eyebrow?: string;
  titel?: string;
};

export type HomeSection = Kop & {
  /** Stabiele sleutel; nodig voor herordenen en als React-key. */
  id: string;
  type: HomeSectionType;
  /** Uit = blok staat er nog, maar wordt niet getoond. Niets gaat verloren. */
  aan: boolean;

  /* ── type "producten" ── */
  /** Hoofdgroep uit de catalogus, bv. "Pakken" of "Overhemden". */
  hoofdgroep?: string;
  /** Link rechtsboven de strip. */
  linkLabel?: string;
  linkHref?: string;

  /* ── type "banner" ── */
  /** "licht" = beeld naast tekst op zandkleur; "donker" = full-bleed met overlay. */
  stijl?: "licht" | "donker";
  afbeelding?: string;
  afbeeldingAlt?: string;
  tekst?: string;
  knopLabel?: string;
  knopHref?: string;
  knop2Label?: string;
  knop2Href?: string;

  /* ── type "categorieen" ── */
  /** Hoeveel categorie-tegels (1-12). */
  aantal?: number;

  /* ── type "look" ── */
  /** Slug van de uitgelichte look; leeg = de eerste gepubliceerde. */
  lookSlug?: string;
};

export type HomeLayout = { secties: HomeSection[] };

/**
 * De homepage zoals hij was toen dit document nog niet bestond. Wijzig hier
 * niets om de site aan te passen — dat doe je in de portal; dit is het vangnet.
 */
export const DEFAULT_HOME: HomeLayout = {
  secties: [
    { id: "hero", type: "hero", aan: true },
    { id: "usps", type: "usps", aan: true },
    { id: "voor-jou", type: "voor-jou", aan: true },
    { id: "gelegenheden", type: "gelegenheden", aan: true },
    { id: "populair", type: "populair", aan: true },
    {
      id: "pakken",
      type: "producten",
      aan: true,
      hoofdgroep: "Pakken",
      linkHref: "/collections/pakken",
    },
    {
      id: "pak-samenstellen",
      type: "banner",
      aan: true,
      stijl: "licht",
      afbeelding: "/brand/brand-model-grey3piece.jpg",
      afbeeldingAlt: "Man in grijs three-piece kostuum",
      knopHref: "/pak-samenstellen",
      knop2Href: "/maatadvies",
    },
    {
      id: "overhemden",
      type: "producten",
      aan: true,
      hoofdgroep: "Overhemden",
      linkHref: "/collections/overhemden",
    },
    {
      id: "etiquette",
      type: "banner",
      aan: true,
      stijl: "donker",
      afbeelding: "/brand/brand-model-tuxedo.jpg",
      afbeeldingAlt: "",
      knopHref: "/pages/etiquette",
    },
    { id: "categorieen", type: "categorieen", aan: true, aantal: 8 },
    { id: "look", type: "look", aan: true },
    { id: "recent", type: "recent", aan: true },
    { id: "vertrouwen", type: "vertrouwen", aan: true },
  ],
};

const TYPES: HomeSectionType[] = [
  "hero", "usps", "voor-jou", "gelegenheden", "populair",
  "producten", "banner", "categorieen", "look", "recent", "vertrouwen",
];

const s = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
/** Alleen veilige link-schemes (stored-XSS-preventie op de publieke site). */
const href = (v: unknown, n = 200) => {
  const h = s(v, n);
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "";
};
/** Beeld: eigen /public-pad of https. Een javascript:-URL hoort hier nooit. */
const beeld = (v: unknown) => {
  const u = s(v, 400);
  return /^(\/|https:\/\/)/i.test(u) ? u : "";
};

/** Saneert één blok. Onbekend type of ontbrekende id → null (blok valt weg). */
function schoonSectie(raw: unknown, i: number): HomeSection | null {
  const r = (raw || {}) as Record<string, unknown>;
  const type = s(r.type, 30) as HomeSectionType;
  if (!TYPES.includes(type)) return null;

  const out: HomeSection = {
    id: s(r.id, 40) || `${type}-${i}`,
    type,
    aan: r.aan !== false,
  };
  const eyebrow = s(r.eyebrow, 60);
  const titel = s(r.titel, 120);
  if (eyebrow) out.eyebrow = eyebrow;
  if (titel) out.titel = titel;

  if (type === "producten") {
    out.hoofdgroep = s(r.hoofdgroep, 60);
    const l = s(r.linkLabel, 60);
    const h = href(r.linkHref);
    if (l) out.linkLabel = l;
    if (h) out.linkHref = h;
  }

  if (type === "banner") {
    out.stijl = r.stijl === "donker" ? "donker" : "licht";
    out.afbeelding = beeld(r.afbeelding);
    out.afbeeldingAlt = s(r.afbeeldingAlt, 160);
    const tekst = s(r.tekst, 600);
    if (tekst) out.tekst = tekst;
    const kl = s(r.knopLabel, 60);
    const kh = href(r.knopHref);
    if (kl) out.knopLabel = kl;
    if (kh) out.knopHref = kh;
    const k2l = s(r.knop2Label, 60);
    const k2h = href(r.knop2Href);
    if (k2l) out.knop2Label = k2l;
    if (k2h) out.knop2Href = k2h;
  }

  if (type === "categorieen") {
    const n = Math.round(Number(r.aantal));
    out.aantal = Number.isFinite(n) ? Math.min(12, Math.max(1, n)) : 8;
  }

  if (type === "look") {
    const slug = s(r.lookSlug, 80).toLowerCase();
    if (slug) out.lookSlug = slug;
  }

  return out;
}

/**
 * Saneert een hele indeling. Blijft er niets over, dan geven we de default
 * terug in plaats van een lege pagina — een homepage zonder blokken is nooit
 * wat iemand bedoelde, en een leeg scherm is een storing die je pas ziet als
 * een klant belt.
 */
export function schoonHomeLayout(raw: unknown): HomeLayout {
  const r = (raw || {}) as Record<string, unknown>;
  const lijst = Array.isArray(r.secties) ? r.secties : [];
  const secties = lijst.map(schoonSectie).filter((x): x is HomeSection => x !== null);
  if (!secties.length) return DEFAULT_HOME;

  // Dubbele id's breken het herordenen in de portal (twee blokken die samen
  // bewegen) en geven React-key-botsingen. Achtervoegsel erbij i.p.v. weggooien.
  const gezien = new Set<string>();
  for (const sec of secties) {
    let id = sec.id;
    let n = 2;
    while (gezien.has(id)) id = `${sec.id}-${n++}`;
    gezien.add(id);
    sec.id = id;
  }
  return { secties };
}

/**
 * Documentsleutels: de live indeling heet "homepage"; een A/B-variant heeft een
 * eigen document ("homepage:exp:<experiment>:<variant>", zie lib/experiments).
 * Alleen dat patroon is toegestaan — de sleutel komt via de portal binnen en
 * mag nooit een willekeurig ander content-document kunnen aanwijzen.
 */
export function isHomepageDocKey(key: string): boolean {
  return key === "homepage" || /^homepage:exp:[a-z0-9-]{1,40}:[a-z0-9-]{1,12}$/.test(key);
}

/** De indeling zoals de site hem rendert (store → gesaneerd, anders default). */
export async function getHomeLayout(docKey = "homepage"): Promise<HomeLayout> {
  const key = isHomepageDocKey(docKey) ? docKey : "homepage";
  const doc = await getContentDoc<HomeLayout>(key);
  // Een variant-document dat (nog) niet bestaat valt terug op de LIVE indeling,
  // niet op de code-default: een experiment-variant zonder eigen indeling hoort
  // eruit te zien als de site van dat moment.
  if (!doc) return key === "homepage" ? DEFAULT_HOME : getHomeLayout("homepage");
  return schoonHomeLayout(doc);
}
