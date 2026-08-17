"use client";

/**
 * Attributie-opvang: waar komt deze bezoeker vandaan?
 *
 * Dit ontbrak volledig. `gclid`, `fbclid`, `utm_source` — geen van alle kwam
 * ergens in de code voor, dus élke bestelling was ongeattribueerd en er was
 * geen enkele manier om een server-side conversie aan de juiste advertentieklik
 * te hangen. Zonder klik-id kan Google Ads een offline of server-side conversie
 * simpelweg niet toewijzen; die verdwijnt dan in "direct".
 *
 * Wat hier gebeurt:
 *  - EERSTE aanraking wordt één keer vastgelegd en daarna nooit meer
 *    overschreven. Dat is de campagne die de klant BRACHT.
 *  - LAATSTE aanraking beweegt wel mee, want dat is wat de meeste
 *    advertentieplatforms zelf rapporteren; het verschil tussen die twee is
 *    precies het gesprek dat je met een bureau wilt kunnen voeren.
 *  - Klik-id's worden apart bewaard en overleven de sessie (90 dagen), omdat
 *    een klant zelden koopt in het bezoek waarin hij klikte.
 *
 * Alles staat in localStorage en gaat pas mee ná analytics-toestemming, net als
 * de rest van de meting.
 */

const SLEUTEL = "gents-attributie";
const BEWAARTERMIJN_MS = 90 * 24 * 60 * 60 * 1000;

export type Attributie = {
  firstSource: string;
  firstMedium: string;
  firstCampaign: string;
  firstTerm: string;
  firstContent: string;
  firstReferrer: string;
  firstLanding: string;
  lastSource: string;
  lastMedium: string;
  lastCampaign: string;
  gclid: string;
  gbraid: string;
  wbraid: string;
  fbclid: string;
  ttclid: string;
  msclkid: string;
  /** Wanneer de eerste aanraking was — bepaalt of we mogen verversen. */
  ts: number;
};

const LEEG: Attributie = {
  firstSource: "", firstMedium: "", firstCampaign: "", firstTerm: "", firstContent: "",
  firstReferrer: "", firstLanding: "", lastSource: "", lastMedium: "", lastCampaign: "",
  gclid: "", gbraid: "", wbraid: "", fbclid: "", ttclid: "", msclkid: "", ts: 0,
};

/** Zoekmachines die we als organisch verkeer herkennen (geen uitputtende lijst). */
const ZOEKMACHINES = /google\.|bing\.|duckduckgo\.|yahoo\.|ecosia\.|startpagina\.|yandex\./i;
const SOCIAAL = /facebook\.|instagram\.|linkedin\.|pinterest\.|tiktok\.|x\.com|twitter\.|youtube\./i;

/**
 * Bron/medium afleiden als er geen utm-parameters zijn. Dit is de regel die
 * anders in Google Analytics zit en die we hier zelf moeten nabouwen, omdat
 * onze eigen database de bron van waarheid is.
 */
function uitReferrer(ref: string, host: string): { source: string; medium: string } {
  if (!ref) return { source: "(direct)", medium: "(none)" };
  try {
    const u = new URL(ref);
    if (u.hostname === host || u.hostname.endsWith(`.${host}`)) return { source: "", medium: "" }; // interne klik
    if (ZOEKMACHINES.test(u.hostname)) return { source: u.hostname.replace(/^www\./, ""), medium: "organic" };
    if (SOCIAAL.test(u.hostname)) return { source: u.hostname.replace(/^www\./, ""), medium: "social" };
    return { source: u.hostname.replace(/^www\./, ""), medium: "referral" };
  } catch {
    return { source: "(direct)", medium: "(none)" };
  }
}

function lees(): Attributie {
  try {
    const raw = localStorage.getItem(SLEUTEL);
    if (!raw) return { ...LEEG };
    const a = { ...LEEG, ...(JSON.parse(raw) as Partial<Attributie>) };
    // Verlopen eerste aanraking: begin schoon, anders schrijven we een klik van
    // een half jaar geleden toe aan de bestelling van vandaag.
    if (a.ts && Date.now() - a.ts > BEWAARTERMIJN_MS) return { ...LEEG };
    return a;
  } catch {
    return { ...LEEG };
  }
}

/**
 * Lees de huidige URL + referrer en werk de opgeslagen attributie bij.
 * Retourneert het bijgewerkte object, of null wanneer er niets te melden is.
 */
export function vangAttributie(): Attributie | null {
  if (typeof window === "undefined") return null;
  try {
    const p = new URLSearchParams(window.location.search);
    const g = (k: string) => (p.get(k) || "").slice(0, 200);
    const a = lees();

    const utmSource = g("utm_source");
    const utmMedium = g("utm_medium");
    const utmCampaign = g("utm_campaign");
    const klikIds = {
      gclid: g("gclid"),
      gbraid: g("gbraid"),
      wbraid: g("wbraid"),
      fbclid: g("fbclid"),
      ttclid: g("ttclid"),
      msclkid: g("msclkid"),
    };

    const afgeleid = uitReferrer(document.referrer || "", window.location.hostname);
    // Een klik-id zonder utm is nog steeds betaald verkeer — dat mag nooit als
    // "direct" wegzakken, want dan lijkt betaalde reclame gratis.
    const betaald =
      klikIds.gclid || klikIds.gbraid || klikIds.wbraid
        ? { source: "google", medium: "cpc" }
        : klikIds.fbclid
          ? { source: "facebook", medium: "paid_social" }
          : klikIds.ttclid
            ? { source: "tiktok", medium: "paid_social" }
            : klikIds.msclkid
              ? { source: "bing", medium: "cpc" }
              : null;

    const source = utmSource || betaald?.source || afgeleid.source;
    const medium = utmMedium || betaald?.medium || afgeleid.medium;

    // Interne klik zonder campagne: niets te melden, laat staan wat er stond.
    const nieuweAanraking = Boolean(source);
    let gewijzigd = false;

    for (const [k, v] of Object.entries(klikIds)) {
      if (v && a[k as keyof Attributie] !== v) {
        (a as unknown as Record<string, string>)[k] = v;
        gewijzigd = true;
      }
    }

    if (nieuweAanraking) {
      if (!a.firstSource) {
        a.firstSource = source;
        a.firstMedium = medium;
        a.firstCampaign = utmCampaign;
        a.firstTerm = g("utm_term");
        a.firstContent = g("utm_content");
        a.firstReferrer = (document.referrer || "").slice(0, 300);
        a.firstLanding = (window.location.pathname || "/").slice(0, 300);
        a.ts = Date.now();
        gewijzigd = true;
      }
      if (a.lastSource !== source || a.lastMedium !== medium || a.lastCampaign !== utmCampaign) {
        a.lastSource = source;
        a.lastMedium = medium;
        a.lastCampaign = utmCampaign;
        gewijzigd = true;
      }
    }

    if (!gewijzigd) return null;
    localStorage.setItem(SLEUTEL, JSON.stringify(a));
    return a;
  } catch {
    return null;
  }
}

/** De opgeslagen attributie, om mee te sturen bij een bestelling. */
export function huidigeAttributie(): Attributie | null {
  if (typeof window === "undefined") return null;
  const a = lees();
  return a.firstSource || a.gclid || a.fbclid ? a : null;
}
