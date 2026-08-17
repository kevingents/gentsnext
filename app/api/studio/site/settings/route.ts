import { NextResponse } from "next/server";
import { schoonPakbon } from "@/lib/pakbon-instelling";
import { schoonReturnConfig } from "@/lib/retour-instellingen";
import { adminOrToken } from "@/lib/studio-token";
import { getSettings, updateSettings, type Settings } from "@/lib/settings";
import { getSiteSettings, updateSiteSettings, type SiteSettingsPatch } from "@/lib/site-settings";
import { isFulfillable } from "@/lib/fulfillment-config";
import { MOLLIE_METHOD_IDS } from "@/lib/payment-methods";
import { SHIPPING_ZONES, DEFAULT_COUNTRY } from "@/lib/shipping-zones";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site"-CMS → Instellingen. Beheert de VEILIGE, operationele
 * knoppen (verzending, levertijd, cutoffs, cadeaubon, retouren) uit
 * app_settings.global én de homepage-content (announcement, hero, USP's) uit
 * app_settings.site.
 *
 * NIET hier: go-live-schakelaars (Mollie live, SRS_PUSH, Resend, indexable) —
 * die blijven env/secret. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 *
 * GET  → { ok, operational, content }
 * POST → body { operational?, content? } → opgeslagen + teruggegeven
 */

/** Alleen deze operationele velden mag de portal zetten (rest blijft ongemoeid). */
function sanitizeOperational(input: unknown, huidig: Settings): Partial<Settings> {
  const b = (input || {}) as Record<string, unknown>;
  const out: Partial<Settings> = {};
  const intFields: (keyof Settings)[] = [
    "freeShippingCents", "shippingCents", "expressSurchargeCents",
    "warehouseCutoffHour", "storeCutoffHour",
    "standardMinDays", "standardMaxDays",
    "warehouseTransitDays", "storeExtraDays", "expressTransitDays",
    "retailSafetyStock", "warehouseSafetyStock", "storeChannelSafetyStock",
    "storeHandoverMinutes",
  ];
  for (const f of intFields) {
    if (b[f] !== undefined && Number.isFinite(Number(b[f]))) {
      (out as Record<string, number>)[f] = Math.max(0, Math.round(Number(b[f])));
    }
  }
  if (b.protectUnderstockedRetail !== undefined) {
    out.protectUnderstockedRetail = Boolean(b.protectUnderstockedRetail);
  }
  /* Betaalkeuze: per land een geordend lijstje Mollie-method-id's dat bovenaan
     de afrekenpagina komt te staan. Onbekende id's weigeren we hier al — die
     zouden in de checkout stil wegvallen en er in de portal uitzien alsof ze
     ingesteld staan. Een leeg lijstje betekent "geen voorkeur voor dat land",
     dus die laten we vallen in plaats van 'm als lege regel te bewaren. */
  if (b.paymentTop && typeof b.paymentTop === "object") {
    const pt = b.paymentTop as Record<string, unknown>;
    const perLand: Record<string, string[]> = {};
    if (pt.topByCountry && typeof pt.topByCountry === "object") {
      for (const [land, ids] of Object.entries(pt.topByCountry as Record<string, unknown>)) {
        const code = String(land).trim() === "*" ? "*" : String(land).trim().toUpperCase().slice(0, 2);
        const lijst = (Array.isArray(ids) ? ids : [])
          .map((x) => String(x).trim().toLowerCase())
          .filter((x): x is (typeof MOLLIE_METHOD_IDS)[number] => (MOLLIE_METHOD_IDS as readonly string[]).includes(x))
          .slice(0, 6);
        if (code && lijst.length) perLand[code] = lijst;
      }
      out.paymentTop = {
        topByCountry: perLand,
        maxVisible: Math.max(1, Math.min(6, Math.round(Number(pt.maxVisible) || huidig.paymentTop.maxVisible))),
      };
    } else if (pt.maxVisible !== undefined) {
      out.paymentTop = {
        topByCountry: huidig.paymentTop.topByCountry,
        maxVisible: Math.max(1, Math.min(6, Math.round(Number(pt.maxVisible) || huidig.paymentTop.maxVisible))),
      };
    }
  }
  /* Bezorglanden: per landcode aan/uit, tarief, gratis-vanaf en extra dagen.
     Alleen landen die de code kent — een verzonnen code zou een order aannemen
     die we niet kunnen verzenden. Voor Nederland nemen we tarief en drempel
     NIET over: die staan hierboven al als losse knop, en twee bronnen voor
     hetzelfde land is vragen om een verschil tussen wat de checkout toont en
     wat de server rekent. Aan/uit en extra dagen mogen voor NL wel. */
  if (b.shippingZones && typeof b.shippingZones === "object") {
    const bekend = new Set(SHIPPING_ZONES.map((z) => z.code));
    const uit: Record<string, { enabled: boolean; rateCents: number; freeFromCents: number | null; extraDays: number }> = {};
    for (const [land, v] of Object.entries(b.shippingZones as Record<string, unknown>)) {
      const code = String(land).trim().toUpperCase();
      if (!bekend.has(code) || !v || typeof v !== "object") continue;
      const z = v as Record<string, unknown>;
      const basis = SHIPPING_ZONES.find((x) => x.code === code)!;
      const vrij = z.freeFromCents;
      uit[code] = {
        enabled: z.enabled === true,
        rateCents:
          code === DEFAULT_COUNTRY
            ? basis.rateCents
            : Math.max(0, Math.round(Number(z.rateCents) || 0)),
        freeFromCents:
          code === DEFAULT_COUNTRY
            ? basis.freeFromCents
            : vrij === null || vrij === "" || vrij === undefined
              ? null
              : Math.max(0, Math.round(Number(vrij) || 0)),
        extraDays: Math.max(0, Math.min(30, Math.round(Number(z.extraDays) || 0))),
      };
    }
    out.shippingZones = uit;
  }
  if (b.dispatchOnSunday !== undefined) out.dispatchOnSunday = Boolean(b.dispatchOnSunday);
  if (b.dispatchOnSaturdayStores !== undefined) out.dispatchOnSaturdayStores = Boolean(b.dispatchOnSaturdayStores);
  /* Tijdelijk gepauzeerde filialen: alleen bestaande filiaalnummers, zodat een
     typefout niet stilletjes niets doet (of erger: alles doorlaat). */
  if (Array.isArray(b.pausedBranchIds)) {
    out.pausedBranchIds = [...new Set(
      b.pausedBranchIds.map((v) => String(v).trim()).filter((v) => v && isFulfillable(v)),
    )];
  }
  /* Extra verzendvrije dagen: strikt yyyy-mm-dd, en alleen dit en volgend jaar —
     een tikfout als "20026-01-02" hoort niet stil in de kalender te belanden. */
  if (Array.isArray(b.extraClosureDates)) {
    /* Amsterdams jaar, niet UTC: in het eerste uur van 1 januari staat UTC nog
       in het oude jaar en zou een geldige sluitingsdag stil weggefilterd worden. */
    const nu = Number(
      new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", year: "numeric" }).format(new Date()),
    );
    out.extraClosureDates = [...new Set(
      b.extraClosureDates
        .map((v) => String(v).trim())
        .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)))
        .filter((v) => {
          const j = Number(v.slice(0, 4));
          return j >= nu && j <= nu + 2;
        }),
    )].sort();
  }
  /* Pakbontekst: geen getal maar een blok teksten — eigen sanitizer. */
  const pakbon = schoonPakbon(b.pakbon);
  if (pakbon) out.pakbon = pakbon;
  // Winkel-notificatie-adressen (o.a. afspraak-meldingen): beheerbaar via de
  // portal-studio i.p.v. env — zonder deze whitelist-entry was storeEmails
  // nergens te schrijven en viel elke winkelmelding terug op het centrale adres.
  if (b.storeEmails && typeof b.storeEmails === "object" && !Array.isArray(b.storeEmails)) {
    const map: Record<string, string> = {};
    for (const [k, v] of Object.entries(b.storeEmails as Record<string, unknown>)) {
      const key = String(k).trim().toLowerCase().slice(0, 60);
      const mail = String(v ?? "").trim().slice(0, 120);
      if (key && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) map[key] = mail;
    }
    out.storeEmails = map;
  }
  // Ontvangers van de interne bewakingsmeldingen (nachtelijke kassabon-
  // verificatie). Ook vanuit de portal te zetten, zodat wie de melding krijgt
  // een knop in de tool is en geen deploy.
  if (Array.isArray(b.alertEmails)) {
    out.alertEmails = b.alertEmails
      .map((a) => String(a ?? "").trim().slice(0, 120))
      .filter((a) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))
      .slice(0, 10);
  }
  if (b.routeOverstockFirst && typeof b.routeOverstockFirst === "object") {
    const r = b.routeOverstockFirst as Record<string, unknown>;
    out.routeOverstockFirst = {
      enabled: Boolean(r.enabled),
      minSurplus: Math.max(1, Math.round(Number(r.minSurplus) || 3)),
    };
  }
  if (b.tieredDiscount && typeof b.tieredDiscount === "object") {
    const t = b.tieredDiscount as Record<string, unknown>;
    out.tieredDiscount = {
      enabled: Boolean(t.enabled),
      minItems: Math.max(1, Math.round(Number(t.minItems) || 2)),
      percentOff: Math.max(0, Math.min(100, Math.round(Number(t.percentOff) || 0))),
    };
  }
  if (b.giftcardConfig && typeof b.giftcardConfig === "object") {
    const g = b.giftcardConfig as Record<string, unknown>;
    out.giftcardConfig = {
      enabled: Boolean(g.enabled),
      presetAmountsCents: Array.isArray(g.presetAmountsCents)
        ? g.presetAmountsCents.map((x) => Math.max(0, Math.round(Number(x) || 0))).filter((x) => x > 0)
        : [2500, 5000, 10000, 15000],
      minCents: Math.max(0, Math.round(Number(g.minCents) || 1000)),
      maxCents: Math.max(0, Math.round(Number(g.maxCents) || 50000)),
      validityMonths: Math.max(1, Math.round(Number(g.validityMonths) || 24)),
    };
  }
  /* RETOUREN — bedenktijd, retourkosten, gratis-bij-tegoed en de signaaldrempels.
     Stonden al in `returnConfig` en de portal kreeg ze via GET keurig te zien,
     maar ze ontbraken in deze whitelist: opslaan deed niets. Hetzelfde gat als
     eerder bij storeEmails. Grenzen + toelichting in lib/retour-instellingen. */
  const retour = schoonReturnConfig(b.returnConfig, huidig.returnConfig);
  if (retour) out.returnConfig = retour;
  /* SPAARPUNTEN — alle knoppen, want elk bedrag dat een klant kan verdienen of
     inwisselen moet in de tool te zetten zijn, niet in code.
     Bewust op de HUIDIGE loyaltyConfig gestapeld: updateSettings merget ondiep,
     dus een deel-object zou de rest van de spaarpunt-instellingen wissen.

     Twee waarschuwingen die de portal bij deze velden hoort te tonen:
     · `pointsPerEuro` geldt alleen voor de WEBSHOP. De kassa rekent in storegents
       met een eigen regel; wie hier draait moet die meedraaien, anders spaart
       dezelfde euro online anders dan in de winkel.
     · `redeemCentsPerPoint` verandert wat AL GESPAARDE punten waard zijn — het
       hele uitstaande saldo wordt in één klap meer of minder waard. */
  if (b.loyaltyConfig && typeof b.loyaltyConfig === "object") {
    const lc = b.loyaltyConfig as Record<string, unknown>;
    const nu = huidig.loyaltyConfig;
    /* Klemmen, niet weigeren — behalve buiten bereik: een vertypte 5000 mag geen
       tegoedbon van honderden euro's per klant uitdelen, en een 0 of leeg veld
       mag geen bestaande instelling stilletjes op nul zetten. */
    const getal = (v: unknown, val: number, min: number, max: number) =>
      Number.isFinite(Number(v)) ? Math.max(min, Math.min(max, Number(v))) : val;
    const geheel = (v: unknown, val: number, min: number, max: number) => Math.round(getal(v, val, min, max));
    const lb = (lc.bonusPoints || {}) as Record<string, unknown>;
    out.loyaltyConfig = {
      ...nu,
      pointsPerEuro: getal(lc.pointsPerEuro, nu.pointsPerEuro, 0.01, 100),
      vestingDays: geheel(lc.vestingDays, nu.vestingDays, 0, 365),
      redeemCentsPerPoint: getal(lc.redeemCentsPerPoint, nu.redeemCentsPerPoint, 0.01, 100),
      redeemMinPoints: geheel(lc.redeemMinPoints, nu.redeemMinPoints, 1, 100000),
      redeemStepPoints: geheel(lc.redeemStepPoints, nu.redeemStepPoints, 0, 100000),
      redeemVoucherDays: geheel(lc.redeemVoucherDays, nu.redeemVoucherDays, 1, 3650),
      bonusPoints: {
        accountCreated: geheel(lb.accountCreated, nu.bonusPoints.accountCreated, 0, 5000),
        sizeAdvice: geheel(lb.sizeAdvice, nu.bonusPoints.sizeAdvice, 0, 5000),
        walletPass: geheel(lb.walletPass, nu.bonusPoints.walletPass, 0, 5000),
        favoriteStore: geheel(lb.favoriteStore, nu.bonusPoints.favoriteStore, 0, 5000),
        profileComplete: geheel(lb.profileComplete, nu.bonusPoints.profileComplete, 0, 5000),
      },
    };
  }
  return out;
}

/** Alleen veilige link-schemes toestaan (stored-XSS-preventie op de publieke
 *  homepage; hero-CTA en announcement worden als <a href>/<Link> gerenderd).
 *  Zelfde whitelist als /api/studio/site/menu — die divergentie was de bug. */
const safeHref = (v: unknown, n: number) => {
  const h = String(v ?? "").trim().slice(0, n);
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h) ? h : "#";
};

/** Homepage-content: announcement, hero, usps, deliveryCutoffHour. */
function sanitizeContent(input: unknown): SiteSettingsPatch {
  const b = (input || {}) as Record<string, unknown>;
  const out: SiteSettingsPatch = {};
  if (b.announcement && typeof b.announcement === "object") {
    const a = b.announcement as Record<string, unknown>;
    out.announcement = {
      text: String(a.text || "").slice(0, 240),
      linkLabel: a.linkLabel ? String(a.linkLabel).slice(0, 60) : undefined,
      linkHref: a.linkHref ? safeHref(a.linkHref, 200) : undefined,
    };
  }
  if (b.hero && typeof b.hero === "object") {
    const h = b.hero as Record<string, unknown>;
    out.hero = {
      eyebrow: String(h.eyebrow || "").slice(0, 60),
      title: String(h.title || "").slice(0, 120),
      subtitle: h.subtitle ? String(h.subtitle).slice(0, 280) : undefined,
      videoUrl: h.videoUrl ? String(h.videoUrl).slice(0, 400) : undefined,
      videoUrlMobile: h.videoUrlMobile ? String(h.videoUrlMobile).slice(0, 400) : undefined,
      posterUrl: String(h.posterUrl || "").slice(0, 400),
      primary: {
        label: String((h.primary as Record<string, unknown>)?.label || "").slice(0, 40),
        href: safeHref((h.primary as Record<string, unknown>)?.href, 200),
      },
      secondary: (h.secondary as Record<string, unknown>)?.label
        ? {
            label: String((h.secondary as Record<string, unknown>).label).slice(0, 40),
            href: safeHref((h.secondary as Record<string, unknown>).href, 200),
          }
        : undefined,
    };
  }
  if (Array.isArray(b.usps)) {
    out.usps = b.usps.map((x) => String(x).slice(0, 80)).filter(Boolean).slice(0, 8);
  }
  if (b.deliveryCutoffHour !== undefined && Number.isFinite(Number(b.deliveryCutoffHour))) {
    out.deliveryCutoffHour = Math.max(0, Math.min(23, Math.round(Number(b.deliveryCutoffHour))));
  }
  return out;
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const [operational, content] = await Promise.all([getSettings(), getSiteSettings()]);
    return NextResponse.json({ ok: true, operational, content });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { operational?: unknown; content?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  try {
    const opPatch = sanitizeOperational(body.operational, await getSettings());
    const contentPatch = sanitizeContent(body.content);
    if (Object.keys(opPatch).length) await updateSettings(opPatch);
    if (Object.keys(contentPatch).length) await updateSiteSettings(contentPatch);
    const [operational, content] = await Promise.all([getSettings(), getSiteSettings()]);
    return NextResponse.json({ ok: true, operational, content });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
