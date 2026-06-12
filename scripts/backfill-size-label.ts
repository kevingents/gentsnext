import "@/lib/load-env";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { productVariants } from "@/db/schema";
import { sizeRowLabel } from "@/lib/size-taxonomy";

/**
 * Eenmalige backfill: vul size_label (lettermaat-bucket) op alle varianten.
 * Nieuwe imports zetten dit voortaan zelf.  npm run backfill:sizelabel
 */
async function main() {
  const db = getDb();
  const sizes = await db
    .selectDistinct({ size: productVariants.size })
    .from(productVariants)
    .where(sql`${productVariants.size} <> ''`);

  console.log(`${sizes.length} unieke maten → buckets…`);
  for (const { size } of sizes) {
    await db
      .update(productVariants)
      .set({ sizeLabel: sizeRowLabel(size) })
      .where(sql`${productVariants.size} = ${size}`);
  }

  const dist = await db
    .select({ label: productVariants.sizeLabel, n: sql<number>`count(*)::int` })
    .from(productVariants)
    .where(sql`${productVariants.sizeLabel} <> ''`)
    .groupBy(productVariants.sizeLabel)
    .orderBy(sql`count(*) desc`);
  console.log("Verdeling per bucket:");
  for (const d of dist) console.log(`  ${String(d.n).padStart(6)}  ${d.label}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
