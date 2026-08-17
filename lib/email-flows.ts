import { and, eq, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { audienceMembers, customers, emailFlowLeden, emailFlowStappen, emailFlows, customerProfiles, loyaltyEvents } from "@/db/schema";
import { definitieNaarSql, VELDEN, type RegelGroep } from "@/lib/audience-regels";
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
  | { soort: "voorwaarde"; regel: RegelGroep; danNaarStap: number }
  /**
   * Punten toekennen. Dit maakt van een mailreeks een programma: "een half jaar
   * niet geweest → 100 punten → mail die dat vertelt" is iets anders dan alleen
   * die mail. De reden staat in het puntenoverzicht van de klant, dus die is
   * klantzichtbaar en hoort in gewoon Nederlands.
   */
  | { soort: "punten"; punten: number; reden: string }
  /**
   * Lidmaatschap van een STATISCHE doelgroep aan- of uitzetten, en daarmee van
   * de Meta- en Google-doelgroepen die daaraan hangen. Zo stopt de advertentie
   * op de dag dat iemand koopt, in plaats van na de volgende sync-ronde.
   *
   * Bewust alleen statische doelgroepen: een dynamische wordt periodiek
   * herbouwd uit zijn regel, dus alles wat een flow erin zet is bij de eerste
   * herbouw weer weg. Dat zou stil misgaan, en dat is de ergste soort.
   */
  | { soort: "doelgroep"; doelgroepId: string; actie: "toevoegen" | "verwijderen" }
  /**
   * Wachten TOT een datum, in plaats van wachten ná een stap.
   *
   * "Wacht 72 uur" rekent vanaf het moment dat iemand instapte; daarmee kun je
   * geen enkel moment raken dat in de agenda van de klant staat. Veertien dagen
   * vóór zijn verjaardag een cadeaubon sturen is iets anders dan veertien dagen
   * nadat hij toevallig in een doelgroep viel.
   *
   * `jaarlijks` is voor datums die terugkomen (de verjaardag): dan pakken we de
   * eerstvolgende keer. Zonder dat is een datum die al voorbij is geen wachten
   * meer — dan gaat de klant meteen door naar de volgende stap, want blijven
   * staan tot volgend jaar is nooit wat iemand bedoelt.
   */
  | { soort: "wacht_tot"; veld: string; dagenVoor: number; jaarlijks: boolean };

/**
 * Naar de volgende stap, meteen. Stappen die niets naar de klant sturen mogen
 * elkaar in dezelfde ronde opvolgen — "geef punten, wacht een uur, mail" moet
 * je kunnen schrijven zonder dat het punten geven zelf een uur kost.
 */
async function schuifDoor(db: ReturnType<typeof getDb>, lidId: string, stap: number) {
  await db
    .update(emailFlowLeden)
    .set({ stap: stap + 1, volgendeStapOp: sql`now()` })
    .where(eq(emailFlowLeden.id, lidId));
}

export type FlowResultaat = {
  ingestapt: number;
  stappen: number;
  mails: number;
  uitgestapt: number;
  klaar: number;
  uitgesteld: number;
  /** Toegekende punten deze ronde — één getal, over alle flows heen. */
  punten: number;
};

/**
 * Zit deze klant in de controlegroep van deze flow?
 *
 * Niet met een muntje per instapronde, maar met een hash van (flow, klant). Dat
 * moet, om twee redenen:
 *
 *  1. Dezelfde klant krijgt bij een herhaalbare flow altijd dezelfde kant op.
 *     Iemand die de ene keer wél en de andere keer geen mail krijgt, zit in
 *     beide groepen en vervuilt de vergelijking.
 *  2. Het is reproduceerbaar. Bij een scheve verhouding kun je narekenen wie
 *     waar hoorde, in plaats van te moeten geloven dat het toeval was.
 *
 * De flow zit mee in de hash, zodat niet steeds dezelfde ongelukkigen in élke
 * controlegroep belanden.
 */
function holdoutStatus(flowId: string, procent: number, klantId: SQL) {
  const p = Math.min(50, Math.max(0, Math.round(procent || 0)));
  if (!p) return sql`'loopt'`;
  /* 24 bits, niet 32: bit(32) naar int is ONDERTEKEND, dus de helft van de
     hashes zou negatief worden en `negatief % 100 < p` klopt altijd — dan zat
     iedereen in de controlegroep. Met 24 bits past de waarde altijd positief. */
  return sql`case when ('x' || substr(md5(${flowId} || ${klantId}::text), 1, 6))::bit(24)::int % 100 < ${p} then 'holdout' else 'loopt' end`;
}

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
    select ${flowId}::uuid, p.customer_id, 0, ${holdoutStatus(flowId, flow.holdoutProcent, sql`p.customer_id`)}, now()
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
    select ${flow.id}::uuid, ${customerId}::uuid, 0, ${holdoutStatus(flow.id, flow.holdoutProcent, sql`${customerId}::uuid`)}, now()
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
  const uit: FlowResultaat = { ingestapt: 0, stappen: 0, mails: 0, uitgestapt: 0, klaar: 0, uitgesteld: 0, punten: 0 };

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

    if (stap.soort === "wacht_tot") {
      /* Alleen datumvelden uit de vaste veldenlijst — dezelfde deur als bij de
         doelgroepregels, zodat hier geen eigen kolomnaam naar binnen kan. */
      const veld = VELDEN.find((v) => v.key === stap.veld && v.type === "datum");
      if (!veld) {
        await schuifDoor(db, lid.id, lid.stap);
        uit.stappen++;
        continue;
      }
      const dagen = Math.max(0, Math.round(Number(stap.dagenVoor) || 0));
      const kolom = sql.raw(`p.${veld.kolom}`);
      /* De eerstvolgende keer dat die datum langskomt, min de dagen ervoor.
         Bij een jaarlijkse datum rolt hij door naar volgend jaar zodra het
         moment van dit jaar al geweest is. */
      const doel = await db.execute<{ moment: string | null }>(sql`
        select case
          when ${kolom} is null then null
          when ${stap.jaarlijks}::boolean then (
            case
              when make_date(extract(year from now())::int, extract(month from ${kolom})::int, extract(day from ${kolom})::int)
                   - ${dagen}::int >= current_date
              then make_date(extract(year from now())::int, extract(month from ${kolom})::int, extract(day from ${kolom})::int)
              else make_date(extract(year from now())::int + 1, extract(month from ${kolom})::int, extract(day from ${kolom})::int)
            end
          )::timestamptz
          else ${kolom}::timestamptz
        end - make_interval(days => ${dagen}::int) moment
        from ${customerProfiles} p where p.customer_id = ${lid.customer_id}::uuid
      `);
      const moment = doel.rows[0]?.moment ?? null;
      if (!moment || new Date(moment) <= new Date()) {
        // Geen datum bekend, of hij is al geweest: niet blijven staan.
        await schuifDoor(db, lid.id, lid.stap);
      } else {
        await db
          .update(emailFlowLeden)
          .set({ stap: lid.stap + 1, volgendeStapOp: sql`${moment}::timestamptz` })
          .where(eq(emailFlowLeden.id, lid.id));
      }
      uit.stappen++;
      continue;
    }

    /* Punten en doelgroepen vallen bewust BUITEN het frequentieplafond: dat
       plafond bestaat om postbussen te beschermen, en hier gaat er niets naar
       de klant. Punten die een dag blijven liggen omdat een andere flow toevallig
       gemaild heeft, is precies het soort stille vertraging dat niemand later
       nog kan verklaren. */
    if (stap.soort === "punten") {
      const n = Math.round(Number(stap.punten) || 0);
      if (!n) {
        await schuifDoor(db, lid.id, lid.stap);
        continue;
      }
      /* Idempotent via de bestaande unieke index op (ref_type, ref_id): één
         puntenmutatie per lid per stap. Herstart je de loper halverwege, dan
         boekt dezelfde stap niet nog eens. */
      const geboekt = await db
        .insert(loyaltyEvents)
        .values({
          customerId: lid.customer_id as string,
          points: n,
          // Klantzichtbaar — dit staat straks in zijn puntenoverzicht.
          reason: String(stap.reden || "Bonuspunten").slice(0, 200),
          refType: "flow_stap",
          refId: `${lid.id}:${lid.stap}`,
        })
        .onConflictDoNothing()
        .returning({ id: loyaltyEvents.id });
      if (geboekt.length) {
        await db
          .update(customers)
          .set({ loyaltyPoints: sql`coalesce(${customers.loyaltyPoints}, 0) + ${n}` })
          .where(eq(customers.id, lid.customer_id as string));
        await db
          .insert(emailFlowStappen)
          .values({ lidId: lid.id, flowId: lid.flow_id, customerId: lid.customer_id, stap: lid.stap, soort: "punten" })
          .onConflictDoNothing();
        uit.punten += n;
      }
      await schuifDoor(db, lid.id, lid.stap);
      uit.stappen++;
      continue;
    }

    if (stap.soort === "doelgroep") {
      if (stap.actie === "toevoegen") {
        await db
          .insert(audienceMembers)
          .values({ audienceId: stap.doelgroepId, customerId: lid.customer_id as string })
          .onConflictDoNothing();
      } else {
        await db
          .delete(audienceMembers)
          .where(
            and(
              eq(audienceMembers.audienceId, stap.doelgroepId),
              eq(audienceMembers.customerId, lid.customer_id as string)
            )
          );
      }
      await db
        .insert(emailFlowStappen)
        .values({ lidId: lid.id, flowId: lid.flow_id, customerId: lid.customer_id, stap: lid.stap, soort: "doelgroep" })
        .onConflictDoNothing();
      await schuifDoor(db, lid.id, lid.stap);
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

      /* Deze labels gaan mee naar Resend en komen terug in de webhook. Zonder
         hen is een "geopend"-melding een los feit: je weet dát er iets geopend
         is, niet welke stap van welke flow het deed. */
      const ok = await sendFlowEmail(stap.sjabloon, lid.email, lid.voornaam || "", lid.customer_id, {
        flow: String(lid.flow_id),
        flow_lid: String(lid.id),
        flow_stap: String(lid.stap),
        klant: String(lid.customer_id),
      }).catch(() => false);
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
