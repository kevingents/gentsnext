/**
 * Google Wallet — configuratie en het ondertekenen van tokens.
 *
 * Bewust een LICHTE module, los van lib/google-wallet: dit bestand kent geen
 * netwerk en geen pas-opbouw, zodat een aanroeper die alleen wil weten óf de
 * feature aanstaat (de accountpagina, de mailfooter) niet de hele rail meesleept.
 * Zelfde splitsing als apple-wallet-config vs apple-wallet.
 *
 * Env-vars (Vercel; secrets, dus niet in de tool-config):
 *   GOOGLE_WALLET_ISSUER_ID       het issuer-nummer uit de Google Pay & Wallet Console
 *   GOOGLE_WALLET_SA_EMAIL        service-account-adres (…@….iam.gserviceaccount.com)
 *   GOOGLE_WALLET_SA_PRIVATE_KEY  de private key van die service account (PEM of base64)
 *   GOOGLE_WALLET_CLASS_SUFFIX    (optioneel) klasse-achtervoegsel, default "gents-spaarpas"
 *
 * De service account moet in de Wallet Console toegang hebben tot de issuer,
 * anders geeft Google pas bij het opslaan een fout — niet bij het ondertekenen.
 */
import { createSign } from "node:crypto";

export function issuerId(): string {
  return (process.env.GOOGLE_WALLET_ISSUER_ID || "").trim();
}

export function serviceAccountEmail(): string {
  return (process.env.GOOGLE_WALLET_SA_EMAIL || "").trim();
}

/** PEM uit de env: plakt iemand 'm base64, dan decoderen we; `\n` mag letterlijk. */
export function privateKeyPem(): string {
  const raw = (process.env.GOOGLE_WALLET_SA_PRIVATE_KEY || "").trim();
  if (!raw) return "";
  const pem = raw.includes("-----BEGIN") ? raw : Buffer.from(raw, "base64").toString("utf8");
  // JSON-sleutels uit Google bevatten \n als twee tekens; PEM wil echte regeleindes.
  return pem.replace(/\\n/g, "\n");
}

export function classSuffix(): string {
  /* Blijft "gents-spaarpas", ook nu het programma The Club of GENTS heet: dit
     achtervoegsel zit in de klasse-ID van elke bestaande kaart. Wie 'm omzet
     knipt alle uitgegeven passen van hun klasse los. De weergavenaam
     (programName, lib/google-wallet) is wél mee veranderd. */
  return (process.env.GOOGLE_WALLET_CLASS_SUFFIX || "gents-spaarpas").trim();
}

/** Volledige class-id zoals Google 'm verwacht: <issuer>.<suffix>. */
export function loyaltyClassId(): string {
  return `${issuerId()}.${classSuffix()}`;
}

/** Object-id per klant. Stabiel, zodat opnieuw toevoegen dezelfde kaart bijwerkt. */
export function loyaltyObjectId(customerId: string): string {
  // Google staat alleen [a-zA-Z0-9._-] toe in het achtervoegsel; een uuid met
  // streepjes mag, maar we halen ze eruit zodat het id ook leesbaar kort blijft.
  const veilig = String(customerId || "").replace(/[^a-zA-Z0-9]/g, "");
  return `${issuerId()}.${veilig}`;
}

export function googleWalletConfigured(): boolean {
  return Boolean(issuerId() && serviceAccountEmail() && privateKeyPem());
}

/** Base64url zonder padding — het formaat dat JWT voorschrijft. */
function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * RS256-JWT met de service-account-sleutel. Google accepteert niets anders voor
 * de save-link, en met node:crypto hebben we er geen dependency voor nodig.
 */
export function signJwt(payload: Record<string, unknown>): string {
  const key = privateKeyPem();
  if (!key) throw new Error("Google Wallet is niet geconfigureerd.");
  const header = { alg: "RS256", typ: "JWT" };
  const body = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(body);
  signer.end();
  return `${body}.${b64url(signer.sign(key))}`;
}
