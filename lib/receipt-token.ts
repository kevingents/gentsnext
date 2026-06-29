/**
 * lib/receipt-token.ts
 *
 * Spiegelt het bon-token van storegents (lib/receipt-link.js) zodat gents.nl een
 * kassabon-link kan verifiëren zonder een call naar storegents. Token = afgekapte
 * HMAC van de sale-id met een gedeeld server-secret. Stateless.
 *
 * LET OP: RECEIPT_LINK_SECRET moet in gentsnext dezelfde waarde hebben als in
 * storegents, anders verifieert het token niet. Zonder env vallen beide terug op
 * dezelfde pilot-default, dus in de pilot werkt het out-of-the-box.
 */
import crypto from "crypto";

function secret(): string {
  return (
    process.env.RECEIPT_LINK_SECRET ||
    process.env.CONFIRM_TOKEN_SECRET ||
    process.env.PERSONNEL_SESSION_SECRET ||
    "gents-receipt-pilot"
  );
}

/**
 * Is er een ECHT (eigen) bon-secret gezet? Zo niet, dan valt het token terug op de
 * publieke pilot-default en is het te vervalsen — dan mogen we GEEN punten op basis
 * van zo'n token bijschrijven (fail closed). Het tonen van een bon blijft wel werken.
 */
export function receiptSecretConfigured(): boolean {
  return !!(
    process.env.RECEIPT_LINK_SECRET ||
    process.env.CONFIRM_TOKEN_SECRET ||
    process.env.PERSONNEL_SESSION_SECRET
  );
}

/** Token voor een bon (24 tekens base64url van de HMAC). */
export function receiptToken(saleId: string): string {
  return crypto
    .createHmac("sha256", secret())
    .update(`receipt:${String(saleId || "")}`)
    .digest("base64url")
    .slice(0, 24);
}

/** Constant-time vergelijking van het meegegeven token. */
export function verifyReceiptToken(saleId: string, token: string): boolean {
  const expected = receiptToken(saleId);
  const a = Buffer.from(String(token || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
