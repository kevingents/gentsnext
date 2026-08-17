/**
 * WhatsApp-berichten via de Meta WhatsApp Cloud API (env-gated). Secrets in
 * Vercel: WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID. Voor proactieve berichten
 * (buiten het 24u-venster) vereist Meta een goedgekeurde TEMPLATE; geef de
 * naam mee via WHATSAPP_TEMPLATE_STOCK. Zonder template valt het terug op een
 * tekstbericht (werkt alleen binnen een actief gesprek — prima voor test/dev).
 *
 * Zonder credentials: stub-log, zodat de hele flow zonder WhatsApp-koppeling
 * al werkt en testbaar is.
 */

const API_VERSION = "v21.0";

export function whatsappConfigured(): boolean {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

/** Normaliseer naar E.164 zonder '+' (Meta wil bv. 31612345678). NL/BE default. */
export function normalizePhone(raw: string): string | null {
  let s = String(raw || "").replace(/[\s().-]/g, "");
  if (!s) return null;
  if (s.startsWith("+")) s = s.slice(1);
  else if (s.startsWith("00")) s = s.slice(2);
  // Zonder landcode defaulten we op NL (+31). BE-mobiel proberen we NIET heuristisch
  // uit het nummer te halen: de NL- en BE-nummerplannen OVERLAPPEN in 04x. 045/046
  // (Limburg) en 0475/0478/0492/0493/0495/0497/0499 (Brabant) zijn NL-vaste-lijnen,
  // maar 046x-049x is óók BE-mobiel — op prefix raden stuurt die NL-nummers naar +32,
  // en matcht dat toevallig een echt BE-mobiel op WhatsApp, dan gaat de melding naar een
  // vreemde. Een BE-klant hoort z'n nummer mét landcode (+32/0032) in te vullen; dat
  // wordt hierboven al correct afgehandeld. (Betrouwbaar BE-onderscheid vergt de
  // country-hint uit de klant/order, niet het nummerplan.)
  else if (s.startsWith("06") || (s.startsWith("0") && s.length === 10)) s = "31" + s.slice(1); // NL mobiel/vast (default)
  if (!/^\d{8,15}$/.test(s)) return null;
  return s;
}

/** Generiek tekstbericht (binnen 24u-venster of met opt-in). Env-gated. */
export async function sendWhatsAppText(rawPhone: string, text: string): Promise<boolean> {
  const to = normalizePhone(rawPhone);
  if (!to) return false;
  if (!whatsappConfigured()) {
    console.log(`[whatsapp] (stub) → +${to}: ${text.slice(0, 120)}`);
    return true;
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!res.ok) {
      console.error("[whatsapp] fout:", res.status, (await res.text()).slice(0, 160));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[whatsapp] fetch-fout:", e);
    return false;
  }
}

type StockMsg = { productTitle: string; size?: string; url: string };

/** Stuurt een terug-op-voorraad-WhatsApp. Retourneert of het gelukt is. */
export async function sendBackInStockWhatsApp(rawPhone: string, msg: StockMsg): Promise<boolean> {
  const to = normalizePhone(rawPhone);
  if (!to) return false;

  if (!whatsappConfigured()) {
    console.log(`[whatsapp] (stub) zou sturen → +${to}: ${msg.productTitle}${msg.size ? ` (maat ${msg.size})` : ""} ${msg.url}`);
    return true;
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const headers = {
    Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
    "Content-Type": "application/json",
  };

  const template = process.env.WHATSAPP_TEMPLATE_STOCK;
  const body = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "nl" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: msg.productTitle + (msg.size ? ` (maat ${msg.size})` : "") },
                { type: "text", text: msg.url },
              ],
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          body: `Goed nieuws! ${msg.productTitle}${msg.size ? ` (maat ${msg.size})` : ""} is weer op voorraad. Wees er snel bij: ${msg.url}`,
        },
      };

  try {
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      console.error("[whatsapp] fout:", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[whatsapp] fetch-fout:", e);
    return false;
  }
}

type AltMsg = { origTitle: string; altTitle: string; size?: string; url: string };

/**
 * "Je maat is nog niet terug, maar dit alternatief hebben we wél in jouw maat" —
 * de 2-weken-vervolg-WhatsApp. Optioneel via WHATSAPP_TEMPLATE_ALTERNATIVE
 * (params: origineel, alternatief, url); anders tekst-fallback. Env-gated/stub.
 */
export async function sendAlternativeWhatsApp(rawPhone: string, msg: AltMsg): Promise<boolean> {
  const to = normalizePhone(rawPhone);
  if (!to) return false;
  const maat = msg.size ? ` (maat ${msg.size})` : "";
  const text = `${msg.origTitle}${maat} is helaas nog niet terug op voorraad. Maar dit alternatief hebben we wél in jouw maat: ${msg.altTitle} — ${msg.url}`;
  if (!whatsappConfigured()) {
    console.log(`[whatsapp] (stub) zou alternatief sturen → +${to}: ${text.slice(0, 140)}`);
    return true;
  }
  const endpoint = `https://graph.facebook.com/${API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const headers = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" };
  const template = process.env.WHATSAPP_TEMPLATE_ALTERNATIVE;
  const body = template
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "nl" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: msg.origTitle + maat },
                { type: "text", text: msg.altTitle },
                { type: "text", text: msg.url },
              ],
            },
          ],
        },
      }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: text } };
  try {
    const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      console.error("[whatsapp] alt-fout:", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[whatsapp] alt fetch-fout:", e);
    return false;
  }
}
