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

export function centsToValue(cents: number): string {
  return (cents / 100).toFixed(2);
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

export async function getMolliePayment(id: string): Promise<MolliePayment> {
  const res = await fetch(`${API}/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
  });
  if (!res.ok) {
    throw new Error(`Mollie getPayment ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return parsePayment(await res.json());
}
