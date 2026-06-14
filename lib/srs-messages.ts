/**
 * SRS Messages-API (SOAP, ws.storeinfo.nl/messages/v1/soap/Customers.php).
 * Geport uit storegents (lib/srs-customers-client.js). Twee methodes die we
 * nodig hebben voor omnichannel: een klant opzoeken op e-mail (→ SRS CustomerId)
 * en de winkeltransacties (bonnen) van die klant ophalen (offline aankopen).
 *
 * Auth = inline Login (Id/Password per call; geen sessie). Secrets in Vercel:
 * SRS_MESSAGE_USER / SRS_MESSAGE_PASSWORD (+ SRS_BASE_URL, default ws.storeinfo.nl).
 */

const DEFAULT_BASE = "https://ws.storeinfo.nl";
const CUSTOMERS_PATH = "/messages/v1/soap/Customers.php";
const TIMEOUT_MS = Number(process.env.SRS_CUSTOMERS_TIMEOUT_MS || process.env.SRS_SOAP_TIMEOUT_MS || 45000);

export function messagesConfigured(): boolean {
  return Boolean(process.env.SRS_MESSAGE_USER && process.env.SRS_MESSAGE_PASSWORD);
}

function config() {
  const id = process.env.SRS_MESSAGE_USER || "";
  const password = process.env.SRS_MESSAGE_PASSWORD || "";
  const baseUrl = (process.env.SRS_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  if (!id || !password) throw new Error("SRS_MESSAGE_USER en/of SRS_MESSAGE_PASSWORD ontbreken.");
  return { id, password, endpoint: `${baseUrl}${CUSTOMERS_PATH}` };
}

function xmlEscape(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function decodeXml(v: string): string {
  return String(v || "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function nodeText(xml: string, tag: string): string {
  const m = String(xml || "").match(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "i"));
  return m ? decodeXml(m[1].trim()) : "";
}
function allBlocks(xml: string, tag: string): string[] {
  return Array.from(String(xml || "").matchAll(new RegExp(`<(?:[A-Za-z0-9_]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_]+:)?${tag}>`, "gi"))).map((m) => m[1]);
}
function firstText(block: string, tags: string[]): string {
  for (const t of tags) {
    const v = nodeText(block, t);
    if (v) return v;
  }
  return "";
}
function loginXml(): string {
  const { id, password } = config();
  return `<data:Login><com:Id>${xmlEscape(id)}</com:Id><com:Password>${xmlEscape(password)}</com:Password></data:Login>`;
}

async function postSoap(action: string, xml: string): Promise<string> {
  const { endpoint } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action }, body: xml, signal: ctrl.signal });
    const text = await r.text();
    const fault = nodeText(text, "faultstring") || nodeText(text, "Reason");
    if (!r.ok || fault) throw new Error(fault || `SRS Messages ${action} HTTP ${r.status}: ${text.slice(0, 400)}`);
    return text;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error(`SRS Messages ${action} timeout na ${TIMEOUT_MS}ms`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/* ── E-mail (of customerId) → SRS-klant ──────────────────────────────────── */
function cleanEmail(v: string): string {
  const m = decodeXml(String(v || "").trim()).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].trim() : "";
}
function customerEmail(block: string): string {
  const direct = Array.from(String(block || "").matchAll(/<(?:[A-Za-z0-9_]+:)?EmailAddress\b[^>]*>([^<>]*@[^<>]*)<\/(?:[A-Za-z0-9_]+:)?EmailAddress>/gi)).map((m) => cleanEmail(m[1])).filter(Boolean);
  return direct[0] || "";
}

export type SrsCustomerLite = { customerId: string; email: string; name: string; registeredInBranchId: string };

export async function getSrsCustomers(filters: { email?: string; customerId?: string }): Promise<SrsCustomerLite[]> {
  const body: string[] = [];
  if (filters.customerId) body.push(`<data:CustomerId>${xmlEscape(filters.customerId)}</data:CustomerId>`);
  if (filters.email) body.push(`<data:EmailAddress>${xmlEscape(filters.email)}</data:EmailAddress>`);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:data="https://messages.storeinfo.nl/v1/Customers/Data" xmlns:com="https://messages.storeinfo.nl/v1/Common">
  <soapenv:Header/>
  <soapenv:Body>
    <data:GetCustomers>
      ${loginXml()}
      <data:Body>${body.join("\n")}</data:Body>
    </data:GetCustomers>
  </soapenv:Body>
</soapenv:Envelope>`;
  const raw = await postSoap("GetCustomers", xml);
  return allBlocks(raw, "Customer")
    .map((b) => ({
      customerId: firstText(b, ["CustomerId", "CustomerID"]),
      email: customerEmail(b),
      name: [nodeText(b, "FirstName"), nodeText(b, "LastName")].filter(Boolean).join(" ").trim(),
      registeredInBranchId: nodeText(b, "RegisteredInBranchId"),
    }))
    .filter((c) => c.customerId);
}

/** SRS-CustomerId voor een e-mailadres (exacte match), of null. */
export async function srsCustomerIdByEmail(email: string): Promise<string | null> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return null;
  const rows = await getSrsCustomers({ email: e });
  const exact = rows.find((c) => c.email.toLowerCase() === e) || rows[0];
  return exact?.customerId || null;
}

/* ── Transacties (offline aankopen) ──────────────────────────────────────── */
export type SrsTxItem = { sku: string; description: string; pieces: number; charged: number; vat: number; listPrice: number };
export type SrsTransaction = { branchId: string; posNr: string; dateTime: string; receiptNr: string; orderNr: string; customerId: string; total: number; items: SrsTxItem[] };

export async function getSrsTransactions(opts: { customerId: string; from?: string; until?: string }): Promise<SrsTransaction[]> {
  const customerId = String(opts.customerId || "").trim();
  if (!customerId) return [];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:data="https://messages.storeinfo.nl/v1/Customers/Data" xmlns:com="https://messages.storeinfo.nl/v1/Common">
  <soapenv:Header/>
  <soapenv:Body>
    <data:GetTransactions>
      ${loginXml()}
      <data:Body>
        <data:CustomerId>${xmlEscape(customerId)}</data:CustomerId>
        ${opts.from || opts.until ? `<data:PeriodWithTime>${opts.from ? `<data:From>${xmlEscape(opts.from)}</data:From>` : ""}${opts.until ? `<data:Until>${xmlEscape(opts.until)}</data:Until>` : ""}</data:PeriodWithTime>` : ""}
      </data:Body>
    </data:GetTransactions>
  </soapenv:Body>
</soapenv:Envelope>`;
  const raw = await postSoap("GetTransactions", xml);
  return allBlocks(raw, "Transaction").map((block) => {
    const items: SrsTxItem[] = allBlocks(block, "Item").map((it) => ({
      sku: nodeText(it, "Sku"),
      description: firstText(it, ["Omschrijving", "Beschrijving", "Description", "ItemDescription"]),
      pieces: Number(nodeText(it, "Pieces") || 0),
      charged: Number(nodeText(it, "Charged") || 0),
      vat: Number(nodeText(it, "VAT") || 0),
      listPrice: Number(nodeText(it, "ListPrice") || 0),
    }));
    return {
      branchId: nodeText(block, "BranchId"),
      posNr: nodeText(block, "PosNr"),
      dateTime: nodeText(block, "DateTime"),
      receiptNr: nodeText(block, "ReceiptNr") || nodeText(block, "ReceiptNo"),
      orderNr: nodeText(block, "OrderNr") || nodeText(block, "OrderNo"),
      customerId: nodeText(block, "CustomerId") || customerId,
      total: items.reduce((s, i) => s + Number(i.charged || 0), 0),
      items,
    };
  });
}
