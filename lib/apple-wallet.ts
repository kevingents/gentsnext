import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PKPass } from "passkit-generator";

/**
 * Apple Wallet — GENTS spaarpas (.pkpass, storeCard).
 *
 * Een geldige pas moet ondertekend worden met een Apple **Pass Type ID-certificaat**
 * uit het GENTS Apple Developer-account. Die secrets staan in Vercel-env (base64),
 * NIET in de code. Zonder certificaat is `walletConfigured()` false en biedt de site
 * de wallet-knop niet aan — de feature schakelt vanzelf aan zodra de env gezet is.
 *
 * Benodigde env-vars (base64-PEM tenzij anders vermeld):
 *   APPLE_PASS_TYPE_ID              bv. pass.nl.gents.loyalty
 *   APPLE_TEAM_ID                   je Apple Team ID (10 tekens)
 *   APPLE_WALLET_SIGNER_CERT        base64 van de pass-cert (PEM)
 *   APPLE_WALLET_SIGNER_KEY         base64 van de private key (PEM)
 *   APPLE_WALLET_SIGNER_KEY_PASSPHRASE   (optioneel) wachtwoord van de key
 *   APPLE_WALLET_WWDR              base64 van het Apple WWDR-tussencertificaat (PEM)
 */

function b64Pem(key: string): string {
  const v = process.env[key] || "";
  if (!v) return "";
  // Zowel kant-en-klare PEM als base64-PEM ondersteunen (handig lokaal vs Vercel).
  return v.includes("-----BEGIN") ? v : Buffer.from(v, "base64").toString("utf8");
}

/** Is de Apple-Wallet-ondertekening geconfigureerd (alle secrets aanwezig)? */
export function walletConfigured(): boolean {
  return Boolean(
    process.env.APPLE_PASS_TYPE_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_WALLET_SIGNER_CERT &&
      process.env.APPLE_WALLET_SIGNER_KEY &&
      process.env.APPLE_WALLET_WWDR,
  );
}

/** Publieke basis-URL van de site (voor de PassKit web-service-URL in de pas). */
function siteBaseUrl(): string {
  const raw =
    process.env.PUBLIC_SITE_URL ||
    process.env.SITE_URL ||
    process.env.GENTSNEXT_BASE_URL ||
    "https://www.gents.nl";
  return raw.replace(/\/+$/, "");
}

/** PassKit web-service-basis; Apple hangt hier zelf /v1/… achter. */
export function walletWebServiceUrl(): string {
  return `${siteBaseUrl()}/api/wallet/apple`;
}

/**
 * Per-pas authenticatietoken (PassKit `Authorization: ApplePass <token>`).
 * Afgeleid via HMAC(signerKey, customerId): stabiel per klant, geen extra
 * secret/tabel nodig, en niet te vervalsen zonder de private key. De signerKey
 * is altijd aanwezig zodra `walletConfigured()`.
 */
export function passAuthToken(customerId: string): string {
  const secret = b64Pem("APPLE_WALLET_SIGNER_KEY") || "unconfigured";
  return createHmac("sha256", secret).update(String(customerId)).digest("hex");
}

/** Constant-tijd-verificatie van een aangeboden pas-token. */
export function verifyPassAuth(customerId: string, token: string): boolean {
  const expected = passAuthToken(customerId);
  const got = String(token || "");
  if (got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

// Merk-afbeeldingen (uit public/brand) worden bij de route meegebundeld via
// next.config `outputFileTracingIncludes`. Eén keer inlezen + cachen.
let imgCache: { icon: Buffer; logo: Buffer } | null = null;
function passImages() {
  if (imgCache) return imgCache;
  const root = process.cwd();
  imgCache = {
    icon: readFileSync(join(root, "public/brand/brand-logo-vierkant.png")),
    logo: readFileSync(join(root, "public/brand/brand-logo-zwart.png")),
  };
  return imgCache;
}

export type LoyaltyPassInput = {
  customerId: string;
  name: string;
  email: string;
  points: number;
  memberSince?: Date | string | null;
};

/**
 * Bouwt een ondertekende GENTS-spaarpas (.pkpass) voor één klant. Premium look:
 * warme canvas-achtergrond, zwart logo, QR met de klant-referentie (scanbaar aan de
 * kassa om te sparen/inwisselen). serialNumber = customerId → opnieuw downloaden
 * werkt de bestaande pas bij i.p.v. een tweede pas te maken.
 */
export function buildLoyaltyPass(input: LoyaltyPassInput): Buffer {
  if (!walletConfigured()) throw new Error("Apple Wallet is niet geconfigureerd.");
  const { icon, logo } = passImages();
  const points = Math.max(0, Math.round(Number(input.points) || 0));
  const memberCode = "GENTS " + input.customerId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const sinceYear = input.memberSince ? new Date(input.memberSince).getFullYear() : null;

  const pass = new PKPass(
    {
      "icon.png": icon,
      "icon@2x.png": icon,
      "icon@3x.png": icon,
      "logo.png": logo,
      "logo@2x.png": logo,
    },
    {
      wwdr: b64Pem("APPLE_WALLET_WWDR"),
      signerCert: b64Pem("APPLE_WALLET_SIGNER_CERT"),
      signerKey: b64Pem("APPLE_WALLET_SIGNER_KEY"),
      signerKeyPassphrase: process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE || undefined,
    },
    {
      passTypeIdentifier: process.env.APPLE_PASS_TYPE_ID!,
      teamIdentifier: process.env.APPLE_TEAM_ID!,
      serialNumber: input.customerId,
      organizationName: "GENTS",
      description: "GENTS Spaarpas",
      backgroundColor: "rgb(244, 242, 237)",
      foregroundColor: "rgb(17, 17, 17)",
      labelColor: "rgb(122, 118, 112)",
      // Web-service: hiermee kan iOS de pas zelf verversen (pull + APNs-push
      // bij een saldowijziging). Beide velden zijn verplicht om 'm te activeren.
      webServiceURL: walletWebServiceUrl(),
      authenticationToken: passAuthToken(input.customerId),
    },
  );

  pass.type = "storeCard";
  pass.primaryFields.push({ key: "balance", label: "Spaarpunten", value: String(points) });
  pass.secondaryFields.push({ key: "member", label: "Lid", value: input.name });
  if (sinceYear) pass.auxiliaryFields.push({ key: "since", label: "Lid sinds", value: String(sinceYear) });
  pass.backFields.push(
    {
      key: "how",
      label: "Zo werkt het",
      value:
        "Je spaart 1 punt per bestede euro — online én in de winkel. Laat deze pas scannen bij de kassa om te sparen en punten in te wisselen.",
    },
    { key: "value", label: "Je saldo", value: `${points} punten` },
    { key: "account", label: "Account", value: "Bekijk en verzilver je punten op gents.nl/account." },
    {
      key: "terms",
      label: "Voorwaarden",
      value: "Punten zijn persoonlijk en niet inwisselbaar voor contant geld. Zie gents.nl voor de actievoorwaarden.",
    },
  );
  pass.setBarcodes({
    format: "PKBarcodeFormatQR",
    message: input.customerId,
    messageEncoding: "iso-8859-1",
    altText: memberCode,
  });

  return pass.getAsBuffer();
}
