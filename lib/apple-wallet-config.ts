import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Lichte config-/auth-helpers voor de Apple-Wallet spaarpas — BEWUST zonder de
 * zware `passkit-generator`/`node:fs`-import (die zit in lib/apple-wallet.ts).
 * Zo sleept een module die alleen `walletConfigured()` of de auth nodig heeft
 * (loyalty-claim, push, de web-service-routes) passkit-generator niet mee in
 * z'n bundle.
 */

export function b64Pem(key: string): string {
  const v = process.env[key] || "";
  if (!v) return "";
  return v.includes("-----BEGIN") ? v : Buffer.from(v, "base64").toString("utf8");
}

/** Is de Apple-Wallet-ondertekening geconfigureerd (alle sign-secrets aanwezig)? */
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
 * Secret voor het per-pas authenticatietoken. BIJ VOORKEUR een apart, STABIEL
 * `WALLET_AUTH_SECRET` — los van de signer-key, die jaarlijks met het
 * certificaat roteert (anders vervallen alle uitgegeven pas-tokens stil bij
 * cert-vernieuwing). Valt terug op de signer-key zodat de feature ook zonder
 * die extra env-var werkt; "" als er niets is → auth faalt fail-closed.
 */
function walletAuthSecret(): string {
  return process.env.WALLET_AUTH_SECRET || b64Pem("APPLE_WALLET_SIGNER_KEY") || "";
}

/**
 * Per-pas authenticatietoken (PassKit `Authorization: ApplePass <token>`).
 * HMAC(secret, customerId). Leeg als er geen secret is → verifyPassAuth faalt
 * dan altijd (geen raadbare fallback-constante meer).
 */
export function passAuthToken(customerId: string): string {
  const secret = walletAuthSecret();
  if (!secret) return "";
  return createHmac("sha256", secret).update(String(customerId)).digest("hex");
}

/** Constant-tijd-verificatie van een aangeboden pas-token. Fail-closed. */
export function verifyPassAuth(customerId: string, token: string): boolean {
  const expected = passAuthToken(customerId);
  const got = String(token || "");
  if (!expected || got.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}
