import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { audiences, audienceMembers, customerProfiles } from "@/db/schema";
import { definitieNaarSql, valideerDefinitie, type RegelGroep } from "@/lib/audience-regels";

/**
 * Doelgroepen: opslaan, tellen, bouwen en uitlezen.
 *
 * Het onderscheid dat er echt toe doet is `aantal` versus `aantalBereikbaar`.
 * Een doelgroep van 4.000 klanten waarvan er 900 marketing-toestemming hebben
 * is geen doelgroep van 4.000. Dat verschil hoort in het scherm te staan vóór
 * iemand een campagne inplant, niet achteraf in een rapportage — anders wordt
 * elke campagne op de verkeerde verwachting begroot.
 */

export type AudienceInvoer = {
  slug?: string;
  naam: string;
  omschrijving?: string;
  definitie: RegelGroep;
  soort?: "dynamisch" | "statisch";
  actief?: boolean;
  kanalen?: Record<string, unknown>;
};

/**
 * Bereikbaar = we mogen én kunnen deze klant benaderen. Toestemming is hier
 * hard: `marketing_opt_in` OF een bevestigde nieuwsbriefinschrijving. Een
 * uitschrijving telt nooit mee, ook niet als de klant ooit opt-in gaf — de
 * laatste keuze wint, altijd.
 */
const BEREIKBAAR = sql`
  p.email <> ''
  and p.nieuwsbrief <> 'unsubscribed'
  and (p.marketing_opt_in = true or p.nieuwsbrief = 'subscribed')`;

export async function telDoelgroep(definitie: RegelGroep | null): Promise<{ aantal: number; bereikbaar: number }> {
  const db = getDb();
  const waar = definitieNaarSql(definitie);
  const rows = await db.execute<{ aantal: number; bereikbaar: number }>(sql`
    select count(*)::int aantal,
           count(*) filter (where ${BEREIKBAAR})::int bereikbaar
    from ${customerProfiles} p
    where ${waar}
  `);
  return { aantal: rows.rows[0]?.aantal ?? 0, bereikbaar: rows.rows[0]?.bereikbaar ?? 0 };
}

/** Voorbeeld van wie erin valt — zodat je een regel kunt controleren vóór je hem bewaart. */
export async function voorbeeldLeden(definitie: RegelGroep | null, limiet = 12) {
  const db = getDb();
  const waar = definitieNaarSql(definitie);
  const rows = await db.execute<{
    customer_id: string; email: string; segment: string; kanaal: string;
    besteed_totaal_cents: number; orders_totaal: number; dagen_sinds_aankoop: number | null;
    bereikbaar: boolean;
  }>(sql`
    select p.customer_id, p.email, p.segment, p.kanaal, p.besteed_totaal_cents,
           p.orders_totaal, p.dagen_sinds_aankoop, (${BEREIKBAAR}) bereikbaar
    from ${customerProfiles} p
    where ${waar}
    order by p.besteed_totaal_cents desc
    limit ${limiet}
  `);
  return rows.rows;
}

function maakSlug(naam: string): string {
  return (
    naam
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "doelgroep"
  );
}

export async function bewaarDoelgroep(invoer: AudienceInvoer, door = "") {
  const fouten = valideerDefinitie(invoer.definitie);
  if (fouten.length) throw new Error(fouten.join(" "));

  const db = getDb();
  const slug = invoer.slug || maakSlug(invoer.naam);
  const telling = await telDoelgroep(invoer.definitie);

  const [rij] = await db
    .insert(audiences)
    .values({
      slug,
      naam: invoer.naam.slice(0, 120),
      omschrijving: (invoer.omschrijving || "").slice(0, 500),
      definitie: invoer.definitie as unknown as Record<string, unknown>,
      soort: invoer.soort ?? "dynamisch",
      actief: invoer.actief ?? true,
      kanalen: (invoer.kanalen ?? {}) as Record<string, unknown>,
      aantal: telling.aantal,
      aantalBereikbaar: telling.bereikbaar,
      aangemaaktDoor: door.slice(0, 120),
    })
    .onConflictDoUpdate({
      target: audiences.slug,
      set: {
        naam: invoer.naam.slice(0, 120),
        omschrijving: (invoer.omschrijving || "").slice(0, 500),
        definitie: invoer.definitie as unknown as Record<string, unknown>,
        soort: invoer.soort ?? "dynamisch",
        actief: invoer.actief ?? true,
        kanalen: (invoer.kanalen ?? {}) as Record<string, unknown>,
        aantal: telling.aantal,
        aantalBereikbaar: telling.bereikbaar,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  return rij;
}

/**
 * Zet de leden van een dynamische doelgroep vast.
 *
 * Waarom we de leden bewaren en niet elke keer opnieuw berekenen: een
 * uitlevering naar Meta of Google moet het VERSCHIL kennen met de vorige keer
 * (wie erbij, wie eraf), en dat kan alleen als je weet wie er vorige keer in
 * zat. Een doelgroep die telkens volledig opnieuw wordt geüpload verliest bij
 * elk platform zijn leergeschiedenis.
 *
 * Statische doelgroepen worden bewust overgeslagen: die zijn ooit vastgezet en
 * moeten niet vanzelf meebewegen.
 */
export async function bouwDoelgroep(audienceId: string): Promise<{ aantal: number; bereikbaar: number }> {
  const db = getDb();
  const [a] = await db.select().from(audiences).where(eq(audiences.id, audienceId)).limit(1);
  if (!a) throw new Error("Doelgroep bestaat niet");
  if (a.soort === "statisch") {
    const [n] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(audienceMembers)
      .where(eq(audienceMembers.audienceId, audienceId));
    return { aantal: n?.n ?? 0, bereikbaar: a.aantalBereikbaar };
  }

  const waar = definitieNaarSql(a.definitie as unknown as RegelGroep);

  // Toevoegen wat nieuw is, verwijderen wat niet meer past — in twee statements
  // in plaats van "alles weg, alles opnieuw". Dat scheelt niet alleen schrijven,
  // het houdt ook `toegevoegd_op` intact, en dát is wat een campagne nodig heeft
  // om "sinds wanneer zit deze klant erin" te kunnen zeggen.
  await db.execute(sql`
    insert into ${audienceMembers} (audience_id, customer_id)
    select ${audienceId}::uuid, p.customer_id from ${customerProfiles} p where ${waar}
    on conflict (audience_id, customer_id) do nothing
  `);
  await db.execute(sql`
    delete from ${audienceMembers} m
    where m.audience_id = ${audienceId}::uuid
      and not exists (
        select 1 from ${customerProfiles} p where p.customer_id = m.customer_id and ${waar}
      )
  `);

  const telling = await telDoelgroep(a.definitie as unknown as RegelGroep);
  await db
    .update(audiences)
    .set({ aantal: telling.aantal, aantalBereikbaar: telling.bereikbaar, laatstGebouwd: sql`now()`, updatedAt: sql`now()` })
    .where(eq(audiences.id, audienceId));
  return telling;
}

export async function bouwAlleDoelgroepen(): Promise<{ slug: string; aantal: number }[]> {
  const db = getDb();
  const lijst = await db.select().from(audiences).where(eq(audiences.actief, true));
  const uit: { slug: string; aantal: number }[] = [];
  for (const a of lijst) {
    try {
      const t = await bouwDoelgroep(a.id);
      uit.push({ slug: a.slug, aantal: t.aantal });
    } catch (e) {
      console.warn(`[doelgroep] ${a.slug} bouwen mislukt:`, e instanceof Error ? e.message : e);
    }
  }
  return uit;
}

export async function lijstDoelgroepen() {
  const db = getDb();
  return db.select().from(audiences).orderBy(desc(audiences.updatedAt));
}

export async function haalDoelgroep(idOfSlug: string) {
  const db = getDb();
  const opId = /^[0-9a-f-]{36}$/i.test(idOfSlug);
  const [rij] = await db
    .select()
    .from(audiences)
    .where(opId ? eq(audiences.id, idOfSlug) : eq(audiences.slug, idOfSlug))
    .limit(1);
  return rij ?? null;
}

export async function verwijderDoelgroep(id: string) {
  const db = getDb();
  await db.delete(audiences).where(eq(audiences.id, id));
}

/**
 * De leden mét hun gehashte identifiers — dit is wat naar de kanalen gaat.
 *
 * `alleenBereikbaar` staat standaard AAN. Een doelgroep uitleveren naar een
 * advertentieplatform is een verwerking van persoonsgegevens; klanten zonder
 * toestemming horen daar niet in, ook niet "voor de match". Wie bewust een
 * volledige export wil (bijvoorbeeld voor een interne analyse) moet dat
 * expliciet vragen.
 */
export async function ledenVoorUitlevering(audienceId: string, alleenBereikbaar = true) {
  const db = getDb();
  const rows = await db.execute<{
    customer_id: string; email: string; email_sha256: string;
    phone_e164: string; phone_sha256: string;
    voornaam_sha256: string; achternaam_sha256: string;
    postcode: string; plaats: string; land: string;
    besteed_totaal_cents: number; segment: string;
  }>(sql`
    select p.customer_id, p.email, p.email_sha256, p.phone_e164, p.phone_sha256,
           p.voornaam_sha256, p.achternaam_sha256, p.postcode, p.plaats, p.land,
           p.besteed_totaal_cents, p.segment
    from ${audienceMembers} m
    join ${customerProfiles} p on p.customer_id = m.customer_id
    where m.audience_id = ${audienceId}::uuid
      ${alleenBereikbaar ? sql`and ${BEREIKBAAR}` : sql``}
      and p.email_sha256 <> ''
  `);
  return rows.rows;
}
