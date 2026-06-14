import type { FulfillmentPlan, Shipment } from "@/lib/fulfillment";

/**
 * SRS-weborder-push (SOAP, ws.srs.nl/webservices/si_weborder.php). Per zending
 * uit het allocatieplan plaatsen we een weborder in SRS. Geport van de bewezen
 * Bol→SRS-push in storegents (lib/bol-srs-push.js).
 *
 * Belangrijke SRS-eigenaardigheden (uit de praktijk):
 *  - Auth = SOAP Login (SRS_API_USER/SRS_API_PASSWORD) → session_id (24 min;
 *    wij cachen 20 min) → OrderPlaced(session_id, order_xml).
 *  - <shopid> is LEGACY (genegeerd). De webshop ("geplaatst in", 90 GENTS
 *    Webshop) wordt bepaald door de INLOG-USER, niet door de XML.
 *  - extended_attributes / crm_link / payments triggeren SRS-error 140 als de
 *    namen niet vooraf bij SRS geregistreerd zijn. Daarom standaard een MINIMALE
 *    order-XML (adres + contact + producten); de rest is opt-in via env zodra SRS
 *    de attributen heeft geregistreerd. Filiaal-routing kan later via
 *    SetFulfillments of via SRS_WEBORDER_ATTRS=afhaal_filiaal,verkoop_filiaal.
 *  - Per stuk een aparte <product>-regel (advies SRS).
 *
 * Harde kill-switch: er gaat NOOIT iets naar SRS tenzij SRS_PUSH_ENABLED==='true'.
 * Secrets (SRS_API_USER/PASSWORD) horen in Vercel-env.
 */

const WEBORDER_PATH = "/webservices/si_weborder.php";
const DEFAULT_BASE = "https://ws.srs.nl";
const SESSION_TTL_MS = 20 * 60 * 1000;
const TIMEOUT_MS = Number(process.env.SRS_SOAP_TIMEOUT_MS || 25000);

export type SrsPushResult = {
  ok: boolean;
  pushed: number;
  status: "pushed" | "partial" | "planned" | "failed";
  detail: string;
};

export type OrderForSrs = {
  orderNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
};

export type SrsLine = { sku: string; quantity: number; title?: string | null; unitPriceCents: number };

/** Harde kill-switch: orders gaan alleen naar SRS als dit expliciet aanstaat. */
export function srsConfigured(): boolean {
  if (process.env.SRS_PUSH_ENABLED !== "true") return false;
  return Boolean(process.env.SRS_API_USER && process.env.SRS_API_PASSWORD);
}

/** Of de credentials aanwezig zijn (los van de push-schakelaar) — voor de preview. */
export function srsCredentialsPresent(): boolean {
  return Boolean(process.env.SRS_API_USER && process.env.SRS_API_PASSWORD);
}

function baseUrl(): string {
  return (process.env.SRS_API_BASE_URL || process.env.SRS_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
}
function endpoint(): string {
  return `${baseUrl()}${WEBORDER_PATH}`;
}

/* ── XML-helpers ─────────────────────────────────────────────────────────── */
function xmlEscape(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function cdata(v: string): string {
  return `<![CDATA[${String(v ?? "").replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
function euro(cents: number): string {
  return ((Number(cents) || 0) / 100).toFixed(2);
}
function nodeText(xml: string, tag: string): string {
  const m = String(xml || "").match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function splitStreetHouse(street: string, houseNumber: string): { street: string; houseNumber: string } {
  const s = String(street || "").trim();
  const h = String(houseNumber || "").trim();
  if (h) return { street: s, houseNumber: h };
  const m = s.match(/^(.+?)\s+([0-9]+[a-zA-Z0-9\-/]*)$/);
  return m ? { street: m[1], houseNumber: m[2] } : { street: s, houseNumber: "" };
}

function addressXml(tag: string, order: OrderForSrs): string {
  const { street, houseNumber } = splitStreetHouse(order.street, order.houseNumber);
  const name = `${order.firstName || ""} ${order.lastName || ""}`.trim() || "Klant";
  return `
  <${tag}>
    <name>${xmlEscape(name.slice(0, 50))}</name>
    <street>${xmlEscape(street)}</street>
    <housenumber>${xmlEscape(houseNumber)}</housenumber>
    <postalcode>${xmlEscape(order.postalCode || "")}</postalcode>
    <city>${xmlEscape(order.city || "")}</city>
    <country>${xmlEscape(order.country || "NL")}</country>
  </${tag}>`;
}

function productsXml(lines: SrsLine[]): string {
  const taxPerc = Number(process.env.SRS_WEBORDER_TAX_PERC || 21).toFixed(2);
  const out: string[] = [];
  for (const l of lines) {
    const qty = Math.max(1, Math.floor(Number(l.quantity) || 1));
    for (let i = 0; i < qty; i += 1) {
      out.push(`
    <product>
      <product_sku>${xmlEscape(l.sku)}</product_sku>
      <product_name>${xmlEscape(String(l.title || l.sku).slice(0, 80))}</product_name>
      <product_quantity>1</product_quantity>
      <product_price>${euro(l.unitPriceCents)}</product_price>
      <tax_perc>${taxPerc}</tax_perc>
    </product>`);
    }
  }
  return out.join("\n");
}

function extendedAttribute(name: string, value: unknown): string {
  if (value === undefined || value === null || String(value).trim() === "") return "";
  return `
    <extended_attribute><name>${xmlEscape(name)}</name><value>${xmlEscape(value)}</value></extended_attribute>`;
}

/** Bouwt de SRS weborder-XML voor één zending (filiaal) van een order. */
export function buildWeborderXml(order: OrderForSrs, ship: Shipment, lines: SrsLine[], split: boolean): { orderId: string; xml: string } {
  const orderId = (split ? `${order.orderNumber}-${ship.branchId}` : order.orderNumber).slice(0, 15);
  const shopId = process.env.SRS_WEBORDER_SHOP_ID || "10"; // legacy, genegeerd door SRS
  const dateTime = new Date().toISOString().slice(0, 16).replace("T", " ");

  // Routing-attributen: standaard UIT (SRS-error 140 als niet geregistreerd).
  // Zet SRS_WEBORDER_ATTRS=afhaal_filiaal,verkoop_filiaal aan zodra SRS ze kent.
  const sellingBranchId = process.env.SRS_WEBSHOP_BRANCH_ID || "90";
  const fulfilmentBranchId = ship.branchId;
  const allowed = String(process.env.SRS_WEBORDER_ATTRS || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const pool: Record<string, string> = {
    verkoop_filiaal: sellingBranchId,
    afhaal_filiaal: fulfilmentBranchId,
    verzend_filiaal: fulfilmentBranchId,
    aangemaakt_in_filiaal: sellingBranchId,
    opmerking: `GENTS webshop · ${order.orderNumber}`,
  };
  const attrsXml = allowed.map((n) => extendedAttribute(n, pool[n])).filter(Boolean).join("");
  const extendedAttributesBlock = attrsXml ? `<extended_attributes>${attrsXml}</extended_attributes>` : "";

  // crm_link en payments standaard UIT (zelfde error-140-reden). Opt-in via env.
  const crmLinkBlock = process.env.SRS_WEBORDER_INCLUDE_CRM_LINK === "1" ? "<crm_link>true</crm_link>" : "";
  const total = lines.reduce((s, l) => s + l.unitPriceCents * Math.max(1, Math.floor(Number(l.quantity) || 1)), 0);
  const paymentsBlock =
    process.env.SRS_WEBORDER_INCLUDE_PAYMENTS === "1"
      ? `<payments><payment><type>${xmlEscape(process.env.SRS_WEBORDER_PAYMENT_TYPE || "eft")}</type><amount>${euro(total)}</amount></payment></payments>`
      : "";

  const phone = String(order.phone || "").trim();
  const contact = [
    `<email>${xmlEscape(order.email || "")}</email>`,
    phone ? `<phone>${xmlEscape(phone)}</phone>` : "",
    phone ? `<mobile>${xmlEscape(phone)}</mobile>` : "",
  ].filter(Boolean).join("\n    ");

  const xml = `<order>
  <shopid>${xmlEscape(shopId)}</shopid>
  <orderid>${xmlEscape(orderId)}</orderid>
  ${crmLinkBlock}
  <date_time>${xmlEscape(dateTime)}</date_time>
  ${addressXml("billing", order)}
  ${addressXml("delivery", order)}
  <contact>
    ${contact}
  </contact>
  <orderinfo>
    ${productsXml(lines)}
  </orderinfo>
  ${paymentsBlock}
  ${extendedAttributesBlock}
</order>`;

  return { orderId, xml };
}

/* ── SOAP-sessie (module-cache) + calls ──────────────────────────────────── */
let _session: { id: string; exp: number } | null = null;
let _inflight: Promise<string> | null = null;

async function postSoap(action: string, xml: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(endpoint(), {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action },
      body: xml,
      signal: ctrl.signal,
    });
    const text = await r.text();
    const fault = nodeText(text, "faultstring");
    if (!r.ok || fault) {
      const err = new Error(fault || `SRS ${action} HTTP ${r.status}: ${text.slice(0, 500)}`) as Error & { status?: number; responseText?: string };
      err.status = r.status;
      err.responseText = text;
      throw err;
    }
    return text;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error(`SRS ${action} timeout na ${TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function login(): Promise<string> {
  const user = process.env.SRS_API_USER || "";
  const password = process.env.SRS_API_PASSWORD || "";
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:si="https://www.storeinfo.nl/webservices/si_weborder.php">
  <soapenv:Header/>
  <soapenv:Body>
    <si:Login soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <user_id xsi:type="xsd:string">${xmlEscape(user)}</user_id>
      <password xsi:type="xsd:string">${xmlEscape(password)}</password>
    </si:Login>
  </soapenv:Body>
</soapenv:Envelope>`;
  const text = await postSoap("Login", xml);
  const id = nodeText(text, "return");
  if (!id) throw new Error("SRS Login gaf geen session_id terug.");
  return id;
}

async function getSession(): Promise<string> {
  if (_session && _session.exp > Date.now()) return _session.id;
  if (_inflight) return _inflight;
  _inflight = login()
    .then((id) => {
      _session = { id, exp: Date.now() + SESSION_TTL_MS };
      return id;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}
function invalidateSession() {
  _session = null;
}
function isSessionError(e: unknown): boolean {
  const err = e as { status?: number; message?: string; responseText?: string };
  if (Number(err?.status) === 401) return true;
  const blob = String(err?.message || err?.responseText || "").toLowerCase();
  return ["session", "login", "not logged in", "niet ingelogd", "authentication"].some((h) => blob.includes(h));
}

async function orderPlaced(sessionId: string, orderXml: string): Promise<void> {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:si="https://www.storeinfo.nl/webservices/si_weborder.php">
  <soapenv:Header/>
  <soapenv:Body>
    <si:OrderPlaced soapenv:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
      <session_id xsi:type="xsd:string">${xmlEscape(sessionId)}</session_id>
      <order_xml xsi:type="xsd:string">${cdata(orderXml)}</order_xml>
    </si:OrderPlaced>
  </soapenv:Body>
</soapenv:Envelope>`;
  const text = await postSoap("OrderPlaced", xml);
  const ret = nodeText(text, "return");
  if (ret.toLowerCase() !== "true" && ret !== "1") {
    throw new Error(`SRS OrderPlaced gaf geen positieve return: ${ret || text.slice(0, 200)}`);
  }
}

/* ── Preview (admin, géén push) ──────────────────────────────────────────── */
export function previewWeborders(order: OrderForSrs, plan: FulfillmentPlan, lines: SrsLine[]): { branchId: string; store: string; orderId: string; xml: string }[] {
  const priceBySku = new Map(lines.map((l) => [l.sku, l]));
  const split = plan.splitCount > 1;
  return plan.shipments.map((ship) => {
    const shipLines: SrsLine[] = ship.lines.map((l) => {
      const ref = priceBySku.get(l.sku);
      return { sku: l.sku, quantity: l.qty, title: l.title ?? ref?.title ?? null, unitPriceCents: ref?.unitPriceCents ?? 0 };
    });
    const { orderId, xml } = buildWeborderXml(order, ship, shipLines, split);
    return { branchId: ship.branchId, store: ship.store, orderId, xml };
  });
}

/* ── Push ────────────────────────────────────────────────────────────────── */
export async function pushOrderToSRS(order: OrderForSrs, plan: FulfillmentPlan, lines: SrsLine[]): Promise<SrsPushResult> {
  if (!plan.shipments.length) {
    return { ok: false, pushed: 0, status: "failed", detail: "geen zendingen in plan" };
  }

  const split = plan.splitCount > 1;
  const priceBySku = new Map(lines.map((l) => [l.sku, l]));
  const buildLines = (ship: Shipment): SrsLine[] =>
    ship.lines.map((l) => {
      const ref = priceBySku.get(l.sku);
      return { sku: l.sku, quantity: l.qty, title: l.title ?? ref?.title ?? null, unitPriceCents: ref?.unitPriceCents ?? 0 };
    });

  if (!srsConfigured()) {
    // Kill-switch uit (of geen creds): niets pushen, plan staat al op de order.
    console.log(
      "[srs] (push uit) weborders klaar voor",
      order.orderNumber,
      "→",
      plan.shipments.map((s) => `${s.store}(${s.branchId}): ${s.lines.map((l) => `${l.qty}×${l.sku}`).join(",")}`).join(" | ")
    );
    return { ok: true, pushed: 0, status: "planned", detail: "SRS-push staat uit — plan opgeslagen" };
  }

  let pushed = 0;
  for (const ship of plan.shipments) {
    const { xml } = buildWeborderXml(order, ship, buildLines(ship), split);
    try {
      let session = await getSession();
      try {
        await orderPlaced(session, xml);
      } catch (e) {
        if (!isSessionError(e)) throw e;
        invalidateSession();
        session = await getSession();
        await orderPlaced(session, xml);
      }
      pushed++;
    } catch (e) {
      console.error("[srs] push faalde voor", order.orderNumber, ship.branchId, e instanceof Error ? e.message : e);
    }
  }

  const status: SrsPushResult["status"] = pushed === plan.shipments.length ? "pushed" : pushed > 0 ? "partial" : "failed";
  return { ok: pushed > 0, pushed, status, detail: `${pushed}/${plan.shipments.length} zendingen gepusht` };
}
