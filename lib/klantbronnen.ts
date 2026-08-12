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

const BASIS = (process.env.STOREGENTS_API_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.STOREGENTS_PORTAL_SECRET || process.env.STORE_CORE_TOKEN || "";

export function bronnenGeconfigureerd(): boolean {
  return Boolean(BASIS && TOKEN);
}

async function haal<T>(actie: string, params: Record<string, string> = {}): Promise<T> {
  if (!bronnenGeconfigureerd()) {
    throw new Error("STOREGENTS_API_URL + STOREGENTS_PORTAL_SECRET ontbreken.");
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

  const rijen = data.retouren.map((r) => ({
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
  }));

  const uit = await db
    .insert(externeRetouren)
    .values(rijen)
    .onConflictDoUpdate({
      target: [externeRetouren.bron, externeRetouren.externId],
      set: {
        status: sql`excluded.status`,
        reden: sql`excluded.reden`,
        customerId: sql`coalesce(${externeRetouren.customerId}, excluded.customer_id)`,
        opgehaaldOp: sql`now()`,
      },
    })
    .returning({ id: externeRetouren.id });

  return { opgehaald: data.retouren.length, nieuw: uit.length };
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

  const rijen = data.contacten.map((c) => ({
    email: c.email,
    bron: "spotler",
    verstuurd: Math.max(0, Math.round(c.verstuurd || 0)),
    geopend: Math.max(0, Math.round(c.geopend || 0)),
    geklikt: Math.max(0, Math.round(c.geklikt || 0)),
    afgemeld: Boolean(c.afgemeld),
    laatstGeopend: c.laatstGeopend ? new Date(c.laatstGeopend) : null,
  }));

  await db
    .insert(mailEngagement)
    .values(rijen)
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
    });

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
