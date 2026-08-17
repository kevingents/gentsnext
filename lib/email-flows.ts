import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, emailFlowLeden, emailFlowStappen, emailFlows, customerProfiles } from "@/db/schema";
import { definitieNaarSql, type RegelGroep } from "@/lib/audience-regels";
import { sendFlowEmail, type FlowSjabloon } from "@/lib/email-flow-sjablonen";

/**
 * E-mailflows (journeys): trigger → wachten → mail → vertakken → uitstappen.
 *
 * Wat we hadden waren losse mails: 16 transactionele (orderbevestiging, retour,
 * afspraak) plus één geplande (verjaardag). Dus WIE (doelgroepen) en WAT
 * (sjablonen), maar niet WANNEER en in welke VOLGORDE — en vooral niet wanneer
 * iemand er weer uit moet.
 *
 * ── Waarom uitstapregels de kern zijn ────────────────────────────────────
 * "Je vergat iets in je winkelwagen" twee dagen ná de aankoop is erger dan
 * niets sturen: de klant ziet dat je niet weet wat hij deed. Daarom wordt de
 * uitstapregel geëvalueerd vóór ÉLKE stap, niet alleen bij het instappen.
 *
 * ── Frequentieplafond ────────────────────────────────────────────────────
 * Vier flows die alle vier vandaag iets te melden hebben, sturen samen vier
 * mails. Dat is hoe je afmeldingen kweekt. Er gaat daarom nooit meer dan één
 * flow-mail per klant per etmaal uit; de rest schuift op. Transactionele mails
 * (orderbevestiging) vallen hier bewust buiten — die verwacht de klant.
 */

/** Eén etmaal tussen twee flow-mails naar dezelfde klant. */
const MIN_UREN_TUSSEN_MAILS = 24;

export type Stap =
  | { soort: "wacht"; uren: number }
  | { soort: "mail"; sjabloon: FlowSjabloon; onderwerp?: string }
  /** Klopt de regel? Dan door naar `danNaarStap`, anders gewoon de volgende. */
  | { soort: "voorwaarde"; regel: RegelGroep; danNaarStap: number };

export type FlowResultaat = {
  ingestapt: number;
  stappen: number;
  mails: number;
  uitgestapt: number;
  klaar: number;
  uitgesteld: number;
};

/* ─────────────────────────────── Instappen ──────────────────────────────── */

/**
 * Zet klanten in een flow die er volgens de trigger in horen.
 *
 * Alleen `doelgroep`-triggers doen hier iets: die zijn een SELECTIE, dus je
 * kunt periodiek kijken wie er nieuw in valt. Gebeurtenis-triggers worden
 * rechtstreeks aangeroepen op het moment zelf (zie `startFlowVoorKlant`).
 */
export async function vulFlow(flowId: string): Promise<number> {
  const db = getDb();
  const [flow] = await db.select().from(emailFlows).where(eq(emailFlows.id, flowId)).limit(1);
  if (!flow || !flow.actief || flow.triggerSoort !== "doelgroep" || !flow.triggerDoelgroepId) return 0;

  const [doelgroep] = await db
    .select({ definitie: sql<unknown>`definitie` })
    .from(sql`audiences`)
    .where(sql`id = ${flow.triggerDoelgroepId}::uuid`)
    .limit(1);
  if (!doelgroep) return 0;

  const waar = definitieNaarSql(doelgroep.definitie as RegelGroep);
  const herhaalVenster = flow.herhaalbaar
    ? sql`and not exists (
        select 1 from ${emailFlowLeden} l
        where l.flow_id = ${flowId}::uuid and l.customer_id = p.customer_id
          and l.ingestapt_op > now() - make_interval(days => ${flow.herhaalNaDagen})
      )`
    : sql`and not exists (
        select 1 from ${emailFlowLeden} l
        where l.flow_id = ${flowId}::uuid and l.customer_id = p.customer_id
      )`;

  const res = await db.execute(sql`
    insert into ${emailFlowLeden} (flow_id, customer_id, stap, status, volgende_stap_op)
    select ${flowId}::uuid, p.customer_id, 0, 'loopt', now()
    from ${customerProfiles} p
    where ${waar}
      -- Bereikbaar: dezelfde regel als bij de doelgroepen. Iemand zonder
      -- toestemming laten we niet eens instappen, dan kan hij ook nooit per
      -- ongeluk een stap krijgen.
      and p.email <> '' and p.nieuwsbrief <> 'unsubscribed'
      and (p.marketing_opt_in = true or p.nieuwsbrief = 'subscribed')
      ${herhaalVenster}
    on conflict do nothing
  `);
  return Number((res as { rowCount?: number }).rowCount ?? 0);
}

/** Instappen op een gebeurtenis (aankoop, kar verlaten, account aangemaakt). */
export async function startFlowVoorKlant(slug: string, customerId: string): Promise<boolean> {
  const db = getDb();
  const [flow] = await db.select().from(emailFlows).where(eq(emailFlows.slug, slug)).limit(1);
  if (!flow?.actief) return false;

  const res = await db.execute(sql`
    insert into ${emailFlowLeden} (flow_id, customer_id, stap, status, volgende_stap_op)
    select ${flow.id}::uuid, ${customerId}::uuid, 0, 'loopt', now()
    where exists (
      select 1 from ${customerProfiles} p
      where p.customer_id = ${customerId}::uuid
        and p.email <> '' and p.nieuwsbrief <> 'unsubscribed'
        and (p.marketing_opt_in = true or p.nieuwsbrief = 'subscribed')
    )
    ${
      flow.herhaalbaar
        ? sql`and not exists (
            select 1 from ${emailFlowLeden} l
            where l.flow_id = ${flow.id}::uuid and l.customer_id = ${customerId}::uuid
              and l.ingestapt_op > now() - make_interval(days => ${flow.herhaalNaDagen}))`
        : sql`and not exists (
            select 1 from ${emailFlowLeden} l
            where l.flow_id = ${flow.id}::uuid and l.customer_id = ${customerId}::uuid)`
    }
    on conflict do nothing
  `);
  return Number((res as { rowCount?: number }).rowCount ?? 0) > 0;
}

/* ──────────────────────────────── De loper ──────────────────────────────── */

/**
 * Voer alle stappen uit die aan de beurt zijn.
 *
 * Volgorde per lid, en die volgorde is niet willekeurig:
 *   1. UITSTAPREGEL. Eerst kijken of hij er nog in hoort. Kocht hij inmiddels,
 *      dan is elke volgende mail schade.
 *   2. FREQUENTIEPLAFOND. Al een flow-mail vandaag? Dan schuift deze stap op
 *      in plaats van dat hij vervalt — anders mist de klant hem voorgoed.
 *   3. De stap zelf.
 */
export async function loopFlows(maxLeden = 500): Promise<FlowResultaat> {
  const db = getDb();
  const uit: FlowResultaat = { ingestapt: 0, stappen: 0, mails: 0, uitgestapt: 0, klaar: 0, uitgesteld: 0 };

  const leden = await db.execute<{
    id: string; flow_id: string; customer_id: string; stap: number;
    stappen: Stap[]; uitstap: RegelGroep; email: string; voornaam: string;
  }>(sql`
    select l.id, l.flow_id, l.customer_id, l.stap,
           f.stappen, f.uitstap, p.email, c.first_name voornaam
    from ${emailFlowLeden} l
    join ${emailFlows} f on f.id = l.flow_id and f.actief = true
    join ${customerProfiles} p on p.customer_id = l.customer_id
    join ${customers} c on c.id = l.customer_id
    where l.status = 'loopt' and l.volgende_stap_op <= now()
    order by l.volgende_stap_op asc
    limit ${maxLeden}
  `);

  for (const lid of leden.rows) {
    const stappen = Array.isArray(lid.stappen) ? lid.stappen : [];

    // 1. Hoort hij er nog in?
    const uitstapRegel = lid.uitstap as RegelGroep | null;
    if (uitstapRegel?.regels?.length) {
      const check = await db.execute<{ raak: boolean }>(sql`
        select true raak from ${customerProfiles} p
        where p.customer_id = ${lid.customer_id}::uuid and ${definitieNaarSql(uitstapRegel)}
      `);
      if (check.rows.length) {
        await db
          .update(emailFlowLeden)
          .set({ status: "uitgestapt", redenUitstap: "uitstapregel", afgerondOp: sql`now()` })
          .where(eq(emailFlowLeden.id, lid.id));
        uit.uitgestapt++;
        continue;
      }
    }

    // Klaar?
    if (lid.stap >= stappen.length) {
      await db
        .update(emailFlowLeden)
        .set({ status: "klaar", afgerondOp: sql`now()` })
        .where(eq(emailFlowLeden.id, lid.id));
      uit.klaar++;
      continue;
    }

    const stap = stappen[lid.stap];

    if (stap.soort === "wacht") {
      await db
        .update(emailFlowLeden)
        .set({ stap: lid.stap + 1, volgendeStapOp: sql`now() + make_interval(hours => ${Math.max(0, stap.uren)})` })
        .where(eq(emailFlowLeden.id, lid.id));
      uit.stappen++;
      continue;
    }

    if (stap.soort === "voorwaarde") {
      const raak = await db.execute(sql`
        select 1 from ${customerProfiles} p
        where p.customer_id = ${lid.customer_id}::uuid and ${definitieNaarSql(stap.regel)}
      `);
      const naar = raak.rows.length ? Math.max(0, stap.danNaarStap) : lid.stap + 1;
      await db
        .update(emailFlowLeden)
        .set({ stap: naar, volgendeStapOp: sql`now()` })
        .where(eq(emailFlowLeden.id, lid.id));
      uit.stappen++;
      continue;
    }

    if (stap.soort === "mail") {
      // 2. Frequentieplafond — over álle flows heen, niet alleen deze.
      const recent = await db.execute(sql`
        select 1 from ${emailFlowStappen}
        where customer_id = ${lid.customer_id}::uuid and soort = 'mail' and gelukt = true
          and uitgevoerd_op > now() - make_interval(hours => ${MIN_UREN_TUSSEN_MAILS})
        limit 1
      `);
      if (recent.rows.length) {
        // Opschuiven, niet overslaan: de klant moet hem alsnog krijgen.
        await db
          .update(emailFlowLeden)
          .set({ volgendeStapOp: sql`now() + make_interval(hours => ${MIN_UREN_TUSSEN_MAILS})` })
          .where(eq(emailFlowLeden.id, lid.id));
        uit.uitgesteld++;
        continue;
      }

      // 3. Eerst de stap CLAIMEN, dan pas mailen. Andersom stuur je bij een
      //    crash tussen versturen en vastleggen morgen dezelfde mail nog eens.
      const claim = await db
        .insert(emailFlowStappen)
        .values({
          lidId: lid.id, flowId: lid.flow_id, customerId: lid.customer_id,
          stap: lid.stap, soort: "mail", sjabloon: stap.sjabloon,
        })
        .onConflictDoNothing()
        .returning({ id: emailFlowStappen.id });
      if (!claim.length) {
        // Al eens gedaan — doorschuiven zonder opnieuw te sturen.
        await db
          .update(emailFlowLeden)
          .set({ stap: lid.stap + 1, volgendeStapOp: sql`now()` })
          .where(eq(emailFlowLeden.id, lid.id));
        continue;
      }

      const ok = await sendFlowEmail(stap.sjabloon, lid.email, lid.voornaam || "", lid.customer_id).catch(() => false);
      if (!ok) {
        // Mislukt: claim terugdraaien en het over een uur opnieuw proberen. Een
        // tijdelijke storing mag geen stap kosten.
        await db.delete(emailFlowStappen).where(eq(emailFlowStappen.id, claim[0].id));
        await db
          .update(emailFlowLeden)
          .set({ volgendeStapOp: sql`now() + interval '1 hour'` })
          .where(eq(emailFlowLeden.id, lid.id));
        continue;
      }

      uit.mails++;
      uit.stappen++;
      await db
        .update(emailFlowLeden)
        .set({ stap: lid.stap + 1, volgendeStapOp: sql`now()` })
        .where(eq(emailFlowLeden.id, lid.id));
    }
  }

  return uit;
}

/** Alle actieve doelgroep-flows bijvullen. */
export async function vulAlleFlows(): Promise<number> {
  const db = getDb();
  const lijst = await db
    .select({ id: emailFlows.id })
    .from(emailFlows)
    .where(and(eq(emailFlows.actief, true), eq(emailFlows.triggerSoort, "doelgroep")));
  let n = 0;
  for (const f of lijst) n += await vulFlow(f.id).catch(() => 0);
  return n;
}
