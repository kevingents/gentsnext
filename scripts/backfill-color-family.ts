import "@/lib/load-env";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { productVariants } from "@/db/schema";
import { colorFamily } from "@/lib/colors";

/**
 * Eenmalige backfill: vul color_family op alle bestaande varianten met de
 * kleur-mapping uit lib/colors. Nieuwe imports zetten dit voortaan zelf.
 *   npm run backfill:colorfamily
 */
async function main() {
  const db = getDb();
  const colors = await db
    .selectDistinct({ color: productVariants.color })
    .from(productVariants)
    .where(sql`${productVariants.color} <> ''`);

  console.log(`${colors.length} unieke kleuren → families berekenen…`);
  let updated = 0;
  for (const { color } of colors) {
    const fam = colorFamily(color);
    const res = await db
      .update(productVariants)
      .set({ colorFamily: fam })
      .where(sql`${productVariants.color} = ${color}`);
    updated += 1;
    if (updated % 50 === 0) console.log(`  ${updated}/${colors.length}…`);
  }
  console.log(`Klaar: ${colors.length} kleuren bijgewerkt.`);

  const dist = await db
    .select({ fam: productVariants.colorFamily, n: sql<number>`count(*)::int` })
    .from(productVariants)
    .where(sql`${productVariants.colorFamily} <> ''`)
    .groupBy(productVariants.colorFamily)
    .orderBy(sql`count(*) desc`);
  console.log("Verdeling per familie:");
  for (const d of dist) console.log(`  ${d.n}\t${d.fam}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
