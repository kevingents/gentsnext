import { createHash } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customerIdentities, customers, events } from "@/db/schema";

/**
 * Identiteitsgrafiek — wie is wie.
 *
 * Het probleem dat dit oplost: dezelfde persoon bestond in vier gedaanten die
 * elkaar niet kenden. Als uuid (orders, loyalty, kassabonnen), als
 * SRS-klantnummer (winkelhistorie), als los e-mailadres (tickets, retouren,
 * afspraken, nieuwsbrief) en als anonieme device-id (al het gedrag op de site).
 * Elke koppeling werd ergens ad hoc op e-mail gedaan, soms met een stille
 * terugval op "pak de eerste treffer" — waardoor een tweede klant met hetzelfde
 * adres andermans historie kon zien.
 *
 * Alle koppelingen lopen vanaf nu door dit bestand. Regels:
 *
 *  1. NORMALISEREN VOOR OPSLAG. Een e-mailadres is lowercase+trim, een
 *     telefoonnummer E.164. Doe je dat pas bij het zoeken, dan staat dezelfde
 *     persoon twee keer in de grafiek.
 *  2. EEN SLEUTEL HOORT BIJ ÉÉN KLANT. Botst een nieuwe koppeling met een
 *     bestaande, dan wint de bestaande en waarschuwen we. Stil overschrijven
 *     verhuist de historie van de vorige klant naar de nieuwe: een privacylek,
 *     geen datafoutje.
 *  3. HET VERLEDEN KLEURT MEE. Wordt een device bekend, dan krijgen ook de
 *     eerdere events van dat device de klant-id. Juist de oriëntatiesessie
 *     vóór het inloggen is het interessantst; die weggooien maakt het profiel
 *     structureel armer dan de werkelijkheid.
 */

export type IdentiteitSoort = "device" | "email" | "srs" | "phone" | "wallet" | "pos";

/** E-mail zoals we hem overal opslaan en zoeken. */
export function normEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase();
}

/**
 * Telefoonnummer naar E.164 (+31…). Nederland-eerst, omdat vrijwel alle
 * nummers hier vandaan komen; een nummer dat al met + begint laten we staan.
 * Onherkenbaar = lege string, want een half genormaliseerd nummer matcht
 * nergens en vervuilt alleen de grafiek.
 */
export function normPhone(raw: unknown): string {
  const s = String(raw ?? "").replace(/[^\d+]/g, "");
  if (!s) return "";
  if (s.startsWith("+")) return /^\+\d{8,15}$/.test(s) ? s : "";
  const d = s.replace(/\D/g, "");
  if (d.startsWith("0031")) return `+${d.slice(2)}`;
  if (d.startsWith("31") && d.length >= 11) return `+${d}`;
  if (d.startsWith("0")) return d.length >= 9 ? `+31${d.slice(1)}` : "";
  return "";
}

/**
 * SHA256-hex over een genormaliseerde waarde — het formaat dat Meta en Google
 * Ads verwachten voor klantmatching. Beide platforms schrijven voor: eerst
 * normaliseren (trim, lowercase, geen spaties), dán hashen. Hashen zonder
 * normaliseren levert een geldige hash op die nergens matcht, en dat merk je
 * pas aan een matchpercentage van nul.
 */
export function sha256(raw: unknown): string {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "";
  return createHash("sha256").update(v, "utf8").digest("hex");
}

function normaliseer(kind: IdentiteitSoort, value: unknown): string {
  if (kind === "email") return normEmail(value);
  if (kind === "phone") return normPhone(value);
  return String(value ?? "").trim();
}

/**
 * Koppel één sleutel aan een klant. Idempotent: dezelfde koppeling nogmaals
 * leggen werkt alleen `lastSeen` bij.
 *
 * Retourneert `false` als de sleutel al aan een ándere klant hangt — de aanroeper
 * kan dan besluiten wat te doen (meestal: niets, en de bestaande koppeling
 * respecteren).
 */
export async function koppelIdentiteit(
  customerId: string,
  kind: IdentiteitSoort,
  value: unknown,
  opts: { zekerheid?: "zeker" | "afgeleid"; bron?: string } = {}
): Promise<boolean> {
  const v = normaliseer(kind, value);
  if (!customerId || !v) return false;
  const db = getDb();

  // Eén statement: invoegen, of bij botsing alleen bijwerken wanneer de rij al
  // van DEZE klant is. Een botsing met een andere klant raakt dus niets aan —
  // en `rowCount` vertelt ons meteen wat er gebeurde, zonder tweede query en
  // zonder race tussen lezen en schrijven.
  const res = await db.execute(sql`
    insert into ${customerIdentities} (customer_id, kind, value, zekerheid, bron)
    values (${customerId}::uuid, ${kind}, ${v}, ${opts.zekerheid ?? "zeker"}, ${opts.bron ?? ""})
    on conflict (kind, value) do update
      set last_seen = now(),
          zekerheid = case when ${customerIdentities.zekerheid} = 'afgeleid'
                           then excluded.zekerheid else ${customerIdentities.zekerheid} end
      where ${customerIdentities.customerId} = ${customerId}::uuid
    returning customer_id
  `);

  if (res.rows.length) return true;
  console.warn(`[identity] ${kind}=${v.slice(0, 40)} hangt al aan een andere klant — koppeling overgeslagen`);
  return false;
}

/** Zoek de klant achter een sleutel. Null als de sleutel onbekend is. */
export async function klantVoorIdentiteit(kind: IdentiteitSoort, value: unknown): Promise<string | null> {
  const v = normaliseer(kind, value);
  if (!v) return null;
  const db = getDb();
  const [row] = await db
    .select({ customerId: customerIdentities.customerId })
    .from(customerIdentities)
    .where(and(eq(customerIdentities.kind, kind), eq(customerIdentities.value, v)))
    .limit(1);
  return row?.customerId ?? null;
}

/**
 * Bind een device (het anonieme gents-sid) aan een klant en kleur zijn verleden
 * in. Aanroepen bij inloggen, bij het afronden van een bestelling en bij het
 * koppelen van een bon aan de kassa.
 *
 * De backfill is gekapt op 180 dagen: verder terug is het device meestal al een
 * ander apparaat of een gewiste browser, en de rij-update over de hele
 * events-tabel zou onnodig zwaar worden. Alleen rijen die nog NULL zijn worden
 * geraakt, zodat een device dat ooit van iemand anders was niet stilletjes
 * wordt overgeschreven.
 */
export async function koppelDevice(
  customerId: string,
  sessionId: string,
  bron = ""
): Promise<{ gekoppeld: boolean; events: number }> {
  const sid = String(sessionId || "").trim();
  if (!customerId || !sid) return { gekoppeld: false, events: 0 };

  const gekoppeld = await koppelIdentiteit(customerId, "device", sid, { bron });
  if (!gekoppeld) return { gekoppeld: false, events: 0 };

  const db = getDb();
  const res = await db
    .update(events)
    .set({ customerId })
    .where(
      and(
        eq(events.sessionId, sid),
        isNull(events.customerId),
        sql`${events.createdAt} > now() - interval '180 days'`
      )
    );
  return { gekoppeld: true, events: Number((res as { rowCount?: number }).rowCount ?? 0) };
}

/**
 * Alles wat we van een klant weten in één keer koppelen. Aanroepen zodra een
 * klant wordt aangemaakt of zijn gegevens wijzigen, zodat de grafiek niet
 * achterloopt op de klantkaart.
 */
export async function synchroniseerKlantIdentiteiten(customerId: string, bron = "profiel"): Promise<void> {
  const db = getDb();
  const [c] = await db
    .select({ email: customers.email, phone: customers.phone, srs: customers.srsCustomerId })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!c) return;
  await Promise.all([
    koppelIdentiteit(customerId, "email", c.email, { bron }),
    c.phone ? koppelIdentiteit(customerId, "phone", c.phone, { bron }) : Promise.resolve(false),
    c.srs ? koppelIdentiteit(customerId, "srs", c.srs, { bron }) : Promise.resolve(false),
  ]);
}

/**
 * Alle sleutels van een klant — voor de klantkaart in de portal ("op welke
 * manieren kennen we deze persoon") en voor de doelgroep-uitlevering, die zowel
 * e-mail als telefoon meestuurt om het matchpercentage te verhogen.
 */
export async function identiteitenVanKlant(customerId: string) {
  const db = getDb();
  return db
    .select({
      kind: customerIdentities.kind,
      value: customerIdentities.value,
      zekerheid: customerIdentities.zekerheid,
      bron: customerIdentities.bron,
      firstSeen: customerIdentities.firstSeen,
      lastSeen: customerIdentities.lastSeen,
    })
    .from(customerIdentities)
    .where(eq(customerIdentities.customerId, customerId))
    .orderBy(customerIdentities.kind, customerIdentities.firstSeen);
}
