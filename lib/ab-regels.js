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
  // winkelwagen of checkout wéken eerder uitsluitsel.
  const DOELEN = ["purchase", "add_to_cart", "checkout_start"];
  const doel = DOELEN.includes(r.doel) ? r.doel : "purchase";

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
