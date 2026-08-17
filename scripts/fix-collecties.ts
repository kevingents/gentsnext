import "@/lib/load-env";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Zet twee collecties recht die uit de Shopify-import scheef binnenkwamen.
 * Idempotent — je kunt 'm zo vaak draaien als je wilt.
 *
 *   npx tsx scripts/fix-collecties.ts            (toont alleen)
 *   npx tsx scripts/fix-collecties.ts --schrijf  (past aan)
 *
 * 1. business-overhemden bevatte 5 smokingoverhemden + 1 rokhemd. Een
 *    smokinghemd is geen businesshemd; het hoort bij /collections/smoking.
 * 2. mix-match-pakken ("Business pakken") stond op NUL zichtbare producten: de
 *    4 leden zijn uitverkochte complete pakken. Die collectie is de hoofd-CTA
 *    van de gelegenheid "Zakelijk" én van het menu-item Business pakken — dus
 *    twee doodlopende pagina's. Vullen met de combineerbare MixMatch-colberts
 *    (elk colbert = ingang naar een samen te stellen pak).
 */

const SCHRIJF = process.argv.includes("--schrijf");

async function collectieId(db: ReturnType<typeof getDb>, handle: string): Promise<string | null> {
  const rows = (await db.execute<{ id: string }>(sql`select id from collections where handle = ${handle} limit 1`)).rows;
  return rows[0]?.id ?? null;
}

async function main() {
  const db = getDb();

  /* 1. Smoking- en rokkostuumhemden uit business-overhemden. */
  const boId = await collectieId(db, "business-overhemden");
  if (!boId) {
    console.error("✗ collectie business-overhemden niet gevonden");
  } else {
    const fout = (
      await db.execute<{ id: string; title: string; sg: string }>(sql`
        select p.id, p.title, p.attributes->>'subgroep' sg
        from product_collections pc
        join products p on p.id = pc.product_id
        where pc.collection_id = ${boId}
          and p.attributes->>'subgroep' in ('Smoking','Rokkostuum')
        order by p.title
      `)
    ).rows;
    console.log(`business-overhemden: ${fout.length} niet-zakelijke overhemden`);
    for (const r of fout) console.log(`   − ${r.title} (${r.sg})`);
    if (SCHRIJF && fout.length) {
      await db.execute(sql`
        delete from product_collections pc
        using products p
        where p.id = pc.product_id and pc.collection_id = ${boId}
          and p.attributes->>'subgroep' in ('Smoking','Rokkostuum')
      `);
      console.log(`   ✓ verwijderd uit de collectie (de producten zelf blijven bestaan)`);
    }
  }

  /* 2. Business pakken vullen met MixMatch-colberts. */
  const mmId = await collectieId(db, "mix-match-pakken");
  if (!mmId) {
    console.error("✗ collectie mix-match-pakken niet gevonden");
  } else {
    const nu = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int n from product_collections pc join products p on p.id = pc.product_id
        where pc.collection_id = ${mmId}
          and p.status='active' and p.has_image and p.in_stock and p.is_group_primary
      `)
    ).rows[0]?.n ?? 0;
    const kandidaten = (
      await db.execute<{ n: number }>(sql`
        select count(*)::int n from products p
        where p.status = 'active' and p.in_stock and p.has_image and p.is_group_primary
          and p.attributes->>'mix_and_match' = 'Ja'
          and p.attributes->>'hoofdgroep_omschrijving' = 'Colberts'
      `)
    ).rows[0]?.n ?? 0;
    console.log(`mix-match-pakken: ${nu} zichtbaar nu → ${kandidaten} MixMatch-colberts beschikbaar`);
    if (SCHRIJF && kandidaten > 0) {
      await db.execute(sql`delete from product_collections where collection_id = ${mmId}`);
      const res = await db.execute<{ id: string }>(sql`
        insert into product_collections (collection_id, product_id, position)
        select ${mmId}, p.id, (row_number() over (order by p.stock_qty desc nulls last, p.title))::int - 1
        from products p
        where p.status = 'active' and p.in_stock and p.has_image and p.is_group_primary
          and p.attributes->>'mix_and_match' = 'Ja'
          and p.attributes->>'hoofdgroep_omschrijving' = 'Colberts'
        returning product_id as id
      `);
      console.log(`   ✓ ${res.rows.length} colberts in "Business pakken"`);
    }
  }

  if (!SCHRIJF) console.log("\n(alleen getoond — draai met --schrijf om aan te passen)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
