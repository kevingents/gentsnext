import { cookies, headers } from "next/headers";
import { getContentDoc } from "@/lib/content-store";
import { bucketVoor, variantVoorBucket, doetMee, pastBijPagina, schoonExperimentsDoc, slug } from "@/lib/ab-regels";

/**
 * A/B-testen, in eigen huis. Een experiment verdeelt bezoekers over varianten
 * (bv. 90/10), optioneel beperkt tot landen en regio's, en elke variant kan
 * onderdelen van de site overschrijven: de aankondigingsbalk, de hero, de
 * USP's, of een complete eigen homepage-indeling.
 *
 * De toewijzing is DETERMINISTISCH: een hash van bezoekers-id + experiment-id
 * bepaalt de bucket (0-99). Dezelfde bezoeker krijgt dus altijd dezelfde
 * variant — ook na een herbezoek, ook zonder dat we per experiment iets hoeven
 * op te slaan — en verschillende experimenten verdelen onafhankelijk van
 * elkaar (wie in experiment 1 in B zit, zit niet automatisch in B van 2).
 *
 * De bezoekers-id is een anonieme cookie (gents_ab, gezet door de middleware).
 * Land en regio komen uit de geo-headers die Vercel op elk verzoek meestuurt;
 * lokaal ontbreken die en telt een land-gericht experiment niemand in.
 *
 * Meting: de site logt één ab_exposure-event per sessie per experiment (via de
 * bestaande events-rail), met handle "<experiment>:<variant>". Conversie =
 * purchase-events van diezelfde sessies. Zo sluit de meting aan op de
 * rapportages die er al zijn, zonder nieuw opslagmodel.
 *
 * De pure regels (bucketen, variantkeuze, targeting, sanering) staan in
 * lib/ab-regels.js zodat `node --test` erbij kan; dit bestand levert de
 * Next-kant: types, de store en de resolver.
 */

export type AbOverrides = {
  /** Vervangt de tekst in de aankondigingsbalk (in élke taal — zie taalregel). */
  announcement?: { text?: string; linkLabel?: string; linkHref?: string };
  /** Overschrijft losse hero-velden; wat leeg is blijft zoals het was. */
  hero?: {
    eyebrow?: string;
    title?: string;
    subtitle?: string;
    videoUrl?: string;
    videoUrlMobile?: string;
    posterUrl?: string;
    primaryLabel?: string;
    primaryHref?: string;
    secondaryLabel?: string;
    secondaryHref?: string;
  };
  /** Vervangt de hele USP-strip. */
  usps?: string[];
  /**
   * Andere volgorde van de betaalmethoden in de checkout. Per landcode een
   * geordend lijstje Mollie-id's (of "*" voor alle landen); wat de variant niet
   * noemt houdt de ingestelde volgorde. Zie lib/payment-methods.
   */
  betaalmethoden?: { topByCountry?: Record<string, string[]>; maxVisible?: number };
  /**
   * Variant heeft een eigen homepage-indeling. Die leeft als apart document
   * (content:homepage:exp:<id>:<variant>) en wordt bewerkt met dezelfde
   * editor als de live indeling — geen tweede bewerkmodel.
   */
  eigenIndeling?: boolean;
  /**
   * Productpagina. Elk veld is optioneel; niet ingevuld = laten zoals het is,
   * zodat de controle-variant letterlijk de huidige pagina blijft.
   */
  pdp?: {
    /** Knoptekst in de koopkolom én in de mobiele balk (NL — zie taalregel). */
    ctaLabel?: string;
    /** Mobiele meelopende koopbalk. */
    stickyKoopbalk?: "aan" | "uit";
    /** "X mensen bekeken dit" onder de koopknop. */
    socialProof?: "aan" | "uit";
    /** Bezorgbelofte ("morgen in huis") bij de knop. */
    levertijd?: "aan" | "uit";
    /** Aanbevolen-producten onderaan. */
    aanbevelingen?: "aan" | "uit";
    /** Begint de galerij met de AI-modelfoto of met de packshot? */
    galerijStart?: "model" | "packshot";
    /** Hoeveel beelden de galerij hoogstens toont (1-12). */
    galerijMax?: number;
    /** Reviews direct onder de koopkolom ("boven") of onderaan de pagina ("onder"). */
    reviewsPositie?: "boven" | "onder";
    /** "-30%"-label naast de prijs bij een echte korting. */
    kortingLabel?: "aan" | "uit";
    /** Materiaal/verzorging standaard uitgeklapt. */
    accordionsOpen?: boolean;
    /** Vervangt het vertrouwenslijstje onder de koopknop (max 5). */
    usps?: string[];
  };
  /**
   * Categorie- en collectiepagina. De sortering geldt alleen zolang de
   * bezoeker zelf niets kiest — een ?sort= in de URL wint altijd.
   */
  plp?: {
    sortering?: "aanbevolen" | "populair" | "nieuw" | "prijs-op" | "prijs-af" | "naam";
    /** Tegels per rij op mobiel (1 of 2). */
    kolommenMobiel?: 1 | 2;
    /** Producten per pagina. */
    perPagina?: number;
    /** Welk beeld vooraan op de tegel staat (het andere blijft de hover). */
    tegelBeeld?: "model" | "packshot";
    /** Sale/nieuw/laatste-maten-badges op de tegel. */
    tegelBadges?: "aan" | "uit";
    /** Filters als vaste zijkolom of als knop met lade bovenaan (ook desktop). */
    filterPositie?: "zijkant" | "boven";
    /** Maat kiezen en toevoegen vanaf de tegel, zonder de productpagina. */
    snelToevoegen?: "aan" | "uit";
  };
};

export type AbVariant = {
  key: string;
  /** Gewicht in procenten; samen hoeven ze niet exact op 100 uit te komen. */
  gewicht: number;
  overrides?: AbOverrides;
};

export type AbDoel = "purchase" | "add_to_cart" | "checkout_start" | "product_click" | "product_view";

/** Waar een experiment leeft — en dus wie er in de noemer hoort. */
export type AbOppervlak = "site" | "pdp" | "plp";

export type Experiment = {
  id: string;
  naam: string;
  /** concept = onzichtbaar; actief = draait; gestopt = telt niet meer mee. */
  status: "concept" | "actief" | "gestopt";
  /** Waarop de significantie gerekend wordt; aankoop is eerlijk maar traag. */
  doel: AbDoel;
  /** site = overal; pdp = alleen productpagina's; plp = alleen lijstpagina's. */
  oppervlak: AbOppervlak;
  /** Apparaat-targeting; onbekend apparaat doet niet mee (zoals onbekend land). */
  apparaat: "alle" | "mobiel" | "desktop";
  /** Beperking binnen het oppervlak: categorieslugs en (op de PDP) artikelen. */
  bereik?: { categorieen?: string[]; handles?: string[] };
  /** ISO-2-landcodes (NL, BE, DE). Leeg = alle landen. */
  landen?: string[];
  /** Regiocodes binnen het land (Vercel: NB, ZH, …). Leeg = alle regio's. */
  regios?: string[];
  varianten: AbVariant[];
  /** Vrije notitie: wat test dit, en wanneer is het geslaagd? */
  hypothese?: string;
  /**
   * Rem op te vroeg stoppen. Vóór deze looptijd én steekproef toont de
   * resultatenroute géén significantie-oordeel — zie lib/ab-regels/oordeelKlaar.
   */
  minLooptijdDagen: number;
  /** 0 = laat de server het uitrekenen uit de gemeten conversie + verwachtEffectPct. */
  doelBezoekersPerVariant: number;
  /** Relatieve verbetering die je wilt kunnen zien (15 = 15% meer conversie). */
  verwachtEffectPct: number;
  /** Meetvenster — door de server gestempeld bij een statuswissel. */
  gestartOp?: string;
  gestoptOp?: string;
};

export type ExperimentsDoc = { experimenten: Experiment[] };
export type AbAssignment = {
  id: string;
  variant: string;
  overrides?: AbOverrides;
  /** Geforceerd via de preview-cookie — telt NIET mee in de meting. */
  forced?: boolean;
};

export const AB_COOKIE = "gents_ab";
export const AB_FORCE_COOKIE = "gents_ab_force";

export { schoonExperimentsDoc };

export async function getExperiments(): Promise<ExperimentsDoc> {
  const doc = await getContentDoc<ExperimentsDoc>("experiments");
  return doc ? (schoonExperimentsDoc(doc) as ExperimentsDoc) : { experimenten: [] };
}

/**
 * Waar staan we? Zonder context is dat "site" — dan doen alleen site-brede
 * experimenten mee, precies zoals vóór de PDP/PLP-uitbreiding.
 */
export type AbPaginaContext = {
  oppervlak: AbOppervlak;
  /** Producthandle (PDP) — voor bereik op losse artikelen. */
  handle?: string;
  /** Categorieslugs waar deze pagina onder valt (PDP: hoofdgroep; PLP: de lijst). */
  categorieen?: string[];
};

/** Mobiel? Client-hint eerst, user-agent als terugval, anders onbekend. */
function isMobiel(h: Headers): boolean | undefined {
  const hint = h.get("sec-ch-ua-mobile");
  if (hint === "?1") return true;
  if (hint === "?0") return false;
  const ua = h.get("user-agent") || "";
  if (!ua) return undefined;
  return /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
}

/**
 * De toewijzingen voor de huidige bezoeker, plus de samengevoegde overrides.
 * Draaien er twee actieve experimenten die hetzelfde onderdeel overschrijven,
 * dan wint de laatste in de lijst — de portal waarschuwt daarvoor, maar de
 * site mag er nooit op stuklopen.
 *
 * De context bepaalt wie er meedoet: een pdp-experiment wordt alleen op een
 * productpagina toegewezen. Dat is geen kosmetische scheiding maar de
 * meetkant ervan — de exposure die hier uit volgt is de noemer van de uitslag,
 * en bezoekers die de variant nooit zagen horen daar niet in.
 */
export async function resolveAb(
  ctx?: AbPaginaContext,
): Promise<{ assignments: AbAssignment[]; overrides: AbOverrides }> {
  try {
    const { experimenten } = await getExperiments();
    const oppervlak: AbOppervlak = ctx?.oppervlak ?? "site";
    const actief = experimenten.filter((e) => e.status === "actief" && (e.oppervlak || "site") === oppervlak);
    if (!actief.length) return { assignments: [], overrides: {} };

    const [c, h] = await Promise.all([cookies(), headers()]);
    const bezoeker = c.get(AB_COOKIE)?.value || "";
    // Zonder cookie (allereerste request, of cookies uit) geen toewijzing:
    // de bezoeker zou anders bij élk verzoek een andere variant kunnen krijgen.
    if (!bezoeker) return { assignments: [], overrides: {} };
    const land = (h.get("x-vercel-ip-country") || "").toUpperCase();
    const regio = (h.get("x-vercel-ip-country-region") || "").toUpperCase();
    const pagina = {
      oppervlak,
      handle: ctx?.handle ? slug(ctx.handle, 60) : "",
      categorieen: (ctx?.categorieen || []).map((x) => slug(x, 60)).filter(Boolean),
      mobiel: isMobiel(h),
    };

    // Preview: ?ab=<experiment>:<variant> zet (via de middleware) een korte
    // force-cookie. Die wint van de bucket én van de targeting — je wil variant
    // B kunnen nakijken vanaf kantoor, ook als de test op Duitsland mikt.
    // Geforceerde toewijzingen loggen géén exposure (zie TrackAb-aanroepers).
    const force = (c.get(AB_FORCE_COOKIE)?.value || "").split(":");
    const forceExp = force[0] || "";
    const forceVariant = (force[1] || "").toUpperCase();

    const assignments: AbAssignment[] = [];
    const overrides: AbOverrides = {};
    for (const exp of actief) {
      const geforceerd = exp.id === forceExp ? exp.varianten.find((v) => v.key === forceVariant) : undefined;
      // Preview wint van geo, apparaat én bereik — maar niet van het oppervlak:
      // een pdp-variant bestaat nu eenmaal niet op de homepage.
      if (!geforceerd && (!doetMee(exp, land, regio) || !pastBijPagina(exp, pagina))) continue;
      const variant = geforceerd ?? (variantVoorBucket(exp, bucketVoor(bezoeker, exp.id)) as AbVariant);
      assignments.push({ id: exp.id, variant: variant.key, overrides: variant.overrides, forced: Boolean(geforceerd) });
      if (variant.overrides) Object.assign(overrides, variant.overrides);
    }
    return { assignments, overrides };
  } catch {
    // A/B mag de site nooit breken: bij twijfel krijgt iedereen het origineel.
    return { assignments: [], overrides: {} };
  }
}

/** Documentsleutel van een variant-indeling (bewerkt met de homepage-editor). */
export function homepageVariantKey(experimentId: string, variant: string): string {
  return `homepage:exp:${slug(experimentId, 40)}:${slug(variant, 12)}`;
}
