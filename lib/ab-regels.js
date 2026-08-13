/**
 * Pure A/B-regels: bucketen, variantkeuze, targeting en sanering. Bewust een
 * los JS-bestand zonder Next-imports zodat `node --test` erbij kan (zelfde
 * patroon als lib/sandbox-verversen-regels.js) — dit is de wiskunde die
 * bepaalt wie welke variant ziet, en die hoort onder test te staan.
 * lib/experiments.ts levert de types en de Next-kant (cookies/headers/store).
 */

/** FNV-1a → bucket 0-99. Zelfde bezoeker + zelfde experiment = zelfde bucket. */
export function bucketVoor(bezoekerId, experimentId) {
  const input = `${bezoekerId}:${experimentId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/** De variant waar deze bucket in valt (cumulatieve gewichten, geschaald naar 100). */
export function variantVoorBucket(exp, bucket) {
  const totaal = exp.varianten.reduce((sum, v) => sum + v.gewicht, 0) || 1;
  let grens = 0;
  for (const v of exp.varianten) {
    grens += (v.gewicht / totaal) * 100;
    if (bucket < grens) return v;
  }
  return exp.varianten[exp.varianten.length - 1];
}

/** Doet deze bezoeker (land/regio) mee aan dit experiment? */
export function doetMee(exp, land, regio) {
  if (exp.status !== "actief") return false;
  // Land-gericht experiment zonder bekend land (lokaal, of een proxy die de
  // geo-headers sloopt): NIET meedoen. Liever een bezoeker te weinig in de
  // test dan een Duitse variant voor een onbekende Nederlander.
  if (exp.landen?.length && !exp.landen.includes(land)) return false;
  if (exp.regios?.length && !exp.regios.includes(regio)) return false;
  return true;
}

/** Oppervlakken: wáár een experiment leeft — en dus waar het gemeten wordt. */
export const OPPERVLAKKEN = ["site", "pdp", "plp"];

/**
 * Hoort dit experiment op DEZE pagina thuis?
 *
 * Dit is de tweede helft van de targeting, en hij bestaat om één reden: de
 * noemer. Een experiment dat alleen de productpagina verandert mag alleen
 * bezoekers tellen die een productpagina zagen — anders verdrinkt een echt
 * effect in duizenden bezoekers die de variant nooit onder ogen kregen. Zelfde
 * principe als bij de aankondigingsbalk (site-breed) versus de homepage-test.
 *
 * ctx = { oppervlak, handle, categorieen[], mobiel }. Onbekend apparaat bij een
 * apparaat-gerichte test doet niet mee — zelfde keuze als bij onbekend land.
 */
export function pastBijPagina(exp, ctx) {
  const doelOppervlak = exp.oppervlak || "site";
  if (doelOppervlak !== (ctx?.oppervlak || "site")) return false;

  if (exp.apparaat === "mobiel" && ctx?.mobiel !== true) return false;
  if (exp.apparaat === "desktop" && ctx?.mobiel !== false) return false;

  // Bereik is alleen zinnig binnen een oppervlak: "alleen pakken" of "alleen
  // deze drie artikelen". Op site-niveau bestaat er geen product om op te
  // matchen, dus daar telt het niet mee.
  const handles = exp.bereik?.handles || [];
  const categorieen = exp.bereik?.categorieen || [];
  if (doelOppervlak === "site" || (!handles.length && !categorieen.length)) return true;

  const inCategorie = categorieen.length
    ? (ctx?.categorieen || []).some((c) => categorieen.includes(c))
    : false;
  const inHandles = handles.length ? handles.includes(ctx?.handle || "") : false;
  // Beide ingevuld = OF: "deze categorie, plús dit ene artikel erbuiten".
  return inCategorie || inHandles;
}

/* ── sanering ──────────────────────────────────────────────────────────── */

const s = (v, n) => String(v ?? "").trim().slice(0, n);
const href = (v) => {
  const h = s(v, 200);
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "";
};
const beeld = (v) => {
  const u = s(v, 400);
  return /^(\/|https:\/\/)/i.test(u) ? u : "";
};
export const slug = (v, n) =>
  s(v, n).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
/** Drieknop: aan / uit / niets gezegd (= laten zoals het is). */
const aanUit = (v) => (v === "aan" ? "aan" : v === "uit" ? "uit" : "");

/** Sorteringen die de PLP kent (lib/plp-params — daar is dit de bron). */
export const SORTERINGEN = ["aanbevolen", "populair", "nieuw", "prijs-op", "prijs-af", "naam"];

function schoonOverrides(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const out = {};

  if (r.announcement && typeof r.announcement === "object") {
    const a = r.announcement;
    const text = s(a.text, 240);
    const linkLabel = s(a.linkLabel, 60);
    const linkHref = href(a.linkHref);
    if (text || linkLabel) out.announcement = { text, linkLabel: linkLabel || undefined, linkHref: linkHref || undefined };
  }

  if (r.hero && typeof r.hero === "object") {
    const h = r.hero;
    const hero = {};
    const zet = (k, v) => { if (v) hero[k] = v; };
    zet("eyebrow", s(h.eyebrow, 60));
    zet("title", s(h.title, 120));
    zet("subtitle", s(h.subtitle, 280));
    zet("videoUrl", beeld(h.videoUrl));
    zet("videoUrlMobile", beeld(h.videoUrlMobile));
    zet("posterUrl", beeld(h.posterUrl));
    zet("primaryLabel", s(h.primaryLabel, 40));
    zet("primaryHref", href(h.primaryHref));
    zet("secondaryLabel", s(h.secondaryLabel, 40));
    zet("secondaryHref", href(h.secondaryHref));
    if (Object.keys(hero).length) out.hero = hero;
  }

  if (Array.isArray(r.usps)) {
    const usps = r.usps.map((x) => s(x, 80)).filter(Boolean).slice(0, 8);
    if (usps.length) out.usps = usps;
  }

  if (r.eigenIndeling === true) out.eigenIndeling = true;

  /* ── Productpagina ─────────────────────────────────────────────────────
     Alleen knoppen die op een bestaand blok zitten. Elk veld is optioneel en
     "niet ingevuld" betekent altijd: laat staan zoals het is. Zo blijft
     variant A (de controle) per definitie de huidige pagina. */
  if (r.pdp && typeof r.pdp === "object") {
    const p = r.pdp;
    const pdp = {};
    const zet = (k, v) => { if (v) pdp[k] = v; };
    zet("ctaLabel", s(p.ctaLabel, 40));
    zet("stickyKoopbalk", aanUit(p.stickyKoopbalk));
    zet("socialProof", aanUit(p.socialProof));
    zet("levertijd", aanUit(p.levertijd));
    zet("aanbevelingen", aanUit(p.aanbevelingen));
    zet("galerijStart", p.galerijStart === "packshot" || p.galerijStart === "model" ? p.galerijStart : "");
    if (p.accordionsOpen === true) pdp.accordionsOpen = true;
    if (Array.isArray(p.usps)) {
      const usps = p.usps.map((x) => s(x, 80)).filter(Boolean).slice(0, 5);
      if (usps.length) pdp.usps = usps;
    }
    if (Object.keys(pdp).length) out.pdp = pdp;
  }

  /* ── Categorie- en collectiepagina ─────────────────────────────────────
     De standaardsortering is hier de zwaarste knop: die bepaalt wat 80% van
     de bezoekers überhaupt te zien krijgt. Hij geldt alléén zolang de
     bezoeker zelf niets kiest — een ?sort= in de URL wint altijd, anders
     zou de sorteerknop stilletjes niets doen. */
  if (r.plp && typeof r.plp === "object") {
    const p = r.plp;
    const plp = {};
    if (SORTERINGEN.includes(p.sortering)) plp.sortering = p.sortering;
    const kolommen = Math.round(Number(p.kolommenMobiel));
    if (kolommen === 1 || kolommen === 2) plp.kolommenMobiel = kolommen;
    const per = Math.round(Number(p.perPagina));
    if (Number.isFinite(per) && per >= 8 && per <= 48) plp.perPagina = per;
    if (p.tegelBeeld === "model" || p.tegelBeeld === "packshot") plp.tegelBeeld = p.tegelBeeld;
    const badges = aanUit(p.tegelBadges);
    if (badges) plp.tegelBadges = badges;
    if (Object.keys(plp).length) out.plp = plp;
  }

  /* Andere volgorde van de betaalmethoden, per landcode. We saneren hier alleen
     de VORM (landcode, kleine letters, hooguit zes per land): welke id's Mollie
     echt kent staat in lib/payment-methods, en dat is TypeScript — dit bestand
     is bewust kaal JS zodat `node --test` erbij kan. Een onbekende id valt bij
     het renderen vanzelf weg (splitMethods slaat 'm over), dus een tikfout
     levert hooguit een kortere kopgroep op, nooit een dode knop. */
  if (r.betaalmethoden && typeof r.betaalmethoden === "object") {
    const bm = {};
    const landen = {};
    const perLand = r.betaalmethoden.topByCountry;
    if (perLand && typeof perLand === "object") {
      for (const [land, ids] of Object.entries(perLand)) {
        const code = String(land).trim() === "*" ? "*" : s(land, 2).toUpperCase();
        const lijst = (Array.isArray(ids) ? ids : [])
          .map((x) => s(x, 30).toLowerCase())
          .filter(Boolean)
          .slice(0, 6);
        if (code && lijst.length) landen[code] = lijst;
      }
    }
    if (Object.keys(landen).length) bm.topByCountry = landen;
    const max = Math.round(Number(r.betaalmethoden.maxVisible));
    if (Number.isFinite(max) && max > 0) bm.maxVisible = Math.min(6, max);
    if (Object.keys(bm).length) out.betaalmethoden = bm;
  }

  return Object.keys(out).length ? out : undefined;
}

function schoonExperiment(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const id = slug(r.id, 40);
  if (!id) return null;

  const statusRaw = s(r.status, 10);
  const status = statusRaw === "actief" ? "actief" : statusRaw === "gestopt" ? "gestopt" : "concept";

  const variantenRaw = Array.isArray(r.varianten) ? r.varianten : [];
  const gezien = new Set();
  const varianten = [];
  for (const v of variantenRaw.slice(0, 6)) {
    const vr = v && typeof v === "object" ? v : {};
    let key = s(vr.key, 12).toUpperCase() || "A";
    while (gezien.has(key)) key = `${key}X`;
    gezien.add(key);
    const gewicht = Math.round(Number(vr.gewicht));
    varianten.push({
      key,
      gewicht: Number.isFinite(gewicht) ? Math.min(100, Math.max(0, gewicht)) : 0,
      overrides: schoonOverrides(vr.overrides),
    });
  }
  // Minder dan twee varianten is geen experiment; en zonder enig gewicht > 0
  // zou de verdeling delen-door-nul zijn.
  if (varianten.length < 2) return null;
  if (!varianten.some((v) => v.gewicht > 0)) varianten[0].gewicht = 100;

  // Valideren op de HELE invoer, niet eerst afkappen: s(x, 2) zou van
  // "Duitsland" een geldig ogend "DU" maken — precies het soort typefout dat
  // een land-targeting stil verkeerd zet. (Gevangen door de eerste testrun.)
  const landen = (Array.isArray(r.landen) ? r.landen : [])
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter((x) => /^[A-Z]{2}$/.test(x))
    .slice(0, 30);
  const regios = (Array.isArray(r.regios) ? r.regios : [])
    .map((x) => String(x ?? "").trim().toUpperCase())
    .filter((x) => /^[A-Z0-9]{1,6}$/.test(x))
    .slice(0, 30);

  // Doelmetric: waarop de significantie gerekend wordt. Aankopen zijn het
  // eerlijkste doel maar het traagste signaal; bij dun verkeer geeft
  // winkelwagen of checkout wéken eerder uitsluitsel. product_click en
  // product_view zijn de dichtstbijzijnde doelen van een lijstpagina: een
  // categorietest die op aankoop moet wachten meet vooral ruis van álles wat
  // ná de doorklik gebeurt.
  const DOELEN = ["purchase", "add_to_cart", "checkout_start", "product_click", "product_view"];
  const doel = DOELEN.includes(r.doel) ? r.doel : "purchase";

  // Oppervlak = waar de variant zichtbaar is, en dus waar geteld wordt.
  const oppervlak = OPPERVLAKKEN.includes(r.oppervlak) ? r.oppervlak : "site";

  // Apparaat-targeting: een sticky koopbalk of één-kolomsraster is een
  // mobiele vraag; die uitsmeren over desktopverkeer verdunt het effect.
  const apparaat = r.apparaat === "mobiel" || r.apparaat === "desktop" ? r.apparaat : "alle";

  // Bereik: welke categorieën/artikelen. Op site-niveau betekenisloos, dus
  // dan laten we het weg in plaats van het stil te bewaren.
  const lijstje = (v, n) =>
    (Array.isArray(v) ? v : []).map((x) => slug(x, 60)).filter(Boolean).slice(0, n);
  const categorieen = oppervlak === "site" ? [] : lijstje(r.bereik?.categorieen, 30);
  const handles = oppervlak === "pdp" ? lijstje(r.bereik?.handles, 50) : [];
  const bereik =
    categorieen.length || handles.length
      ? { categorieen: categorieen.length ? categorieen : undefined, handles: handles.length ? handles : undefined }
      : undefined;

  // Meetvenster: door de server gestempeld bij een statuswissel (de POST-route
  // negeert wat de client stuurt). Hier alleen valideren dat het echte datums
  // zijn, zodat een kapot document nooit een kapotte query wordt.
  const datum = (v) => {
    const d = new Date(String(v ?? ""));
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  };

  return {
    id,
    naam: s(r.naam, 80) || id,
    status,
    doel,
    oppervlak,
    apparaat,
    bereik,
    landen: landen.length ? landen : undefined,
    regios: regios.length ? regios : undefined,
    varianten,
    hypothese: s(r.hypothese, 500) || undefined,
    gestartOp: datum(r.gestartOp),
    gestoptOp: datum(r.gestoptOp),
  };
}

export function schoonExperimentsDoc(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const lijst = Array.isArray(r.experimenten) ? r.experimenten : [];
  const experimenten = [];
  const ids = new Set();
  for (const e of lijst.slice(0, 50)) {
    const exp = schoonExperiment(e);
    if (exp && !ids.has(exp.id)) {
      ids.add(exp.id);
      experimenten.push(exp);
    }
  }
  return { experimenten };
}
