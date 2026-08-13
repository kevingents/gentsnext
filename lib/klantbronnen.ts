import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, externeRetouren, mailEngagement } from "@/db/schema";
import { koppelIdentiteit } from "@/lib/identity";

/**
 * Ophalen van klantgegevens uit de systemen die storegents beheert.
 *
 * De clients voor SRS (SOAP) en Returnista wonen daar, met hun sleutels. Die
 * hier dupliceren zou twee kopieën van dezelfde integratie opleveren die op een
 * dag uit elkaar lopen, plus dezelfde secrets op twee plekken. We trekken dus
 * over de bestaande brug (STOREGENTS_API_URL + token).
 *
 * Zonder die env-vars doet dit niets en zégt het dat ook — een stille lege
 * lijst is hier het gevaarlijkst: dan lijkt het alsof er geen retouren zijn.
 */

/* Zelfde default als de helpdesk-brug in lib/helpdesk: de URL is geen geheim en
   verandert niet, dus die hoeft niemand te plakken. Alleen het TOKEN is een
   secret. Zonder die default zou een ontbrekende URL eruitzien als een
   ontbrekend secret, en ging Kevin op zoek naar een waarde die niet bestaat. */
const BASIS = (process.env.STOREGENTS_API_URL || "https://storegents.vercel.app").replace(/\/+$/, "");
/* STOREGENTS_PORTAL_SECRET is hetzelfde geheim als CUSTOMER_PORTAL_SECRET aan
   de storegents-kant. STORE_CORE_TOKEN werkt óók: dat is de gedeelde
   core-sleutel die beide kanten al hebben (storegents gebruikt 'm om ons te
   bellen, wij mogen 'm terug gebruiken). Scheelt een extra variabele. */
const TOKEN = process.env.STOREGENTS_PORTAL_SECRET || process.env.STORE_CORE_TOKEN || "";

export function bronnenGeconfigureerd(): boolean {
  return Boolean(BASIS && TOKEN);
}

/**
 * Ontdubbel op sleutel en houd de LAATSTE. Postgres weigert een INSERT ... ON
 * CONFLICT DO UPDATE waarin dezelfde sleutel twee keer voorkomt ("cannot affect
 * row a second time") — en dat is precies wat er gebeurt bij externe bronnen:
 * Returnista levert een rij per geretourneerd ARTIKEL (dus meerdere per
 * retouraanvraag) en Spotler kan hetzelfde adres in meerdere lijsten hebben.
 * De hele batch klapt dan, niet alleen de dubbele rij.
 */
function ontdubbel<T>(rijen: T[], sleutel: (r: T) => string): T[] {
  const perSleutel = new Map<string, T>();
  for (const r of rijen) perSleutel.set(sleutel(r), r);
  return [...perSleutel.values()];
}

/**
 * In stukken wegschrijven. Eén statement met duizenden rijen loopt tegen de
 * parameterlimiet van Postgres aan (65.535) en tegen de payloadgrens van de
 * HTTP-driver; bij een eerste vulling van tienduizenden contacten is dat geen
 * theorie.
 */
async function inStukken<T>(rijen: T[], grootte: number, doe: (deel: T[]) => Promise<unknown>): Promise<number> {
  let n = 0;
  for (let i = 0; i < rijen.length; i += grootte) {
    const deel = rijen.slice(i, i + grootte);
    await doe(deel);
    n += deel.length;
  }
  return n;
}

async function haal<T>(actie: string, params: Record<string, string> = {}): Promise<T> {
  if (!bronnenGeconfigureerd()) {
    throw new Error("STOREGENTS_PORTAL_SECRET (of STORE_CORE_TOKEN) ontbreekt.");
  }
  const qs = new URLSearchParams({ actie, ...params });
  const res = await fetch(`${BASIS}/api/klantdata?${qs}`, {
    headers: { "x-portal-secret": TOKEN, authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  const data = (await res.json().catch(() => null)) as { success?: boolean; message?: string } | null;
  if (!res.ok || !data?.success) {
    throw new Error(`klantdata/${actie}: ${res.status} ${data?.message || ""}`.trim());
  }
  return data as T;
}

/* ─────────────────────────── SRS-klantnummers ───────────────────────────── */

/**
 * Koppel webklanten aan hun SRS-klantnummer.
 *
 * Dit is de brug die er niet was: bij de meting had géén enkele van de 46.253
 * klanten een SRS-nummer, waardoor de hele winkelkant van het profiel leeg
 * bleef en `kanaal` bij vrijwel iedereen op "online" stond. Zonder deze
 * koppeling kan de SRS-winkelhistorie nooit landen.
 *
 * Matcht op e-mail. Dat is de enige sleutel die beide kanten hebben; een
 * mismatch (SRS kent een ander adres) blijft dus ongekoppeld, en dat is beter
 * dan gokken op naam of postcode — een verkeerd gekoppelde klant ziet andermans
 * aankopen.
 */
export async function koppelSrsKlantnummers(vanaf = "2015-01-01"): Promise<{
  opgehaald: number;
  gekoppeld: number;
  onbekend: number;
}> {
  const data = await haal<{ klanten: { srsCustomerId: string; email: string }[] }>("srs-klanten", { vanaf });
  const db = getDb();
  let gekoppeld = 0;
  let onbekend = 0;

  for (const k of data.klanten) {
    const email = k.email.trim().toLowerCase();
    if (!email || !k.srsCustomerId) continue;
    // Alleen zetten waar het nog leeg is: een bestaand nummer overschrijven zou
    // een handmatige correctie ongedaan maken.
    const rijen = await db
      .update(customers)
      .set({ srsCustomerId: k.srsCustomerId, updatedAt: sql`now()` })
      .where(sql`lower(${customers.email}) = ${email} and coalesce(${customers.srsCustomerId}, '') = ''`)
      .returning({ id: customers.id });

    if (rijen.length) {
      gekoppeld++;
      await koppelIdentiteit(rijen[0].id, "srs", k.srsCustomerId, { bron: "srs-koppeling" });
    } else {
      onbekend++;
    }
  }
  return { opgehaald: data.klanten.length, gekoppeld, onbekend };
}

/* ───────────────────────────── Returnista ───────────────────────────────── */

/**
 * Retouren mét reden ophalen. De reden is het hele punt: "te klein" vraagt om
 * beter maatadvies, "voldeed niet aan de verwachting" om betere foto's. Zonder
 * reden is een retour alleen een kostenpost waar je niets van leert.
 */
export async function haalReturnistaRetouren(dagen = 180): Promise<{ opgehaald: number; nieuw: number }> {
  const data = await haal<{
    retouren: {
      externId: string; orderRef: string; email: string; status: string;
      reden: string; toelichting: string; bedragCents: number;
      sku: string; maat: string; titel: string; aangemeldOp: string;
    }[];
  }>("returnista", { dagen: String(dagen) });

  if (!data.retouren.length) return { opgehaald: 0, nieuw: 0 };
  const db = getDb();

  // Klant-id's in één keer opzoeken: per retour een losse query zou bij een
  // eerste vulling van duizenden retouren duizenden roundtrips kosten.
  const adressen = [...new Set(data.retouren.map((r) => r.email))].filter(Boolean);
  const klantRijen = adressen.length
    ? await db.execute<{ id: string; email: string }>(sql`
        select id, lower(email) email from ${customers}
        where lower(email) in (${sql.join(adressen.map((e) => sql`${e}`), sql`, `)})`)
    : { rows: [] as { id: string; email: string }[] };
  const klantPerMail = new Map(klantRijen.rows.map((r) => [r.email, r.id]));

  const rijen = ontdubbel(
    data.retouren.map((r) => ({
      bron: "returnista",
      externId: r.externId,
      orderRef: r.orderRef.slice(0, 60),
      email: r.email,
      customerId: klantPerMail.get(r.email) ?? null,
      status: r.status.slice(0, 40),
      reden: r.reden.slice(0, 200),
      bedragCents: Math.max(0, Math.round(r.bedragCents || 0)),
      regels: [{ sku: r.sku, titel: r.titel, maat: r.maat, toelichting: r.toelichting }] as unknown as Record<string, unknown>[],
      aangemeldOp: r.aangemeldOp ? new Date(r.aangemeldOp) : null,
    })),
    (r) => r.externId,
  );

  const nieuw = await inStukken(rijen, 500, (deel) =>
    db
      .insert(externeRetouren)
      .values(deel)
      .onConflictDoUpdate({
        target: [externeRetouren.bron, externeRetouren.externId],
        set: {
          status: sql`excluded.status`,
          reden: sql`excluded.reden`,
          customerId: sql`coalesce(${externeRetouren.customerId}, excluded.customer_id)`,
          opgehaaldOp: sql`now()`,
        },
      }),
  );

  return { opgehaald: data.retouren.length, nieuw };
}

/* ────────────────────────────── Spotler ─────────────────────────────────── */

/**
 * Contacten en hun toestemmingsstand uit Spotler.
 *
 * Dit is de waardevolste informatie die we misten. Voor "mag ik deze klant
 * mailen" leunden we op `newsletter_subscribers` (drie rijen) en op een
 * opt-in-vlag die uit de Shopify-import kwam. Spotler is de plek waar de klant
 * daadwerkelijk op "uitschrijven" klikt — dat is de enige stand die telt, en we
 * kenden hem niet.
 *
 * Over de open- en klikcijfers ben ik eerlijk: die staan NIET in de
 * gedocumenteerde REST-API per contact. Veel MailPlus-inrichtingen zetten ze
 * wel als custom contact-property; de storegents-kant mapt een reeks
 * waarschijnlijke veldnamen en geeft daarnaast terug wélke velden dit account
 * per contact bijhoudt. Levert dat niets op, dan blijven de tellers 0 en zegt
 * `veldnamen` waarom — beter dan een koppeling die stil nullen produceert en
 * eruitziet alsof niemand ooit een mail opent.
 */
export async function haalSpotlerContacten(maxPaginas = 20): Promise<{
  opgehaald: number;
  afgekapt: boolean;
  veldnamen: string[];
  metEngagement: number;
  gekoppeld: number;
}> {
  const data = await haal<{
    aantal: number;
    afgekapt: boolean;
    veldnamen: string[];
    contacten: {
      email: string; afgemeld: boolean;
      verstuurd: number; geopend: number; geklikt: number; laatstGeopend: string;
    }[];
  }>("spotler", { maxPaginas: String(maxPaginas) });

  if (!data.contacten.length) {
    return { opgehaald: 0, afgekapt: data.afgekapt, veldnamen: data.veldnamen, metEngagement: 0, gekoppeld: 0 };
  }
  const db = getDb();

  const rijen = ontdubbel(
    data.contacten.map((c) => ({
      email: c.email,
      bron: "spotler",
      verstuurd: Math.max(0, Math.round(c.verstuurd || 0)),
      geopend: Math.max(0, Math.round(c.geopend || 0)),
      geklikt: Math.max(0, Math.round(c.geklikt || 0)),
      afgemeld: Boolean(c.afgemeld),
      laatstGeopend: c.laatstGeopend ? new Date(c.laatstGeopend) : null,
    })),
    (r) => r.email,
  );

  await inStukken(rijen, 500, (deel) =>
    db
      .insert(mailEngagement)
      .values(deel)
      .onConflictDoUpdate({
        target: mailEngagement.email,
        set: {
          verstuurd: sql`greatest(${mailEngagement.verstuurd}, excluded.verstuurd)`,
          geopend: sql`greatest(${mailEngagement.geopend}, excluded.geopend)`,
          geklikt: sql`greatest(${mailEngagement.geklikt}, excluded.geklikt)`,
          // De afmelding is de enige waarde die MAG terugvallen naar false: een
          // klant kan zich opnieuw inschrijven, en dan is de nieuwe stand leidend.
          afgemeld: sql`excluded.afgemeld`,
          laatstGeopend: sql`greatest(${mailEngagement.laatstGeopend}, excluded.laatst_geopend)`,
          bijgewerktOp: sql`now()`,
        },
      }),
  );

  // Klant-id's in één statement koppelen: per adres een losse query zou bij
  // tienduizenden contacten tienduizenden roundtrips kosten.
  const gekoppeld = await db.execute(sql`
    update ${mailEngagement} m set customer_id = c.id
    from ${customers} c
    where lower(c.email) = m.email and m.customer_id is null
  `);

  return {
    opgehaald: data.contacten.length,
    afgekapt: data.afgekapt,
    veldnamen: data.veldnamen,
    metEngagement: rijen.filter((r) => r.verstuurd > 0 || r.geopend > 0).length,
    gekoppeld: Number((gekoppeld as { rowCount?: number }).rowCount ?? 0),
  };
}

/**
 * Verrijk ONZE klanten met wat Spotler over hen weet — rollend, N per run.
 *
 * De richting is bewust omgedraaid. Eerst haalden we de Spotler-contactenlijst
 * op en matchten die tegen onze klanten. Dat werkt niet: `GET contact` geeft er
 * 250 terug en bladert niet (niet met `page`, niet met `start`). Met `page`
 * kwam twintig keer dezelfde pagina terug, wat las als "5.000 opgehaald" en tot
 * de conclusie leidde dat Spotler een heel ander klantbestand zou bevatten.
 * Het waren 250 mensen.
 *
 * Wíj weten wie onze klanten zijn. Dus vragen we per adres wat Spotler ervan
 * weet. Rollend, oudste bevraging eerst, zodat 48.000 klanten over een paar
 * dagen langskomen zonder de API te overladen — en zodat een nieuwe klant
 * vanzelf aan de beurt is.
 */
export async function verrijkViaSpotler(max = 500): Promise<{
  gevraagd: number;
  gevonden: number;
  onbekend: number;
  metVerjaardag: number;
}> {
  const db = getDb();

  // Klanten die we nog nooit (of het langst geleden) bij Spotler opvroegen.
  // NULLS FIRST zet de nooit-bevraagden vooraan; zonder die volgorde blijft de
  // eerste groep eeuwig aan de beurt en komt de rest nooit.
  const doel = await db.execute<{ email: string }>(sql`
    select lower(c.email) email
    from ${customers} c
    left join ${mailEngagement} m on m.email = lower(c.email)
    where trim(c.email) <> ''
    order by m.gezocht_op asc nulls first
    limit ${Math.min(2000, Math.max(1, max))}
  `);
  const adressen = doel.rows.map((r) => r.email).filter(Boolean);
  if (!adressen.length) return { gevraagd: 0, gevonden: 0, onbekend: 0, metVerjaardag: 0 };

  let gevonden = 0;
  let onbekend = 0;
  let metVerjaardag = 0;

  // Per 100 — dat is wat het endpoint accepteert, en het houdt de URL binnen
  // een redelijke lengte.
  for (let i = 0; i < adressen.length; i += 100) {
    const groep = adressen.slice(i, i + 100);
    const data = await haal<{
      gevraagd: number;
      onbekend: number;
      contacten: {
        email: string; afgemeld: boolean; verjaardag: string; geslacht: string;
        mobiel: string; taal: string;
      }[];
    }>("spotler-zoek", { emails: groep.join(",") });

    onbekend += data.onbekend ?? 0;
    const rijen = ontdubbel(
      data.contacten.map((c) => ({
        email: c.email,
        bron: "spotler",
        afgemeld: Boolean(c.afgemeld),
        // Een onbruikbare datum wordt null, geen 1970: een verkeerde verjaardag
        // levert een felicitatie op de verkeerde dag, en dat is erger dan geen.
        verjaardag: /^\d{4}-\d{2}-\d{2}/.test(c.verjaardag || "") ? c.verjaardag.slice(0, 10) : null,
        geslacht: (c.geslacht || "").slice(0, 20),
        mobiel: (c.mobiel || "").slice(0, 40),
        taal: (c.taal || "").slice(0, 10),
        gezochtOp: new Date(),
      })),
      (r) => r.email,
    );
    gevonden += rijen.length;
    metVerjaardag += rijen.filter((r) => r.verjaardag).length;

    if (rijen.length) {
      await inStukken(rijen, 500, (deel) =>
        db
          .insert(mailEngagement)
          .values(deel)
          .onConflictDoUpdate({
            target: mailEngagement.email,
            set: {
              afgemeld: sql`excluded.afgemeld`,
              verjaardag: sql`coalesce(excluded.verjaardag, ${mailEngagement.verjaardag})`,
              geslacht: sql`coalesce(nullif(excluded.geslacht, ''), ${mailEngagement.geslacht})`,
              mobiel: sql`coalesce(nullif(excluded.mobiel, ''), ${mailEngagement.mobiel})`,
              taal: sql`coalesce(nullif(excluded.taal, ''), ${mailEngagement.taal})`,
              gezochtOp: sql`now()`,
              bijgewerktOp: sql`now()`,
            },
          }),
      );
    }

    // Ook de NIET-gevonden adressen krijgen een stempel. Zonder dat blijven ze
    // elke run opnieuw vooraan staan en komt de rest van het bestand nooit aan
    // de beurt.
    await db.execute(sql`
      insert into ${mailEngagement} (email, bron, gezocht_op)
      select x.email, 'spotler', now()
      from (select unnest(array[${sql.join(groep.map((e) => sql`${e}`), sql`, `)}]::text[]) email) x
      on conflict (email) do update set gezocht_op = now()
    `);
  }

  await db.execute(sql`
    update ${mailEngagement} m set customer_id = c.id
    from ${customers} c
    where lower(c.email) = m.email and m.customer_id is null
  `);

  return { gevraagd: adressen.length, gevonden, onbekend, metVerjaardag };
}
