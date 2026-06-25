/**
 * DHL Parcel NL — retourlabel genereren. Env-gated: zonder creds doet dit niets
 * (de retour wordt dan aangemaakt met "label volgt per e-mail"). Patroon zoals
 * Mollie/Resend: werkt zodra de keys in Vercel staan.
 *
 * Vereiste env (Vercel → gentsnext):
 *   DHL_API_USER_ID, DHL_API_KEY        → /authenticate/api-key
 *   DHL_ACCOUNT_ID                      → verzendaccount
 *   DHL_RETURN_NAME / _STREET / _NUMBER / _ZIP / _CITY / _COUNTRY  → het retouradres (magazijn)
 *   DHL_API_BASE (optioneel)            → default api-gw.dhlparcel.nl
 *
 * LET OP: de exacte body-velden moeten één keer tegen het echte DHL-account
 * gevalideerd worden; de structuur volgt de DHL Parcel NL API.
 */

const BASE = process.env.DHL_API_BASE || "https://api-gw.dhlparcel.nl";

export function dhlConfigured(): boolean {
  return Boolean(process.env.DHL_API_USER_ID && process.env.DHL_API_KEY && process.env.DHL_ACCOUNT_ID);
}

async function dhlToken(): Promise<string | null> {
  try {
    const r = await fetch(`${BASE}/authenticate/api-key`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: process.env.DHL_API_USER_ID, key: process.env.DHL_API_KEY }),
    });
    const d = (await r.json().catch(() => null)) as { accessToken?: string } | null;
    return d?.accessToken || null;
  } catch {
    return null;
  }
}

export type ReturnAddress = {
  name: string;
  street: string;
  number: string;
  postalCode: string;
  city: string;
  country: string; // ISO2, bv. NL / BE
  email?: string;
};

export type ReturnLabel = { ok: boolean; labelUrl?: string; labelBase64?: string; tracking?: string; error?: string };

/** Maak een DHL-retourlabel: afzender = klant, ontvanger = ons retouradres. */
export async function createReturnLabel(orderNumber: string, customer: ReturnAddress): Promise<ReturnLabel> {
  if (!dhlConfigured()) return { ok: false, error: "DHL niet geconfigureerd" };
  const token = await dhlToken();
  if (!token) return { ok: false, error: "DHL-authenticatie mislukt" };

  const body = {
    orderReference: orderNumber,
    accountId: process.env.DHL_ACCOUNT_ID,
    returnLabel: true,
    parcelType: "SMALL",
    options: [{ key: "DOOR" }],
    receiver: {
      name: { companyName: process.env.DHL_RETURN_NAME || "GENTS Herenmode" },
      address: {
        countryCode: (process.env.DHL_RETURN_COUNTRY || "NL").toUpperCase(),
        postalCode: process.env.DHL_RETURN_ZIP,
        city: process.env.DHL_RETURN_CITY,
        street: process.env.DHL_RETURN_STREET,
        number: process.env.DHL_RETURN_NUMBER,
      },
    },
    shipper: {
      name: { firstName: customer.name },
      address: {
        countryCode: (customer.country || "NL").toUpperCase(),
        postalCode: customer.postalCode,
        city: customer.city,
        street: customer.street,
        number: customer.number,
      },
      email: customer.email || undefined,
    },
  };

  try {
    const r = await fetch(`${BASE}/labels`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const d = (await r.json().catch(() => null)) as Record<string, string> | null;
    if (!r.ok || !d) return { ok: false, error: (d && (d.message as string)) || `DHL ${r.status}` };
    return {
      ok: true,
      labelBase64: d.pdf || d.label || "",
      labelUrl: d.labelUrl || "",
      tracking: d.trackerCode || d.barcode || d.shipmentId || "",
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
