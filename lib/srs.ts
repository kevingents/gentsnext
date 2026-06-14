import type { FulfillmentPlan } from "@/lib/fulfillment";

/**
 * SRS-weborder-push. Per zending (filiaal) wordt een weborder in SRS gemaakt,
 * zodat dat filiaal de regels pickt/pakt en verzendt. De échte SRS-call (SOAP/
 * REST/SFTP) komt uit het SRS-vendorgesprek; tot die er is, is dit env-gated:
 * zonder SRS-credentials loggen we de payload en geven we "planned" terug, zodat
 * de hele flow al werkt en getest kan worden.
 *
 * Secrets (SRS_API_URL/SRS_API_KEY) horen in Vercel-env (dit zijn wél secrets).
 */

export type SrsPushResult = {
  ok: boolean;
  pushed: number; // aantal succesvol gepushte zendingen
  status: "pushed" | "partial" | "planned" | "failed";
  detail: string;
};

export function srsConfigured(): boolean {
  // Harde kill-switch: orders gaan NOOIT naar SRS tot SRS_PUSH_ENABLED === 'true'
  // is gezet — óók niet als de creds al bestaan. Zo schiet er niets per ongeluk
  // naar SRS (bewuste go-live-keuze).
  if (process.env.SRS_PUSH_ENABLED !== "true") return false;
  return Boolean(process.env.SRS_API_URL && process.env.SRS_API_KEY);
}

type OrderForSrs = {
  orderNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  country: string;
};

export async function pushOrderToSRS(order: OrderForSrs, plan: FulfillmentPlan): Promise<SrsPushResult> {
  if (!plan.shipments.length) {
    return { ok: false, pushed: 0, status: "failed", detail: "geen zendingen in plan" };
  }

  if (!srsConfigured()) {
    // Nog geen SRS-koppeling: payload loggen, plan staat al op de order.
    console.log(
      "[srs] (stub) weborders klaar voor",
      order.orderNumber,
      "→",
      plan.shipments.map((s) => `${s.store}(${s.branchId}): ${s.lines.map((l) => `${l.qty}×${l.sku}`).join(",")}`).join(" | ")
    );
    return { ok: true, pushed: 0, status: "planned", detail: "SRS niet gekoppeld — plan opgeslagen" };
  }

  // Echte push: één weborder per filiaal-zending.
  let pushed = 0;
  for (const ship of plan.shipments) {
    try {
      const res = await fetch(`${process.env.SRS_API_URL}/weborders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.SRS_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `${order.orderNumber}-${ship.branchId}`,
        },
        body: JSON.stringify({
          reference: `${order.orderNumber}-${ship.branchId}`,
          branchId: ship.branchId,
          ship: {
            name: `${order.firstName} ${order.lastName}`.trim(),
            email: order.email,
            street: order.street,
            houseNumber: order.houseNumber,
            postalCode: order.postalCode,
            city: order.city,
            country: order.country,
          },
          lines: ship.lines.map((l) => ({ sku: l.sku, quantity: l.qty })),
        }),
      });
      if (res.ok) pushed++;
      else console.error("[srs] push faalde", ship.branchId, res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.error("[srs] push-fout", ship.branchId, e);
    }
  }

  const status: SrsPushResult["status"] = pushed === plan.shipments.length ? "pushed" : pushed > 0 ? "partial" : "failed";
  return { ok: pushed > 0, pushed, status, detail: `${pushed}/${plan.shipments.length} zendingen gepusht` };
}
