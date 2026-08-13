import { CLUB_NAME } from "@/lib/club";
import { getSiteUrl } from "@/lib/site-url";
import {
  googleWalletConfigured,
  issuerId,
  loyaltyClassId,
  loyaltyObjectId,
  serviceAccountEmail,
  signJwt,
} from "@/lib/google-wallet-config";

// Her-export zodat aanroepers één import hebben, net als bij Apple.
export { googleWalletConfigured } from "@/lib/google-wallet-config";

/**
 * Google Wallet — de GENTS Clubpas voor Android.
 *
 * De Android-tegenhanger van lib/apple-wallet, maar technisch een heel ander
 * beest: bij Apple bouwen én ondertekenen we een .pkpass-bestand, bij Google
 * beschrijven we de kaart als JSON en ondertekenen we een JWT. De klant klikt op
 * pay.google.com/gp/v/save/<jwt> en Google maakt de kaart aan.
 *
 * Twee gevolgen die het ontwerp bepalen:
 *
 *  1. TOEVOEGEN kost geen netwerkverkeer. Het object staat inline in de JWT, dus
 *     de knop werkt zonder dat wij eerst iets bij Google aanmaken. Scheelt een
 *     faalpad op het pad waar de klant staat te wachten.
 *
 *  2. BIJWERKEN gaat wél via de REST-API en heeft een OAuth-token nodig. Dat
 *     loopt via pushGoogleWalletUpdate, best-effort en met een korte timeout —
 *     precies zoals de APNs-push bij Apple een saldomutatie nooit mag ophouden.
 *
 * De QR bevat hetzelfde klant-id als de Apple-pas, zodat de kassa-scan voor
 * allebei werkt en er maar één lookup nodig is.
 */

const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";
const OAUTH_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";
const TIMEOUT_MS = 6000;

export type GoogleLoyaltyInput = {
  customerId: string;
  name: string;
  email: string;
  /** Besteedbaar (gevest) saldo — het getal dat aan de kassa telt. */
  points: number;
  /** Nog niet besteedbaar (recente aankoop). */
  pending?: number;
  /** Openstaande tegoedbonnen, zelfde vorm als op de Apple-pas. */
  vouchers?: { code: string; label: string; valueCents?: number }[];
};

/** "GENTS 1A2B3C4D" — dezelfde leesbare code als op de Apple-pas. */
function memberCode(customerId: string): string {
  return "GENTS " + customerId.replace(/-/g, "").slice(0, 8).toUpperCase();
}

/**
 * De kaart zelf. `loyaltyPoints` is het veld dat Google groot toont; de rest
 * komt eronder te staan. Wat er niet is, laten we weg — een leeg veld toont
 * Google als een lege regel.
 */
function loyaltyObject(input: GoogleLoyaltyInput) {
  const points = Math.max(0, Math.round(Number(input.points) || 0));
  const pending = Math.max(0, Math.round(Number(input.pending) || 0));
  const tegoeden = (input.vouchers ?? []).filter((v) => v.code);

  const extra: { header: string; body: string; id: string }[] = [];
  // Zelfde reden als op de Apple-pas: zonder dit leest de kaart als "0 punten"
  // terwijl de klant net gekocht heeft en z'n punten nog moeten vesten.
  if (pending > 0) {
    extra.push({ id: "in-behandeling", header: "In behandeling", body: `${pending} punten` });
  }
  if (tegoeden.length) {
    extra.push({
      id: "tegoed",
      header: tegoeden.length === 1 ? "Je tegoedbon" : "Je tegoedbonnen",
      body: tegoeden.map((v) => `${v.code} — ${v.label}`).join("\n"),
    });
  }

  return {
    id: loyaltyObjectId(input.customerId),
    classId: loyaltyClassId(),
    state: "ACTIVE",
    accountId: input.customerId,
    accountName: input.name,
    loyaltyPoints: {
      label: "Clubpunten",
      balance: { int: points },
    },
    barcode: {
      type: "QR_CODE",
      // Kaal klant-id: identiek aan de Apple-pas, zodat de kassa één scan-tak heeft.
      value: input.customerId,
      alternateText: memberCode(input.customerId),
    },
    ...(extra.length ? { textModulesData: extra } : {}),
    linksModuleData: {
      uris: [{ uri: `${getSiteUrl()}/account`, description: "Bekijk je punten op gents.nl", id: "account" }],
    },
  };
}

/**
 * De klasse waar elke kaart onder hangt: huisstijl en vaste teksten. Google wil
 * 'm één keer aangemaakt hebben; we sturen 'm mee in de JWT zodat er geen aparte
 * beheerstap nodig is en de eerste klant 'm meteen goed krijgt.
 */
function loyaltyClass() {
  return {
    id: loyaltyClassId(),
    issuerName: "GENTS",
    /* Alleen de weergavenaam. De klasse-ID (loyaltyClassId) blijft onaangeraakt —
       die veranderen zou elke bestaande pas van z'n klasse losknippen. Let op:
       Google leest de klasse uit de JWT alléén bij het AANMAKEN; bestaande
       klassen houden hun oude programName tot ze via de API gepatcht worden. */
    programName: CLUB_NAME,
    reviewStatus: "UNDER_REVIEW",
    hexBackgroundColor: "#111111",
    programLogo: {
      sourceUri: { uri: `${getSiteUrl()}/brand/brand-logo-wit.png` },
      contentDescription: { defaultValue: { language: "nl", value: "GENTS" } },
    },
  };
}

/**
 * Link voor de "Toevoegen aan Google Wallet"-knop. Puur lokaal ondertekend —
 * geen netwerk, dus geen faalpad terwijl de klant staat te kijken.
 */
export function googleWalletSaveUrl(input: GoogleLoyaltyInput): string {
  if (!googleWalletConfigured()) throw new Error("Google Wallet is niet geconfigureerd.");
  const jwt = signJwt({
    iss: serviceAccountEmail(),
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [getSiteUrl()],
    payload: {
      loyaltyClasses: [loyaltyClass()],
      loyaltyObjects: [loyaltyObject(input)],
    },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

/** OAuth-token voor de REST-API (alleen nodig bij bijwerken). */
async function accessToken(): Promise<string> {
  const nu = Math.floor(Date.now() / 1000);
  const assertion = signJwt({
    iss: serviceAccountEmail(),
    scope: SCOPE,
    aud: OAUTH_URL,
    iat: nu,
    exp: nu + 3600,
  });
  const res = await fetch(OAUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const data = (await res.json()) as { access_token?: string };
  if (!data.access_token) throw new Error("Geen access_token van Google.");
  return data.access_token;
}

/**
 * Kaart bijwerken na een saldowijziging. Werpt nooit: net als de APNs-push mag
 * dit een sparen/inwisselen nooit laten hangen of falen. Bestaat de kaart nog
 * niet (klant heeft 'm niet toegevoegd), dan geeft Google 404 en doen we niets —
 * dat is geen fout, dat is een klant zonder Android-kaart.
 */
export async function pushGoogleWalletUpdate(input: GoogleLoyaltyInput): Promise<boolean> {
  if (!googleWalletConfigured() || !input.customerId) return false;
  try {
    const token = await accessToken();
    const obj = loyaltyObject(input);
    const res = await fetch(`${WALLET_API}/loyaltyObject/${encodeURIComponent(obj.id)}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ loyaltyPoints: obj.loyaltyPoints, textModulesData: obj.textModulesData ?? [] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 404) return false; // klant heeft de kaart niet toegevoegd
    if (!res.ok) {
      console.warn(`[google-wallet] bijwerken faalde (${res.status}) voor ${obj.id}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[google-wallet] bijwerken faalde:", (e as Error).message);
    return false;
  }
}
