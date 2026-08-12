/**
 * Dunne Mollie-client (Payments API v2 — de Orders API is door Mollie
 * afgeraden). Env-gated: zonder MOLLIE_API_KEY is checkout "niet geconfigureerd"
 * en draait de rest van de site gewoon door.
 *
 * Patroon (uit het onderzoek): Idempotency-Key op elke POST; de webhook is de
 * bron van waarheid (id-only POST → betaling met de API-key ophalen). Bedragen
 * als string met exact 2 decimalen.
 */

import { MOLLIE_METHOD_IDS } from "@/lib/payment-methods";

const API = "https://api.mollie.com/v2";

/**
 * WELKE SLEUTEL — webshop of pinterminal (Kevin, 10 aug).
 *
 * De fysieke pinterminals draaiden op dezelfde sleutel als de webshop. Dat is
 * onhandig én riskant: je kunt de terminals niet apart testen of de sleutel
 * vervangen zonder de webshop te raken, en in Mollie loopt alles door elkaar.
 *
 * MOLLIE_TERMINAL_API_KEY is nu de sleutel voor alles wat met een fysieke
 * terminal te maken heeft. Staat 'ie niet gezet, dan valt het terug op
 * MOLLIE_API_KEY — precies het gedrag van vóór deze wijziging, dus mergen
 * verandert niets.
 *
 * LET OP (de reden dat dit per aanroep expliciet is): een betaling hoort bij de
 * sleutel waarmee 'ie is aangemaakt. Een terminalbetaling opvragen of annuleren
 * met de webshop-sleutel geeft "niet gevonden" — zeker als de één test_ is en de
 * ander live_. Daarom dragen getMolliePayment/cancelMolliePayment/
 * refundMolliePayment een expliciete `terminal`-vlag; de POS-route zet 'm, de
 * webshop-webhook niet.
 */
type Sleutel = "web" | "terminal";

function keyFor(scope: Sleutel): string {
  if (scope === "terminal") return process.env.MOLLIE_TERMINAL_API_KEY || process.env.MOLLIE_API_KEY || "";
  return process.env.MOLLIE_API_KEY || "";
}

export function mollieConfigured(): boolean {
  return Boolean(process.env.MOLLIE_API_KEY);
}

/** Is er een sleutel voor de pinterminals (eigen of geërfd van de webshop)? */
export function mollieTerminalConfigured(): boolean {
  return Boolean(keyFor("terminal"));
}

/**
 * Welke sleutel gebruiken de terminals, en staat die in test- of live-modus?
 * Geeft NOOIT de sleutel zelf terug — alleen genoeg om in de portal te tonen
 * dat je met echt geld werkt. Precies de controle die je vóór een winkeltest
 * wilt kunnen doen zonder in Vercel te hoeven kijken.
 */
export function mollieTerminalKeyInfo(): { eigenSleutel: boolean; modus: "test" | "live" | "onbekend"; geconfigureerd: boolean } {
  const eigen = Boolean(process.env.MOLLIE_TERMINAL_API_KEY);
  const k = keyFor("terminal");
  const modus = k.startsWith("test_") ? "test" : k.startsWith("live_") ? "live" : "onbekend";
  return { eigenSleutel: eigen, modus, geconfigureerd: Boolean(k) };
}

function apiKey(scope: Sleutel = "web"): string {
  const key = keyFor(scope);
  if (!key) {
    throw new Error(
      scope === "terminal"
        ? "MOLLIE_TERMINAL_API_KEY (of MOLLIE_API_KEY) ontbreekt — pinnen op de terminal is niet geconfigureerd."
        : "MOLLIE_API_KEY ontbreekt — checkout is niet geconfigureerd.",
    );
  }
  return key;
}

/**
 * Organisatie-/OAuth-token (access_…) i.p.v. een gewone API-key (test_/live_).
 * Dan moet je profileId + testmode expliciet meesturen. Per sleutel bepaald: de
 * terminalsleutel kan best een ander type zijn dan die van de webshop.
 */
function usesAccessToken(scope: Sleutel = "web"): boolean {
  return keyFor(scope).startsWith("access_");
}
function testmode(scope: Sleutel = "web"): boolean {
  // Access-token: standaard testmode tenzij expliciet uitgezet. API-key bepaalt
  // de modus zelf (test_/live_).
  if (!usesAccessToken(scope)) return false;
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
  /* Een terugbetaling hoort bij de sleutel waarmee de BETALING is aangemaakt.
     Een terminalbetaling terugbetalen met de webshop-sleutel vindt 'm niet. */
  opts: { terminal?: boolean } = {},
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const scope: Sleutel = opts.terminal ? "terminal" : "web";
  if (scope === "terminal" ? !mollieTerminalConfigured() : !mollieConfigured()) {
    return { ok: false, error: "Mollie niet geconfigureerd." };
  }
  if (!paymentId || amountCents <= 0) return { ok: false, error: "Ongeldig refund-bedrag." };
  const body: Record<string, unknown> = {
    amount: { currency: "EUR", value: centsToValue(amountCents) },
    description: description.slice(0, 140),
  };
  if (usesAccessToken(scope) && testmode(scope)) body.testmode = true;
  // Idempotency-Key: een dubbele/parallelle refund-poging met dezelfde sleutel
  // levert Mollie-zijdig dezelfde refund op i.p.v. een tweede terugstorting.
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey(scope)}`, "content-type": "application/json" };
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
// De lijst zelf staat in lib/payment-methods, want de instellingen-UI moet
// dezelfde id's accepteren als wij hier doorlaten.
const KNOWN_METHODS = new Set<string>(MOLLIE_METHOD_IDS);
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

/** `terminal:true` = een betaling die op een pinterminal is aangemaakt; die moet
 *  met dezelfde sleutel opgevraagd worden, anders bestaat 'ie simpelweg niet. */
export async function getMolliePayment(id: string, opts: { terminal?: boolean } = {}): Promise<MolliePayment> {
  const scope: Sleutel = opts.terminal ? "terminal" : "web";
  const qs = usesAccessToken(scope) ? `?testmode=${testmode(scope)}` : "";
  const res = await fetch(`${API}/payments/${encodeURIComponent(id)}${qs}`, {
    headers: { Authorization: `Bearer ${apiKey(scope)}` },
  });
  if (!res.ok) {
    throw new Error(`Mollie getPayment ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return parsePayment(await res.json());
}

/**
 * Betaling op een FYSIEKE Mollie-terminal (point-of-sale). Gebruikt dezelfde
 * Payments-API als de webshop, maar met `method:"pointofsale"` + `terminalId`:
 * Mollie pusht de betaling naar het pin-apparaat en wij POLLEN de status
 * (open/pending → paid|failed|canceled|expired). Bewust GEEN redirectUrl (er is
 * geen browser-redirect aan de kassa).
 *
 * WEL een webhookUrl (nieuw). Pollen werkt prima zolang de kassa openstaat, en
 * daar zat precies het gat: viel het browsertabblad weg — of de pc — dan stopte
 * de poll en wist niemand meer dát er een betaling liep. Geld binnen, geen bon,
 * en anders dan bij Worldline geen driverlog om tegen af te vinken. De webhook
 * komt ongeacht wat de kassa doet en legt de uitkomst server-side vast.
 *
 * GELD-VEILIGHEID: de Idempotency-Key (= clientRef van de checkout-poging) zorgt
 * dat een RETRY na een netwerkfout NOOIT een tweede betaling aanmaakt — Mollie
 * geeft dezelfde betaling terug. Eén checkout-poging = max één Mollie-betaling.
 */
export async function createMollieTerminalPayment(input: {
  amountCents: number;
  description: string;
  terminalId: string;
  metadata: Record<string, unknown>;
  idempotencyKey: string;
  /** Weglaten = geen webhook (het gedrag van vóór deze wijziging). */
  webhookUrl?: string;
}): Promise<MolliePayment> {
  if (!input.terminalId) throw new Error("terminalId ontbreekt — geen Mollie-terminal geconfigureerd.");
  const body: Record<string, unknown> = {
    amount: { currency: "EUR", value: centsToValue(input.amountCents) },
    description: input.description,
    method: "pointofsale",
    terminalId: input.terminalId,
    metadata: input.metadata,
  };
  /* Mollie accepteert geen webhook op localhost. Lokaal ontwikkelen laat 'm dus
     weg in plaats van de betaling te laten mislukken — dan pollt de kassa gewoon,
     precies zoals het hiervoor werkte. */
  if (input.webhookUrl && !/^https?:\/\/(localhost|127\.|\[?::1)/i.test(input.webhookUrl)) {
    body.webhookUrl = input.webhookUrl;
  }
  // Access-token vereist een profileId + expliciete testmode (net als createMolliePayment).
  if (usesAccessToken("terminal")) {
    const profiel = process.env.MOLLIE_TERMINAL_PROFILE_ID || process.env.MOLLIE_PROFILE_ID;
    if (profiel) body.profileId = profiel;
    body.testmode = testmode("terminal");
  }

  const res = await fetch(`${API}/payments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey("terminal")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.idempotencyKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Mollie createTerminalPayment ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return parsePayment(await res.json());
}

/**
 * Annuleer een lopende Mollie-terminalbetaling (DELETE /payments/{id}). Alleen
 * zinvol zolang de status open/pending is (isCancelable) — Mollie weigert het
 * anders. Cruciaal voor de "Stop betalen"-knop: we annuleren server-side zodat
 * een latere capture voorkomen wordt en een afgebroken poging nooit alsnog geld
 * afschrijft.
 */
export async function cancelMolliePayment(
  id: string,
  opts: { terminal?: boolean } = {},
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const scope: Sleutel = opts.terminal ? "terminal" : "web";
  if (scope === "terminal" ? !mollieTerminalConfigured() : !mollieConfigured()) {
    return { ok: false, error: "Mollie niet geconfigureerd." };
  }
  if (!id) return { ok: false, error: "Geen paymentId." };
  const qs = usesAccessToken(scope) ? `?testmode=${testmode(scope)}` : "";
  try {
    const res = await fetch(`${API}/payments/${encodeURIComponent(id)}${qs}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey(scope)}` },
    });
    // 200 = geannuleerd, 422 = niet (meer) annuleerbaar (bv. al betaald/verlopen):
    // dat laatste is voor de kassa geen harde fout — de poll-guard vangt het af.
    const d = (await res.json().catch(() => null)) as { status?: string; detail?: string } | null;
    if (!res.ok) return { ok: false, status: d?.status, error: d?.detail || `Mollie ${res.status}` };
    return { ok: true, status: d?.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type MollieTerminal = { id: string; status: string; description: string; brand?: string; serialNumber?: string };

/**
 * Beschikbare fysieke terminals van het Mollie-account (GET /terminals) — zodat de
 * terminalId opzoekbaar is in de config-UI. Faalt zacht → lege lijst.
 */
export async function listMollieTerminals(): Promise<MollieTerminal[]> {
  if (!mollieTerminalConfigured()) return [];
  const qs = usesAccessToken("terminal") ? `?testmode=${testmode("terminal")}` : "";
  try {
    const res = await fetch(`${API}/terminals${qs}`, {
      headers: { Authorization: `Bearer ${apiKey("terminal")}` },
    });
    if (!res.ok) return [];
    const json = await res.json();
    const terminals = json?._embedded?.terminals ?? [];
    return terminals.map((t: any) => ({
      id: String(t.id),
      status: String(t.status || ""),
      description: String(t.description || t.id),
      brand: t.brand ? String(t.brand) : undefined,
      serialNumber: t.serialNumber ? String(t.serialNumber) : undefined,
    }));
  } catch {
    return [];
  }
}
