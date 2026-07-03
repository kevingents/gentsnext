/**
 * Dunne Mollie-client (Payments API v2 — de Orders API is door Mollie
 * afgeraden). Env-gated: zonder MOLLIE_API_KEY is checkout "niet geconfigureerd"
 * en draait de rest van de site gewoon door.
 *
 * Patroon (uit het onderzoek): Idempotency-Key op elke POST; de webhook is de
 * bron van waarheid (id-only POST → betaling met de API-key ophalen). Bedragen
 * als string met exact 2 decimalen.
 */

const API = "https://api.mollie.com/v2";

export function mollieConfigured(): boolean {
  return Boolean(process.env.MOLLIE_API_KEY);
}

function apiKey(): string {
  const key = process.env.MOLLIE_API_KEY;
  if (!key) throw new Error("MOLLIE_API_KEY ontbreekt — checkout is niet geconfigureerd.");
  return key;
}

/**
 * Organisatie-/OAuth-token (access_…) i.p.v. een gewone API-key (test_/live_).
 * Dan moet je profileId + testmode expliciet meesturen.
 */
function usesAccessToken(): boolean {
  return (process.env.MOLLIE_API_KEY || "").startsWith("access_");
}
function testmode(): boolean {
  // Access-token: standaard testmode tenzij expliciet uitgezet. API-key bepaalt
  // de modus zelf (test_/live_).
  if (!usesAccessToken()) return false;
  return process.env.MOLLIE_TESTMODE !== "false";
}

export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Volledige of gedeeltelijke terugbetaling van een Mollie-betaling (retour → geld terug). */
export async function refundMolliePayment(
  paymentId: string,
  amountCents: number,
  description = "Retour",
  idempotencyKey?: string,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!mollieConfigured()) return { ok: false, error: "Mollie niet geconfigureerd." };
  if (!paymentId || amountCents <= 0) return { ok: false, error: "Ongeldig refund-bedrag." };
  const body: Record<string, unknown> = {
    amount: { currency: "EUR", value: centsToValue(amountCents) },
    description: description.slice(0, 140),
  };
  if (usesAccessToken() && testmode()) body.testmode = true;
  // Idempotency-Key: een dubbele/parallelle refund-poging met dezelfde sleutel
  // levert Mollie-zijdig dezelfde refund op i.p.v. een tweede terugstorting.
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey()}`, "content-type": "application/json" };
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey.slice(0, 40);
  try {
    const r = await fetch(`https://api.mollie.com/v2/payments/${encodeURIComponent(paymentId)}/refunds`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const d = (await r.json().catch(() => null)) as { id?: string; detail?: string } | null;
    if (!r.ok || !d?.id) return { ok: false, error: d?.detail || `Mollie ${r.status}` };
    return { ok: true, id: d.id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type MolliePayment = {
  id: string;
  status: string; // open|pending|authorized|paid|canceled|expired|failed
  amount: { currency: string; value: string };
  metadata?: Record<string, unknown> | null;
  checkoutUrl: string | null;
};

function parsePayment(json: any): MolliePayment {
  return {
    id: json.id,
    status: json.status,
    amount: json.amount,
    metadata: json.metadata ?? null,
    checkoutUrl: json?._links?.checkout?.href ?? null,
  };
}

export async function createMolliePayment(input: {
  amountCents: number;
  description: string;
  redirectUrl: string;
  cancelUrl?: string;
  webhookUrl: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
  method?: string; // weglaten → Mollie's gehoste methode-selectie (incl. iDEAL)
}): Promise<MolliePayment> {
  const body: Record<string, unknown> = {
    amount: { currency: "EUR", value: centsToValue(input.amountCents) },
    description: input.description,
    redirectUrl: input.redirectUrl,
    cancelUrl: input.cancelUrl,
    webhookUrl: input.webhookUrl,
    metadata: input.metadata,
  };
  if (input.method) body.method = input.method;
  // Access-token vereist een profileId + expliciete testmode.
  if (usesAccessToken()) {
    if (process.env.MOLLIE_PROFILE_ID) body.profileId = process.env.MOLLIE_PROFILE_ID;
    body.testmode = testmode();
  }

  const res = await fetch(`${API}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Mollie createPayment ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return parsePayment(await res.json());
}

export type MollieMethod = { id: string; description: string; image: string };

// Bekende Mollie-method-id's — we geven alleen een gevalideerde method door.
const KNOWN_METHODS = new Set([
  "ideal", "creditcard", "paypal", "bancontact", "banktransfer", "kbc", "belfius",
  "eps", "przelewy24", "applepay", "giftcard", "in3", "klarna", "billie",
  "klarnapaylater", "klarnasliceit", "paysafecard", "sofort", "trustly",
]);
export function isKnownMethod(m: string | undefined | null): boolean {
  return Boolean(m) && KNOWN_METHODS.has(String(m));
}

/**
 * Actieve betaalmethodes van het Mollie-profiel (voor de eigen methodekeuze op de
 * afrekenpagina, zodat de klant niet eerst Mollie's keuzescherm ziet). Bedrag-
 * bewust zodat alleen geldige methodes terugkomen. Faalt zacht → lege lijst
 * (dan valt checkout terug op Mollie's gehoste keuze).
 */
export async function getMollieMethods(amountCents?: number): Promise<MollieMethod[]> {
  if (!mollieConfigured()) return [];
  const qs = new URLSearchParams();
  if (amountCents && amountCents > 0) {
    qs.set("amount[value]", centsToValue(amountCents));
    qs.set("amount[currency]", "EUR");
  }
  if (usesAccessToken()) {
    if (process.env.MOLLIE_PROFILE_ID) qs.set("profileId", process.env.MOLLIE_PROFILE_ID);
    qs.set("testmode", String(testmode()));
  }
  try {
    const res = await fetch(`${API}/methods${qs.toString() ? `?${qs}` : ""}`, {
      headers: { Authorization: `Bearer ${apiKey()}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const methods = json?._embedded?.methods ?? [];
    return methods
      .map((m: any) => ({ id: String(m.id), description: String(m.description || m.id), image: m?.image?.svg || m?.image?.size2x || "" }))
      .filter((m: MollieMethod) => isKnownMethod(m.id));
  } catch {
    return [];
  }
}

export async function getMolliePayment(id: string): Promise<MolliePayment> {
  const qs = usesAccessToken() ? `?testmode=${testmode()}` : "";
  const res = await fetch(`${API}/payments/${encodeURIComponent(id)}${qs}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`Mollie getPayment ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return parsePayment(await res.json());
}
