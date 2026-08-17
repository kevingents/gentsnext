import { getSessionCustomer } from "@/lib/account";
import { getOrderForViewer } from "@/lib/orders";
import { renderInvoice } from "@/lib/invoice";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/account/factuur/[orderNumber] — de factuur van een betaalde order als
 * printbare pagina (browser → "Bewaar als pdf"). Zelfde viewer-beveiliging als
 * /bestelling/[nr]: eigenaar via de sessie, of een gast met het access-token
 * (?t=...). Zonder die check zou een ordernummer genoeg zijn om andermans NAW-
 * gegevens en aankopen op te halen.
 */
export async function GET(req: Request, { params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const token = new URL(req.url).searchParams.get("t");
  const customer = await getSessionCustomer().catch(() => null);
  const data = await getOrderForViewer(String(orderNumber || ""), { token, customerId: customer?.id ?? null });
  if (!data) return new Response("Geen toegang tot deze bestelling.", { status: 403 });

  // Een factuur hoort bij een betaalde order; voor een openstaande of mislukte
  // betaling bestaat er niets om te factureren.
  const betaald = ["paid", "shipped", "ready_pickup", "delivered", "refunded"].includes(String(data.order.status));
  if (!betaald) return new Response("Voor deze bestelling is (nog) geen factuur.", { status: 409 });

  const html = renderInvoice(data.order, data.lines, (await getSettings()).factuur);
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Nooit in een gedeelde cache: dit is persoonsgebonden.
      "cache-control": "private, no-store",
    },
  });
}
