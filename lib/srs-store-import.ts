import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storePurchases, customers } from "@/db/schema";
import { BRANCH_CITY } from "@/lib/fulfillment-config";
import { srsCustomerIdByEmail, getSrsTransactions, messagesConfigured } from "@/lib/srs-messages";

/**
 * Omnichannel: importeert de winkelaankopen (offline bonnen) van een klant uit
 * SRS naar store_purchases. Géén e-mails of meldingen — puur DB-insert,
 * idempotent (dedup op receiptId per klant). Slaat de gevonden SRS-CustomerId op
 * het account op zodat een volgende keer direct gekoppeld is.
 */

export type StoreImportResult = {
  ok: boolean;
  srsCustomerId: string | null;
  found: number; // transacties uit SRS
  imported: number; // nieuw toegevoegd
  skipped: number; // al aanwezig
  error?: string;
};

function storeName(branchId: string): string {
  const city = BRANCH_CITY[branchId];
  return city ? `GENTS ${city}` : branchId ? `Filiaal ${branchId}` : "Winkel";
}

function parseDate(s: string): Date {
  const d = new Date(String(s || "").replace(" ", "T"));
  // Bij een onleesbare/lege datum NIET op vandaag zetten (zou historie misdateren);
  // epoch-sentinel maakt zichtbaar dat de SRS-datum ontbrak.
  return isNaN(d.getTime()) ? new Date(0) : d;
}

type CustomerRow = { id: string; email: string; srsCustomerId: string | null };

export async function importStorePurchases(customer: CustomerRow): Promise<StoreImportResult> {
  if (!messagesConfigured()) {
    return { ok: false, srsCustomerId: null, found: 0, imported: 0, skipped: 0, error: "SRS Messages niet geconfigureerd (SRS_MESSAGE_USER/PASSWORD)." };
  }
  const db = getDb();

  // 1. SRS-CustomerId bepalen (uit account of via e-mail) en bewaren.
  let srsId = (customer.srsCustomerId || "").trim();
  if (!srsId && customer.email) {
    srsId = (await srsCustomerIdByEmail(customer.email)) || "";
    if (srsId) {
      await db.update(customers).set({ srsCustomerId: srsId, updatedAt: sql`now()` }).where(eq(customers.id, customer.id));
    }
  }
  if (!srsId) {
    return { ok: true, srsCustomerId: null, found: 0, imported: 0, skipped: 0, error: "Geen SRS-klant gevonden voor dit e-mailadres." };
  }

  // 2. Transacties ophalen.
  const txns = await getSrsTransactions({ customerId: srsId });
  if (!txns.length) return { ok: true, srsCustomerId: srsId, found: 0, imported: 0, skipped: 0 };

  // 3. Dedup op receiptId per klant.
  const existing = await db.select({ receiptId: storePurchases.receiptId }).from(storePurchases).where(eq(storePurchases.customerId, customer.id));
  const seen = new Set(existing.map((r) => r.receiptId).filter(Boolean) as string[]);

  const batchSeen = new Set<string>(); // ook binnen één batch dedupen
  const rows = txns
    .map((t) => ({ t, receiptId: t.receiptNr || `${t.branchId}-${t.posNr}-${t.dateTime}` }))
    .filter(({ receiptId }) => {
      if (!receiptId || seen.has(receiptId) || batchSeen.has(receiptId)) return false;
      batchSeen.add(receiptId);
      return true;
    })
    .map(({ t, receiptId }) => ({
      customerId: customer.id,
      srsCustomerId: srsId,
      email: customer.email || null,
      storeName: storeName(t.branchId),
      branchId: t.branchId || null,
      receiptId,
      purchasedAt: parseDate(t.dateTime),
      totalCents: Math.round((Number(t.total) || 0) * 100), // som van charged; bij netto-retour negatief (correct)
      pointsEarned: 0,
      lines: t.items.map((i) => {
        // SRS 'Charged' = regeltotaal en is NEGATIEF bij retour-regels. Teken
        // bewaren we (qty × stukprijs = regeltotaal blijft kloppen).
        const pieces = Math.trunc(Number(i.pieces)) || 1;
        return {
          title: i.description || i.sku,
          size: "",
          color: "",
          qty: pieces,
          unitPriceCents: Math.round((Number(i.charged || 0) / pieces) * 100),
        };
      }),
    }));

  if (rows.length) await db.insert(storePurchases).values(rows);

  return { ok: true, srsCustomerId: srsId, found: txns.length, imported: rows.length, skipped: txns.length - rows.length };
}
