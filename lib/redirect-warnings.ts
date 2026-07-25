/**
 * Waarschuwingen bij redirect-regels — puur rekenwerk, GEEN database-import,
 * zodat zowel de server (Site-studio-pagina) als de browser (het formulier,
 * live tijdens typen) hem kan gebruiken.
 *
 * Achtergrond: een redirect wordt in de middleware afgehandeld vóór de routing.
 * Een regel op een pad dat de winkel zelf al bedient, verbergt dus een werkende
 * pagina. En op de kern-routes (inloggen, afrekenen, winkelwagen, API) negeert
 * `matchRedirect` een regel onvoorwaardelijk — daar is een redirect per definitie
 * een fout (dat was de redirect-lus /account/login → /account).
 */

/**
 * Spiegel van PROTECTED_PREFIXES in lib/redirects.ts — dáár is de bron van
 * waarheid voor het gedrag; die constante is niet geëxporteerd omdat de
 * edge-leeslaag zo klein mogelijk blijft. Wijzigt die lijst, pas deze dan mee aan.
 */
const PROTECTED_PREFIXES = ["/account", "/afrekenen", "/winkelwagen", "/api"];

/**
 * Bestaande app-routes (eerste padsegment) van de winkel. Advieslijst: een
 * redirect op precies dit pad werkt wél, maar zet de echte pagina buitenspel.
 * Bewust alleen op een EXACTE treffer: onder /products, /pages, /categorie enz.
 * zitten dynamische pagina's, en juist daar is een redirect voor een verdwenen
 * artikel of pagina normaal — daar mag geen waarschuwing over komen.
 */
const APP_ROUTES = [
  "/afspraak",
  "/bestelling",
  "/blog",
  "/cadeaubon",
  "/categorie",
  "/collections",
  "/favorieten",
  "/gelegenheden",
  "/looks",
  "/maatadvies",
  "/maattabellen",
  "/merken",
  "/nieuwsbrief",
  "/pages",
  "/pak-samenstellen",
  "/products",
  "/profiel-afronden",
  "/punten-claim",
  "/reservering-afrekenen",
  "/retourneren",
  "/review",
  "/vraag",
  "/winkelwagen",
  "/zoeken",
];

/** Zelfde normalisatie als normPath in lib/redirects.ts (bewust lokaal: dit bestand blijft db-vrij). */
const norm = (p: string) => "/" + String(p || "").trim().replace(/^\/+/, "").replace(/\/+$/, "");

const isWild = (s: string) => /\/\*+$/.test(String(s || ""));
const isExternal = (s: string) => /^https?:\/\//i.test(String(s || "").trim());
/** Pad zonder wildcard-staart, genormaliseerd. */
const basePath = (s: string) => norm(String(s || "").replace(/\/\*+$/, ""));
const under = (p: string, prefix: string) => p === prefix || p.startsWith(prefix + "/");

/**
 * Sleutel waarop een regel wordt herkend — spiegel van cleanSource in
 * lib/redirects-admin (pad genormaliseerd, wildcard-staart blijft staan). Gedeeld
 * met het formulier, zodat "bestaat al" client- en serverkant hetzelfde beoordeelt.
 */
export const redirectSourceKey = (source: string) => {
  const raw = String(source || "").trim();
  const base = basePath(raw);
  return isWild(raw) ? `${base === "/" ? "" : base}/*` : base;
};

export type RedirectWarning = { level: "blok" | "let-op"; text: string };
export type RedirectLike = { source: string; target: string; active?: boolean };

/**
 * Beoordeelt één regel. `all` (optioneel) is de volledige lijst, nodig om
 * ketens te herkennen (doel is zelf weer een bron).
 */
export function redirectWarnings(rule: RedirectLike, all: RedirectLike[] = []): RedirectWarning[] {
  const out: RedirectWarning[] = [];
  const src = basePath(rule.source);
  if (!src || src === "/") return out;

  // 1. Kern-route: de site negeert deze regel altijd.
  const protectedHit = PROTECTED_PREFIXES.find((pre) => under(src, pre));
  if (protectedHit) {
    out.push({
      level: "blok",
      text: `Doet niets: ${protectedHit} is een beschermde kern-route (inloggen, afrekenen, winkelwagen, API). De winkel slaat redirects hierop over.`,
    });
  }

  // 2. Kaapt een bestaande pagina van de winkel.
  const routeHit = APP_ROUTES.find((r) => r === src);
  if (routeHit && !protectedHit) {
    out.push({
      level: "let-op",
      text: `Kaapt een bestaande pagina: ${src} is een echte pagina van de winkel. Met deze regel ziet niemand die pagina nog.`,
    });
  }

  // 3. Doel.
  if (!isExternal(rule.target)) {
    const tgt = basePath(rule.target);
    if (!tgt || tgt === "/") {
      // Doorsturen naar de homepage mag, maar is zelden wat je bedoelt.
      if (rule.target.trim() && norm(rule.target) === "/") {
        out.push({ level: "let-op", text: "Doel is de homepage — een specifiekere bestemming scoort beter in Google." });
      }
    } else {
      if (under(tgt, "/api")) {
        out.push({ level: "blok", text: `Doel ${tgt} is geen pagina maar een API-pad — bezoekers zien geen winkel.` });
      }
      // Keten: het doel is zelf weer bron van een andere actieve regel.
      const chain = all.find(
        (r) => r !== rule && r.active !== false && !isWild(r.source) && norm(r.source) === tgt && basePath(r.source) !== src,
      );
      if (chain) {
        out.push({ level: "let-op", text: `Keten: ${tgt} wordt zelf weer doorgestuurd naar ${chain.target}. Wijs direct naar de eindbestemming.` });
      }
    }
    if (isWild(rule.source)) {
      if (under(tgt, src)) {
        // De winkel matcht een wildcard óók op het prefix zelf, dus een doel dat
        // binnen de eigen bron valt stuurt de bezoeker eindeloos naar zichzelf.
        out.push({
          level: "blok",
          text: `Oneindige lus: ${tgt} valt zelf onder ${rule.source}. Kies een doel buiten ${src}.`,
        });
      } else if (!isWild(rule.target)) {
        // Wildcard-bron zonder wildcard-doel: het restpad valt weg.
        out.push({ level: "let-op", text: "Alles onder deze bron gaat naar één vast doel. Wil je het restpad meenemen, zet dan ook /* achter het doel." });
      }
    }
  }

  return out;
}
