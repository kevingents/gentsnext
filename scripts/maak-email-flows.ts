import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { emailFlows } from "@/db/schema";
import { STANDAARD_FLOWS } from "@/lib/email-flow-standaard";
import { vulAlleFlows } from "@/lib/email-flows";

/**
 * Maakt de startflows aan. Idempotent (upsert op slug).
 *
 * Ze staan standaard op INACTIEF. Een flow die meteen na het aanmaken begint te
 * mailen naar duizenden mensen is precies het ongeluk dat je niet wilt; eerst
 * kijken wie er in zou vallen, dan pas aanzetten.
 *
 *   npm run flows:maak            aanmaken (inactief) + tellen wie er in zou vallen
 */
async function main() {
  const db = getDb();
  for (const f of STANDAARD_FLOWS) {
    let doelgroepId: string | null = null;
    if (f.triggerDoelgroepSlug) {
      const r = await db.execute<{ id: string }>(sql`select id from audiences where slug = ${f.triggerDoelgroepSlug}`);
      doelgroepId = r.rows[0]?.id ?? null;
      if (!doelgroepId) console.warn(`  ! doelgroep '${f.triggerDoelgroepSlug}' bestaat niet — ${f.slug} kan niet vullen`);
    }
    await db
      .insert(emailFlows)
      .values({
        slug: f.slug, naam: f.naam, omschrijving: f.omschrijving,
        triggerSoort: f.triggerSoort, triggerDoelgroepId: doelgroepId,
        triggerEvent: f.triggerEvent ?? "",
        stappen: f.stappen as unknown as Record<string, unknown>[],
        uitstap: f.uitstap as unknown as Record<string, unknown>,
        herhaalbaar: f.herhaalbaar, herhaalNaDagen: f.herhaalNaDagen,
        actief: false,
        aangemaaktDoor: "script",
      })
      .onConflictDoUpdate({
        target: emailFlows.slug,
        set: {
          naam: f.naam, omschrijving: f.omschrijving,
          triggerDoelgroepId: doelgroepId,
          stappen: f.stappen as unknown as Record<string, unknown>[],
          uitstap: f.uitstap as unknown as Record<string, unknown>,
          herhaalbaar: f.herhaalbaar, herhaalNaDagen: f.herhaalNaDagen,
          updatedAt: sql`now()`,
        },
      });
    console.log(`  ✓ ${f.slug.padEnd(24)} ${f.stappen.length} stappen${doelgroepId ? "" : "  (geen doelgroep)"}`);
  }

  // Tellen wie er in zou vallen — met alle flows nog uit, dus er vertrekt niets.
  const telling = await db.execute<{ slug: string; n: number }>(sql`
    select f.slug, count(*)::int n
    from email_flows f
    join audiences a on a.id = f.trigger_doelgroep_id
    join audience_members m on m.audience_id = a.id
    join customer_profiles p on p.customer_id = m.customer_id
    where p.email <> '' and p.nieuwsbrief <> 'unsubscribed'
      and (p.marketing_opt_in = true or p.nieuwsbrief = 'subscribed')
    group by 1 order by n desc
  `);
  console.log("\nZou instappen (bereikbare klanten in de trigger-doelgroep):");
  for (const r of telling.rows) console.log(`  ${r.slug.padEnd(24)} ${String(r.n).padStart(6)}`);
  console.log("\nAlle flows staan op INACTIEF. Zet ze één voor één aan als de aantallen kloppen.");
}
main().catch((e) => { console.error(e.message); process.exit(1); });
