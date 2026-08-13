import "@/lib/load-env";
import { HERO_MODEL, HERO_THEMAS, maakHeroBeeld } from "@/lib/hero-media";

/**
 * Hero-/sfeerbeelden vanaf nul met fal.ai (FLUX). Voor merk-banners — NIET voor
 * productweergave (daarvoor blijft FASHN + onze echte producten gelden).
 *
 * De prompts, de stijlregels en het wegschrijven naar de blob staan in
 * lib/hero-media.ts, want de portal maakt via /api/studio/heroes exact dezelfde
 * beelden. Twee kopieën van dezelfde prompt lopen uit elkaar.
 *
 *   FAL_KEY in .env.local zetten, dan:
 *   npx tsx scripts/generate-hero-media.ts            (alle hero's, 1 beeld elk)
 *   npx tsx scripts/generate-hero-media.ts wedding    (alleen slugs die 'wedding' bevatten)
 *   npx tsx scripts/generate-hero-media.ts "" 2       (2 varianten per hero)
 */

async function main() {
  if (!process.env.FAL_KEY && !process.env.FAL_API_KEY) {
    console.error("FAL_KEY ontbreekt in .env.local.");
    process.exit(1);
  }
  if (!process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN && !process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("Blob-token ontbreekt.");
    process.exit(1);
  }

  const only = (process.argv[2] || "").trim().toLowerCase();
  const variants = Math.max(1, Math.min(4, Number(process.argv[3]) || 1));
  const list = HERO_THEMAS.filter((h) => !only || h.slug.includes(only));
  console.log(`⏳ ${list.length} hero('s) · ${variants} variant(en) · model ${HERO_MODEL}`);

  for (const h of list) {
    for (let v = 0; v < variants; v++) {
      console.log(`• ${h.slug} (${h.aspect})`);
      try {
        /* maakHeroBeeld hangt er zelf een volgnummer achter als de naam al
           bestaat, dus varianten overschrijven elkaar niet. */
        const beeld = await maakHeroBeeld({ thema: h.slug });
        console.log(`   ✓ ${beeld.slug} → ${beeld.url}`);
      } catch (e) {
        console.log(`   ✗ ${String((e as Error)?.message || e).slice(0, 160)}`);
      }
    }
  }
  console.log("\n✓ Klaar.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
