import type { Metadata } from "next";
import { DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale-server";
import { localeAlternates } from "@/lib/seo";
import { getSeoOverride, applySeoOverride } from "@/lib/seo-overrides";
import { ensureEntries, getTranslationStore, pickFreshTranslation, type Store, type TransEntry } from "@/lib/translate";
import { BRANDS, type Brand } from "@/lib/brands";
import { SIZE_GUIDES, MEASURE_INFO, type Measure, type SizeGuide } from "@/lib/size-chart-hub";

/**
 * i18n over de PAGINA-METADATA en de statische contentteksten die erin landen.
 *
 * WAAROM DIT BESTAAT: elke generateMetadata stond hardgecodeerd in het Nederlands.
 * Op /en/blog kreeg Google dus "Stijlgids" als <title> met een Nederlandse
 * omschrijving eronder — het zwaarste on-page signaal dat er is, in de verkeerde
 * taal, op élke anderstalige pagina. De categoriepagina is in #308 gefixt; dit
 * is de rest. Vijf pagina's gebruikten bovendien `export const metadata` en
 * misten daardoor óók hun hreflang-annotaties; die lopen nu mee.
 *
 * Twee sleutelstijlen, allebei bestaand huispatroon:
 *  - ns "meta": sleutel = pad + ".title" / ".description" (de vaste pagina's).
 *  - ns "tekst": sleutel = de BRONTEKST zelf (merk-intro's, maatgidsen). Zo wordt
 *    een tekst die in vijf gidsen identiek voorkomt (de pasvorm-noot, de
 *    tussenmaat-FAQ) één keer vertaald — dezelfde truc als lib/nav-i18n.
 *
 * De nachtelijke cron vertaalt de ACTUELE bronteksten (delta op bron-hash); het
 * renderen pakt via pickFreshTranslation alleen een vertaling die nog bij de
 * huidige bron hoort. Wijzigt de Nederlandse tekst, dan valt die taal netjes
 * terug op Nederlands tot de cron langskomt — nooit een vertaling van iets anders.
 */

const NS_PAGE = "meta";
const NS_TEXT = "tekst";

type PageMeta = { title: string; description?: string };

/**
 * Bron van waarheid voor de vaste pagina's. De teksten zijn letterlijk
 * overgenomen uit de generateMetadata-functies die ze vervangen, zodat het
 * Nederlands byte-identiek blijft.
 */
export const PAGE_META: Record<string, PageMeta> = {
  // /account, /profiel-afronden en /reservering-afrekenen staan op
  // robots-disallow, dus SEO speelt daar niet. De browsertab van een Engelse
  // klant zei alleen wél "Profiel afronden" — daarom lopen ze gewoon mee.
  "/account": { title: "Mijn GENTS" },
  "/afspraak": {
    title: "Afspraak maken — trouwconsult, pasafspraak of personal shopping",
    description:
      "Plan een persoonlijk adviesmoment in één van onze 19 winkels. Trouwconsult voor je trouwpak, een pasafspraak of personal shopping — kies je winkel, dag en dagdeel.",
  },
  "/blog": {
    title: "Stijlgids",
    description:
      "Adviezen, dresscodes en stylingtips van de stylisten van GENTS — perfect gekleed voor elk formeel moment.",
  },
  "/cadeaubon": {
    title: "Cadeaubon",
    description:
      "Geef GENTS cadeau. Een digitale cadeaubon, direct per e-mail bij de ontvanger — te besteden op alles in de collectie.",
  },
  "/collections": { title: "Collecties" },
  "/gelegenheden": {
    title: "Gelegenheden — kleding voor elk moment",
    description:
      "Bruiloft, gala, zakelijk of een afscheid — vind bij GENTS de juiste outfit voor elke gelegenheid, met persoonlijk advies.",
  },
  "/looks": {
    title: "Shop the look",
    description: "Complete outfits voor elk moment — klik en shop de hele look.",
  },
  "/maatadvies": {
    title: "Maatadvies — vind jouw maat",
    description:
      "Vind in een paar stappen je colbert-, lengte- en boordmaat. Het maatadvies van GENTS helpt je aan de juiste pasvorm.",
  },
  "/maattabellen": {
    title: "Maattabellen — vind je maat per categorie",
    description:
      "Alle GENTS-maattabellen op één plek: pakken, colberts, overhemden, pantalons, gilets, truien en poloshirts. Lichaamsmaten in centimeters per maat.",
  },
  "/pak-samenstellen": {
    title: "Pak samenstellen",
    description:
      "Stel je eigen pak samen: kies colbert en pantalon in de maat die jou past, met of zonder gilet. Prijs is de som van de onderdelen.",
  },
  "/pages/herroepingsformulier": {
    title: "Modelformulier voor herroeping",
    description:
      "Het wettelijke modelformulier voor herroeping van je GENTS-bestelling — 14 dagen bedenktijd.",
  },
  "/pages/klantenservice": {
    title: "Klantenservice — we staan voor je klaar",
    description:
      "Vragen over je bestelling, maat of retour? De GENTS-klantenservice helpt je snel en persoonlijk — via de assistent, per mail of in één van onze 19 winkels.",
  },
  "/profiel-afronden": { title: "Profiel afronden" },
  "/reservering-afrekenen": { title: "Reservering afrekenen" },
  "/retourneren": {
    title: "Retourneren",
    description:
      "Iets retourneren? Start hier of vanuit je bestelling. Kies een DHL-retourlabel of inleveren in de winkel, en geld terug of GENTS-tegoed — met tegoed of in de winkel is retourneren gratis.",
  },
  "/smoking-samenstellen": {
    title: "Smoking compleet samenstellen",
    description:
      "Stel je eigen smoking samen: kies je stof, je revers, je overhemd en je strik — elk in je eigen maat, voor één vaste prijs.",
  },
  "/zoeken": { title: "Zoeken" },
};

/* ─────────────────────────────── cron-kant ─────────────────────────────── */

function pageEntries(): TransEntry[] {
  const out: TransEntry[] = [];
  for (const [pad, m] of Object.entries(PAGE_META)) {
    out.push({ ns: NS_PAGE, key: `${pad}.title`, source: m.title });
    if (m.description) out.push({ ns: NS_PAGE, key: `${pad}.description`, source: m.description });
  }
  return out;
}

/** Losse teksten, gesleuteld op zichzelf → identieke bronteksten delen één vertaling. */
function textEntries(): TransEntry[] {
  const uniek = new Set<string>();
  const add = (v?: string) => {
    const s = (v || "").trim();
    if (s) uniek.add(s);
  };
  // Merknamen bewust NIET: dat zijn eigennamen, en "GENTS" valt onder de merkregel.
  for (const b of BRANDS) add(b.intro);
  for (const g of SIZE_GUIDES) {
    add(g.navLabel);
    add(g.title);
    add(g.cardDescription);
    add(g.seoTitle);
    add(g.seoDescription);
    add(g.intro);
    for (const c of g.charts) add(c.caption);
    for (const f of g.faqs) {
      add(f.q);
      add(f.a);
    }
  }
  // guide.measures zijn sleutels ("chest"), geen tekst — de woorden staan in MEASURE_INFO.
  for (const m of Object.values(MEASURE_INFO)) {
    add(m.label);
    add(m.how);
  }
  return [...uniek].map((s) => ({ ns: NS_TEXT, key: s, source: s }));
}

/** Voor de vertaal-cron: alle paginateksten (delta) naar één locale. */
export async function ensurePageMetaContent(locale: Locale): Promise<{ translated: number; total: number }> {
  return ensureEntries([...pageEntries(), ...textEntries()], locale, "ui");
}

/* ────────────────────────────── render-kant ────────────────────────────── */

/** Vertaalde titel/omschrijving voor een vast pad (NL = pass-through). */
export async function localizedPageMeta(pad: string, locale: Locale): Promise<PageMeta> {
  const bron = PAGE_META[pad];
  if (!bron) return { title: "" };
  if (locale === DEFAULT_LOCALE) return bron;
  const store = await getTranslationStore(locale);
  return {
    title: pickFreshTranslation(store, NS_PAGE, `${pad}.title`, bron.title),
    description: bron.description
      ? pickFreshTranslation(store, NS_PAGE, `${pad}.description`, bron.description)
      : undefined,
  };
}

/**
 * Complete Metadata voor een vast pad: vertaalde titel/omschrijving, canonical +
 * hreflang, en de portal-override er overheen. Vervangt per pagina een blok van
 * acht regels door één aanroep.
 */
export async function pageMetadata(pad: string, extra?: Metadata): Promise<Metadata> {
  const locale = await getLocale();
  const { title, description } = await localizedPageMeta(pad, locale);
  const meta: Metadata = {
    title,
    ...(description ? { description } : {}),
    alternates: await localeAlternates(pad),
    ...extra,
  };
  return applySeoOverride(meta, await getSeoOverride(pad));
}

/** Losse statische tekst vertalen (merk-intro, maatgids-tekst). */
export function localizedText(store: Store, bron: string): string {
  const s = (bron || "").trim();
  return s ? pickFreshTranslation(store, NS_TEXT, s, s) : bron;
}

/** Merk met vertaalde intro. De naam blijft staan — eigennaam. */
export async function localizedBrand(brand: Brand, locale: Locale): Promise<Brand> {
  if (locale === DEFAULT_LOCALE) return brand;
  const store = await getTranslationStore(locale);
  return { ...brand, intro: localizedText(store, brand.intro) };
}

/** Maatgids met vertaalde teksten. Maten, getallen en slugs blijven ongemoeid. */
export async function localizedSizeGuide(guide: SizeGuide, locale: Locale): Promise<SizeGuide> {
  if (locale === DEFAULT_LOCALE) return guide;
  const store = await getTranslationStore(locale);
  const p = (v: string) => localizedText(store, v);
  return {
    ...guide,
    navLabel: p(guide.navLabel),
    title: p(guide.title),
    cardDescription: p(guide.cardDescription),
    seoTitle: p(guide.seoTitle),
    seoDescription: p(guide.seoDescription),
    intro: p(guide.intro),
    charts: guide.charts.map((c) => ({ ...c, caption: p(c.caption) })),
    // measures blijft ongemoeid: dat zijn sleutels ("chest"), geen tekst.
    faqs: guide.faqs.map((f) => ({ q: p(f.q), a: p(f.a) })),
  };
}

/**
 * MEASURE_INFO met vertaalde labels/uitleg. De maattabelpagina's tonen deze
 * teksten los van de gids, dus die hebben hun eigen vertaalslag nodig.
 */
export async function localizedMeasureInfo(locale: Locale): Promise<Record<Measure, { label: string; how: string }>> {
  if (locale === DEFAULT_LOCALE) return MEASURE_INFO;
  const store = await getTranslationStore(locale);
  const out = {} as Record<Measure, { label: string; how: string }>;
  for (const [k, v] of Object.entries(MEASURE_INFO) as [Measure, { label: string; how: string }][]) {
    out[k] = { label: localizedText(store, v.label), how: localizedText(store, v.how) };
  }
  return out;
}
