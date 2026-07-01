import crypto from "crypto";

/**
 * Dunne Worldline Direct-client (Hosted Checkout) — het redirect-alternatief voor
 * Mollie ([[lib/mollie.ts]]). Server-2-server met de "GCS v1HMAC"-authenticatie
 * (API key-ID + secret). Env-gated: zonder de credentials is Worldline "niet
 * geconfigureerd" en draait de rest van de site door.
 *
 * Secrets staan in Vercel (NOOIT in code/commit):
 *   WORLDLINE_MERCHANT_ID    = PSPID, bv. "GentsProd"
 *   WORLDLINE_API_KEY_ID     = de Payment API key-ID
 *   WORLDLINE_API_SECRET     = de Payment API secret (eenmalig getoond)
 *   WORLDLINE_WEBHOOK_KEY_ID + WORLDLINE_WEBHOOK_SECRET = webhook-verificatie
 *   WORLDLINE_ENV            = "prod" (default) | "preprod"
 *
 * Auth geverifieerd tegen docs.direct.worldline-solutions.com:
 *   stringToSign = METHOD\n + Content-Type\n + Date(RFC1123)\n + <x-gcs-headers> + resource\n
 *   (elk item incl. het laatste eindigt op \n; GET → lege Content-Type; wij sturen
 *    geen x-gcs-headers, dus dat segment is leeg)
 *   Authorization: "GCS v1HMAC:" + keyId + ":" + base64(HMAC_SHA256(secret, stringToSign))
 */

function env(k: string): string {
  return process.env[k] || "";
}
function merchantId(): string {
  return env("WORLDLINE_MERCHANT_ID");
}

export function worldlineConfigured(): boolean {
  return Boolean(merchantId() && env("WORLDLINE_API_KEY_ID") && env("WORLDLINE_API_SECRET"));
}

function apiBase(): string {
  return env("WORLDLINE_ENV").toLowerCase() === "preprod"
    ? "https://payment.preprod.direct.worldline-solutions.com"
    : "https://payment.direct.worldline-solutions.com";
}

/** GCS v1HMAC-handtekening over (methode, content-type, date, resource-pad). */
function authorization(method: string, contentType: string, date: string, resourcePath: string): string {
  const stringToSign = `${method}\n${contentType}\n${date}\n${resourcePath}\n`;
  const signature = crypto.createHmac("sha256", env("WORLDLINE_API_SECRET")).update(stringToSign, "utf8").digest("base64");
  return `GCS v1HMAC:${env("WORLDLINE_API_KEY_ID")}:${signature}`;
}

async function call(method: "GET" | "POST", resourcePath: string, body?: unknown): Promise<any> {
  const date = new Date().toUTCString(); // RFC1123 GMT — moet exact matchen met de Date-header
  const contentType = body !== undefined ? "application/json" : "";
  const headers: Record<string, string> = {
    Date: date,
    Authorization: authorization(method, contentType, date, resourcePath),
  };
  if (contentType) headers["Content-Type"] = contentType;
  const res = await fetch(`${apiBase()}${resourcePath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Worldline ${method} ${resourcePath} → ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : {};
}

export type WorldlineCheckout = { hostedCheckoutId: string; redirectUrl: string; returnmac: string };

/** Start een Hosted Checkout → geeft de redirect-URL naar Worldline's betaalpagina. */
export async function createWorldlineCheckout(input: {
  amountCents: number;
  merchantReference: string; // = orderNumber (voor terugkoppeling via de webhook)
  returnUrl: string;
}): Promise<WorldlineCheckout> {
  const path = `/v2/${encodeURIComponent(merchantId())}/hostedcheckouts`;
  const body = {
    order: {
      amountOfMoney: { amount: Math.round(input.amountCents), currencyCode: "EUR" },
      references: { merchantReference: input.merchantReference.slice(0, 30) },
    },
    hostedCheckoutSpecificInput: {
      returnUrl: input.returnUrl,
      showResultPage: false, // meteen terug naar returnUrl, geen Worldline-resultaatpagina
    },
  };
  const r = await call("POST", path, body);
  const redirectUrl = String(r?.redirectUrl || (r?.partialRedirectUrl ? `https://${r.partialRedirectUrl}` : ""));
  if (!r?.hostedCheckoutId || !redirectUrl) {
    throw new Error("Worldline: onvolledige hostedcheckout-respons.");
  }
  return { hostedCheckoutId: String(r.hostedCheckoutId), redirectUrl, returnmac: String(r?.RETURNMAC || "") };
}

export type CanonicalStatus = "paid" | "pending" | "canceled" | "expired" | "failed" | "open";
export type WorldlineStatus = { canonical: CanonicalStatus; raw: string; paymentId: string | null };

/** Worldline betaal-/checkoutstatus → canoniek (zelfde vocabulaire als Mollie, voor applyPaymentStatus). */
function mapStatus(paymentStatus: string, category: string, hcStatus: string): CanonicalStatus {
  const s = String(paymentStatus || "").toUpperCase();
  const c = String(category || "").toUpperCase();
  const hc = String(hcStatus || "").toUpperCase();
  // 1. Geslaagde betaling.
  if (["CAPTURED", "PAID", "CAPTURE_REQUESTED"].includes(s) || c === "SUCCESSFUL") return "paid";
  // 2. Post-betaling-terugboeking (reversal/chargeback/refund) → NOOIT clobberen naar een
  //    niet-betaald-status (zou de voorraad-hold vrijgeven + de cadeaubon terugstorten van
  //    een reeds betaalde order). 'pending' laat de order-status ongemoeid.
  if (["REVERSED", "CHARGEBACKED", "CHARGEBACK_NOTIFICATION"].includes(s) || c === "REFUNDED") return "pending";
  // 3. Initiële afwijzing → nooit betaald → hold mag vrij.
  if (["REJECTED", "REJECTED_CAPTURE"].includes(s) || c === "REJECTED" || c === "UNSUCCESSFUL") return "failed";
  // 4. Geannuleerd (door klant of checkout).
  if (s === "CANCELLED" || hc === "CANCELLED_BY_CONSUMER" || hc === "CANCELLED") return "canceled";
  // 5. Verlopen hosted checkout (verlaten) → hold + cadeaubon vrijgeven.
  if (hc === "EXPIRED") return "expired";
  // 6. Nog geen betaling en checkout loopt nog → open (geen state-wijziging).
  if (!s) return "open";
  // 7. Onderweg (pending/redirected/…).
  return "pending";
}

/** Haal de status van een Hosted Checkout op (bron van waarheid, net als Mollie's getPayment). */
export async function getWorldlineCheckoutStatus(hostedCheckoutId: string): Promise<WorldlineStatus> {
  const path = `/v2/${encodeURIComponent(merchantId())}/hostedcheckouts/${encodeURIComponent(hostedCheckoutId)}`;
  const r = await call("GET", path);
  const payment = r?.createdPaymentOutput?.payment ?? null;
  const paymentStatus = String(payment?.status || "");
  const category = String(r?.createdPaymentOutput?.paymentStatusCategory || payment?.statusOutput?.statusCategory || "");
  const hcStatus = String(r?.status || "");
  return {
    canonical: mapStatus(paymentStatus, category, hcStatus),
    raw: paymentStatus || hcStatus,
    paymentId: payment?.id ? String(payment.id) : null,
  };
}

/** Verifieer de Worldline-webhook-handtekening: X-GCS-Signature = base64(HMAC_SHA256(webhookSecret, rauwe body)). */
export function verifyWorldlineWebhook(rawBody: string, signature: string, keyId: string): boolean {
  const secret = env("WORLDLINE_WEBHOOK_SECRET");
  const expectedKeyId = env("WORLDLINE_WEBHOOK_KEY_ID");
  if (!secret || !signature) return false;
  if (expectedKeyId && keyId && keyId !== expectedKeyId) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/** Terugbetaling (retour) van een Worldline-betaling. paymentId volgt uit getWorldlineCheckoutStatus. */
export async function refundWorldlinePayment(
  paymentId: string,
  amountCents: number,
  description = "Retour",
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!worldlineConfigured()) return { ok: false, error: "Worldline niet geconfigureerd." };
  if (!paymentId || amountCents <= 0) return { ok: false, error: "Ongeldig refund-bedrag." };
  try {
    const path = `/v2/${encodeURIComponent(merchantId())}/payments/${encodeURIComponent(paymentId)}/refund`;
    const r = await call("POST", path, {
      amountOfMoney: { amount: Math.round(amountCents), currencyCode: "EUR" },
      refundReferences: { merchantReference: description.slice(0, 30) },
    });
    const id = r?.id ? String(r.id) : "";
    if (!id) return { ok: false, error: "Worldline: geen refund-id." };
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
