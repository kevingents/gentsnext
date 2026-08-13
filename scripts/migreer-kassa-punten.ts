/**
 * Zet de losse kassa-spaarpunten over naar HET grootboek (`loyalty_events`).
 *
 * Waarom dit moet: verdienen aan de kassa schreef in `loyalty_accounts`, terwijl
 * inwisselen aan de kassa al via `redeemPointsForVoucher` uit `loyalty_events`
 * gaat. Aan dezelfde toonbank spaarde een klant dus in de ene pot en gaf hij uit
 * uit de andere. Vanaf nu boekt de core alles in één grootboek; dit script haalt
 * de saldi op die er al stonden.
 *
 * De brug is het E-MAILADRES op de bon, niet SRS (0 van de 48.349 klanten heeft
 * een SRS-nummer in Neon; alle losse kassa-accounts hébben wél een bon met
 * e-mail). Zie lib/loyalty-brug.
 *
 * Idempotent: elke overzetting krijgt refId "kassa-migratie:<kassa-id>". Twee
 * keer draaien boekt niets dubbel. Het kassa-saldo wordt daarna op 0 gezet, zodat
 * er geen tweede waarheid blijft staan die iemand later opnieuw kan overzetten.
 *
 * Gebruik:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/migreer-kassa-punten.ts
 *   ... voeg --doen toe om het écht te boeken (zonder die vlag: alleen tonen)
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, loyaltyAccounts, loyaltyEvents } from "@/db/schema";
import { neonKlantVoorKassa } from "@/lib/loyalty-brug";

const DOEN = process.argv.includes("--doen");

async function main() {
  const db = getDb();
  const accounts = await db
    .select({ kassaId: loyaltyAccounts.customerId, saldo: loyaltyAccounts.balance, naam: loyaltyAccounts.name })
    .from(loyaltyAccounts)
    .where(sql`${loyaltyAccounts.balance} > 0`);

  console.log(`${accounts.length} kassa-accounts met saldo.${DOEN ? "" : "  (PROEF — niets wordt geboekt)"}\n`);

  let over = 0, punten = 0, blijft = 0, puntenBlijft = 0, alGedaan = 0;

  for (const a of accounts) {
    const brug = await neonKlantVoorKassa(a.kassaId);
    const label = `${a.kassaId.slice(0, 12).padEnd(14)} ${String(a.saldo).padStart(5)} pt  ${a.naam || "—"}`;

    if (!brug.customerId) {
      console.log(`  ✗ ${label}  → geen klant (blijft staan)`);
      blijft++;
      puntenBlijft += a.saldo;
      continue;
    }

    const refId = `kassa-migratie:${a.kassaId}`;
    const [bestaat] = await db
      .select({ id: loyaltyEvents.id })
      .from(loyaltyEvents)
      .where(sql`${loyaltyEvents.refType} = 'pos_sale' and ${loyaltyEvents.refId} = ${refId}`)
      .limit(1);
    if (bestaat) {
      console.log(`  · ${label}  → stond er al (${brug.via})`);
      alGedaan++;
      continue;
    }

    console.log(`  ✓ ${label}  → klant ${brug.customerId.slice(0, 8)}… (${brug.via})`);
    over++;
    punten += a.saldo;
    if (!DOEN) continue;

    /* Direct besteedbaar: deze punten zijn al weken oud, de vestingperiode van de
       onderliggende bonnen is allang verstreken. Ze nu opnieuw laten "rijpen" zou
       een klant punten afnemen die hij vandaag al kon uitgeven. */
    await db.insert(loyaltyEvents).values({
      customerId: brug.customerId,
      points: a.saldo,
      reason: "Spaarpunten uit de winkel",
      refType: "pos_sale",
      refId,
      vestsAt: null,
    });
    await db
      .update(customers)
      .set({ loyaltyPoints: sql`greatest(0, ${customers.loyaltyPoints} + ${a.saldo})`, updatedAt: new Date() })
      .where(eq(customers.id, brug.customerId));
    // Kassa-saldo op 0: één waarheid, en niemand kan dit later nóg eens overzetten.
    await db
      .update(loyaltyAccounts)
      .set({ balance: 0, updatedAt: new Date() })
      .where(eq(loyaltyAccounts.customerId, a.kassaId));
  }

  console.log(
    `\n${DOEN ? "GEBOEKT" : "ZOU BOEKEN"}: ${over} accounts / ${punten} punten` +
      `${alGedaan ? ` · ${alGedaan} stond er al` : ""}` +
      `${blijft ? ` · ${blijft} accounts (${puntenBlijft} punten) blijven staan: geen klant te vinden` : ""}`,
  );
  if (!DOEN) console.log("Voeg --doen toe om het echt te boeken.");
}

main().catch((e) => {
  console.error("MISLUKT:", e instanceof Error ? e.message : e);
  process.exit(1);
});
