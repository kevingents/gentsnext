/**
 * Vertaalde URL-paden (fase 3 meertalig) — pure regels, zonder Next-afhankelijkheden
 * zodat `node --test` ze rechtstreeks kan draaien (zelfde patroon als
 * lib/club-pas-regels.js). De getypeerde schil staat in lib/url-i18n.ts.
 *
 * Tot nu toe kreeg een anderstalige bezoeker wél vertaalde teksten, maar een
 * volledig Nederlandse URL: /en/categorie/pakken. Het pad is voor Google een
 * bescheiden relevantiesignaal en in de zoekresultaten een zichtbaar
 * vertrouwenssignaal — "gents.nl/en/category/suits" leest voor een Engelse
 * bezoeker als een Engelse pagina, "…/categorie/pakken" niet.
 *
 * BEWUSTE GRENS 1 — alleen INDEXEERBARE paden.
 * /afrekenen, /winkelwagen, /account, /bestelling, /review, /favorieten en
 * /zoeken blijven Nederlands: die staan in robots.ts op disallow (dus nul
 * SEO-winst), ze zitten in reeds verstuurde e-maillinks, en /account heeft een
 * auth-guard die eerder al een redirect-lus opleverde (zie seed-redirects.ts).
 * Vertalen daar is puur migratierisico.
 *
 * BEWUSTE GRENS 2 — product- en collectie-handles blijven zoals ze zijn.
 * Die komen uit de catalogus (duizenden, per import wisselend); vertalen vergt
 * een kolom + backfill + een redirect per gewijzigde handle. De koppen die
 * daadwerkelijk ranken zijn de categorie-URL's, en die staan hier compleet.
 *
 * ASCII-transliteratie (anzuege, groessentabellen, panuelos): geen umlauts of
 * accenten in paden — percent-encoding maakt die in de SERP onleesbaar.
 */

export const URL_LOCALES = ["nl", "en", "de", "fr", "es"];
export const URL_DEFAULT_LOCALE = "nl";

/** Eerste padsegment = de routenaam. */
export const SEGMENTS = {
  products: { en: "products", de: "produkte", fr: "produits", es: "productos" },
  collections: { en: "collections", de: "kollektionen", fr: "collections", es: "colecciones" },
  categorie: { en: "category", de: "kategorie", fr: "categorie", es: "categoria" },
  merken: { en: "brands", de: "marken", fr: "marques", es: "marcas" },
  gelegenheden: { en: "occasions", de: "anlaesse", fr: "occasions", es: "ocasiones" },
  maattabellen: { en: "size-guide", de: "groessentabellen", fr: "guide-des-tailles", es: "guia-de-tallas" },
  maatadvies: { en: "size-advice", de: "groessenberatung", fr: "conseil-taille", es: "consejo-de-talla" },
  "pak-samenstellen": { en: "build-your-suit", de: "anzug-konfigurieren", fr: "composer-son-costume", es: "configurar-traje" },
  "smoking-samenstellen": { en: "build-your-tuxedo", de: "smoking-konfigurieren", fr: "composer-son-smoking", es: "configurar-esmoquin" },
  retourneren: { en: "returns", de: "retouren", fr: "retours", es: "devoluciones" },
  afspraak: { en: "appointment", de: "termin", fr: "rendez-vous", es: "cita" },
  pages: { en: "pages", de: "seiten", fr: "pages", es: "paginas" },
  // 'blog' en 'looks' zijn in alle doeltalen hetzelfde woord — bewust geen entry.
};

const CATEGORY_SLUGS = {
  pakken: { en: "suits", de: "anzuege", fr: "costumes", es: "trajes" },
  colberts: { en: "blazers", de: "sakkos", fr: "vestes", es: "americanas" },
  pantalons: { en: "trousers", de: "hosen", fr: "pantalons", es: "pantalones" },
  overhemden: { en: "shirts", de: "hemden", fr: "chemises", es: "camisas" },
  gilets: { en: "waistcoats", de: "westen", fr: "gilets", es: "chalecos" },
  truien: { en: "knitwear", de: "pullover", fr: "pulls", es: "jerseis" },
  stropdassen: { en: "ties", de: "krawatten", fr: "cravates", es: "corbatas" },
  strikken: { en: "bow-ties", de: "fliegen", fr: "noeuds-papillon", es: "pajaritas" },
  pochets: { en: "pocket-squares", de: "einstecktuecher", fr: "pochettes", es: "panuelos-de-bolsillo" },
  schoenen: { en: "shoes", de: "schuhe", fr: "chaussures", es: "zapatos" },
  riemen: { en: "belts", de: "guertel", fr: "ceintures", es: "cinturones" },
  jassen: { en: "coats", de: "maentel", fr: "manteaux", es: "abrigos" },
};

/** Tweede padsegment, per route — hetzelfde woord kan per route anders vertalen. */
export const SLUGS = {
  categorie: CATEGORY_SLUGS,
  maattabellen: {
    ...CATEGORY_SLUGS,
    poloshirts: { en: "polo-shirts", de: "polohemden", fr: "polos", es: "polos" },
  },
};

/** Omgekeerde index (vertaald woord → Nederlands) per locale. */
function bouwOmgekeerd(map) {
  const out = new Map();
  for (const locale of URL_LOCALES) {
    const rev = new Map();
    if (locale !== URL_DEFAULT_LOCALE) {
      for (const [nl, tr] of Object.entries(map)) {
        const woord = tr[locale];
        if (woord && woord !== nl) rev.set(woord, nl);
      }
    }
    out.set(locale, rev);
  }
  return out;
}

const SEGMENTS_REV = bouwOmgekeerd(SEGMENTS);
const SLUGS_REV = new Map(Object.entries(SLUGS).map(([seg, m]) => [seg, bouwOmgekeerd(m)]));

function splits(path) {
  const staart = path.length > 1 && path.endsWith("/");
  return { delen: path.split("/").filter(Boolean), staart };
}

function plak(delen, staart) {
  if (!delen.length) return "/";
  return "/" + delen.join("/") + (staart ? "/" : "");
}

/**
 * Nederlands pad (prefix-loos) → gelokaliseerd pad (prefix-loos).
 * Onbekende segmenten en alle handles blijven ongemoeid.
 */
export function vertaalPad(nlPad, locale) {
  if (locale === URL_DEFAULT_LOCALE || !nlPad || !nlPad.startsWith("/")) return nlPad;
  const { delen, staart } = splits(nlPad);
  if (!delen.length) return nlPad;
  const nlSeg = delen[0];
  const seg = SEGMENTS[nlSeg] && SEGMENTS[nlSeg][locale];
  if (seg) delen[0] = seg;
  const slugMap = SLUGS[nlSeg];
  if (slugMap && delen[1]) {
    const slug = slugMap[delen[1]] && slugMap[delen[1]][locale];
    if (slug) delen[1] = slug;
  }
  return plak(delen, staart);
}

/**
 * Gelokaliseerd pad (prefix-loos) → Nederlands pad, zodat de middleware naar de
 * bestaande (Nederlandse) routebestanden kan rewriten. Onbekende woorden blijven
 * staan, dus een al-Nederlands pad komt er ongewijzigd uit.
 */
export function ontvertaalPad(locPad, locale) {
  if (locale === URL_DEFAULT_LOCALE || !locPad || !locPad.startsWith("/")) return locPad;
  const { delen, staart } = splits(locPad);
  if (!delen.length) return locPad;
  const revSeg = SEGMENTS_REV.get(locale);
  const nlSeg = revSeg && revSeg.get(delen[0]);
  if (nlSeg) delen[0] = nlSeg;
  const slugMapRev = SLUGS_REV.get(delen[0]);
  if (slugMapRev && delen[1]) {
    const rev = slugMapRev.get(locale);
    const nlSlug = rev && rev.get(delen[1]);
    if (nlSlug) delen[1] = nlSlug;
  }
  return plak(delen, staart);
}

/** Volledig publiek pad inclusief locale-prefix. NL-pad in, publieke URL uit. */
export function publiekPad(nlPad, locale) {
  if (locale === URL_DEFAULT_LOCALE) return nlPad || "/";
  const vertaald = vertaalPad(nlPad, locale);
  return `/${locale}${vertaald === "/" ? "" : vertaald}`;
}

/**
 * Een href uit een component omzetten naar het publieke, gelokaliseerde pad.
 *
 * Dit lost het echte SEO-lek op: op /en/category/suits stonden 86 interne links
 * zónder /en-prefix. Een bezoeker merkte dat niet (de locale-cookie hield de
 * taal vast), maar Googlebot volgt links en had géén cookie — die stapte bij de
 * eerste klik terug de Nederlandse boom in. De hele anderstalige site was
 * daardoor één niveau diep en verder onbereikbaar.
 *
 * Laat met rust: externe links, ankers, mailto/tel, /api/, en hrefs die al een
 * locale-prefix dragen (een bewuste kruislink naar een andere taal).
 */
export function lokaliseerHref(href, locale) {
  if (locale === URL_DEFAULT_LOCALE) return href;
  if (typeof href !== "string" || !href.startsWith("/") || href.startsWith("//")) return href;
  if (href.startsWith("/api/")) return href;

  const eersteSeg = href.split(/[/?#]/)[1] || "";
  if (URL_LOCALES.includes(eersteSeg)) return href; // al geprefixt

  const grens = href.search(/[?#]/);
  const pad = grens === -1 ? href : href.slice(0, grens);
  const staart = grens === -1 ? "" : href.slice(grens);
  return publiekPad(pad, locale) + staart;
}
