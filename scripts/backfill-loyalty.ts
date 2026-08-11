import "@/lib/load-env";
import { backfillOrderLoyalty, openstaandeOrders, inwisselraming } from "@/lib/loyalty-backfill";

/**
 * Boekt de spaarpunten bij van alle betaalde orders die er nooit een kregen.
 *
 *   npm run backfill:punten            → alleen tellen (dry-run, schrijft niets)
 *   npm run backfill:punten -- --doen  → daadwerkelijk boeken
 *
 * Idempotent: de unieke index op (ref_type, ref_id) maakt dubbel boeken onmogelijk,
 * dus opnieuw draaien na een onderbreking pakt gewoon de rest op.
 */
const DOEN = process.argv.includes("--doen");
const BATCH = 1000;

const nl = (n: number) => n.toLocaleString("nl-NL");
/** Indicatie van de uitkeerwaarde bij de standaardkoers (5 cent per punt). */
const euro = (punten: number) => (punten * 0.05).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });

async function main() {
  const open = await openstaandeOrders();
  console.log(`Openstaand: ${nl(open.orders)} betaalde orders van ${nl(open.klanten)} klanten zonder puntenregel.`);
  console.log(`Dat is ${nl(open.punten)} punten, nominaal ≈ ${euro(open.punten)}.`);
  if (!open.orders) return;

  const ram = await inwisselraming();
  console.log(
    `\nDaadwerkelijk inwisselbaar (drempel ${ram.drempel} punten): ${nl(ram.klanten)} klanten, ${nl(ram.punten)} punten` +
      ` = ${(ram.waardeCents / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" })}.`,
  );

  if (!DOEN) {
    console.log("\nDRY-RUN — er is niets geschreven. Draai met --doen om dit te boeken.");
    return;
  }

  let ronde = 0;
  let totaalRegels = 0;
  let totaalPunten = 0;
  let totaalCorrecties = 0;
  for (;;) {
    const res = await backfillOrderLoyalty({ limit: BATCH });
    if (!res.geboekt && !res.correcties) break;
    ronde++;
    totaalRegels += res.geboekt;
    totaalPunten += res.punten;
    totaalCorrecties += res.correcties;
    console.log(`ronde ${ronde}: ${res.geboekt} orders · ${nl(res.punten)} punten · ${res.klanten} klanten · nog ${nl(Math.max(0, res.openstaand - res.geboekt))} te gaan`);
  }
  const rest = await openstaandeOrders();
  console.log(`\nKlaar: ${nl(totaalRegels)} orders geboekt, ${nl(totaalPunten)} punten (≈ ${euro(totaalPunten)}), ${totaalCorrecties} retour-correcties.`);
  console.log(`Resterend: ${nl(rest.orders)}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
