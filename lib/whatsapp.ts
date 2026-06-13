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
  else if (s.startsWith("06") || (s.startsWith("0") && s.length === 10)) s = "31" + s.slice(1); // NL mobiel
  else if (s.startsWith("04") && s.length === 10) s = "32" + s.slice(1); // BE mobiel
  if (!/^\d{8,15}$/.test(s)) return null;
  return s;
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
