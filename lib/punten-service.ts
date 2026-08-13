/**
 * lib/punten-service.ts
 *
 * Klantenservice: met de hand punten toekennen als coulance. Een klacht die je
 * met punten oplost kost minder dan een retour, en de klant houdt een reden om
 * terug te komen — dat is precies wat een tegoedbon niet doet.
 *
 * DRIE DINGEN DIE HIER ANDERS ZIJN DAN BIJ DE ANDERE PUNTEN:
 *
 * 1. De tekst in het grootboek is KLANTGERICHT. `loyalty_events.reason` staat in
 *    het puntenoverzicht van de klant zelf; een interne notitie hoort daar niet.
 *    De echte reden en wie het deed gaan naar loyalty_service_grants.
 * 2. Direct besteedbaar (geen vesting). Er hangt geen aankoop aan die
 *    teruggestuurd kan worden, dus er valt niets terug te draaien.
 * 3. Er zit een dak op per keer (instelbaar). Wie meer wil geven doet het twee
 *    keer — en dan staat het ook twee keer in het logboek.
 *
 * LET OP — dit boekt in het ACCOUNT-grootboek (loyalty_events), het saldo dat de
 * klant op gents.nl ziet en kan inwisselen voor een tegoedbon. De kassa heeft
 * een eigen grootboek (lib/loyalty-core); die twee zijn nog niet samengevoegd.
 * Coulancepunten zijn dus online besteedbaar, aan de kassa (nog) niet.
 */
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, loyaltyServiceGrants } from "@/db/schema";
import { creditBonusOnce } from "@/lib/loyalty-claim";
import { getSettings } from "@/lib/settings";

/** Wat de klant in z'n eigen puntenoverzicht ziet staan. Bewust neutraal. */
const KLANT_TEKST = "Attentie van onze klantenservice";

export type ServiceResultaat = { ok: boolean; punten?: number; saldo?: number; error?: string };

export async function kenServicePuntenToe(input: {
  customerId: string;
  punten: number;
  /** Interne reden — verplicht, en niet zichtbaar voor de klant. */
  reden: string;
  /** Wie het doet. Verplicht: zonder naam is het logboek waardeloos. */
  actor: string;
  ticketId?: string;
  /** Sleutel tegen dubbelklikken; laat leeg voor de automatische variant. */
  sleutel?: string;
}): Promise<ServiceResultaat> {
  const cid = String(input.customerId || "").trim();
  const reden = String(input.reden || "").trim();
  const actor = String(input.actor || "").trim();
  const punten = Math.round(Number(input.punten) || 0);

  if (!cid) return { ok: false, error: "Geen klant gekozen." };
  if (!actor) return { ok: false, error: "Onbekende medewerker — opnieuw inloggen." };
  /* Een reden afdwingen is geen formaliteit: zonder reden is achteraf niet vast
     te stellen of dit coulance was of een gunst. Vijf tekens is laag genoeg om
     niet te irriteren en hoog genoeg om "ok" te weren. */
  if (reden.length < 5) return { ok: false, error: "Vul een reden in (minimaal 5 tekens)." };
  if (punten <= 0) return { ok: false, error: "Vul een aantal punten in." };

  const max = Math.max(0, Math.round(Number((await getSettings()).loyaltyConfig?.serviceMaxPerActie) || 0));
  if (max > 0 && punten > max) {
    return { ok: false, error: `Maximaal ${max} punten per keer. Meer nodig? Doe het in twee stappen.` };
  }

  const db = getDb();
  const [klant] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, cid)).limit(1);
  if (!klant) return { ok: false, error: "Klant niet gevonden." };

  /* Idempotentie. De aanroeper mag een eigen sleutel meegeven (het formulier
     maakt er één bij het openen). Zonder sleutel vallen we terug op een venster
     van 30 seconden per medewerker/klant/bedrag: dat vangt een dubbelklik of een
     herhaalde POST, terwijl een bewuste tweede toekenning later gewoon lukt. */
  const venster = Math.floor(Date.now() / 30000);
  const sleutel = String(input.sleutel || "").trim() || `${cid}:${actor}:${punten}:${venster}`;

  const res = await creditBonusOnce(cid, punten, KLANT_TEKST, `service_punten:${sleutel}`);
  if (!res.ok) return { ok: false, error: res.error || "Toekennen mislukt." };
  if (!res.points) {
    // Al geboekt onder dezelfde sleutel — geen tweede keer, en geen tweede logregel.
    return { ok: true, punten: 0, saldo: res.balance };
  }

  /* Logregel ná de bijschrijving: mislukt dít, dan heeft de klant z'n punten wel
     en missen we een regel — vervelend, maar beter dan een logregel zonder punten. */
  await db
    .insert(loyaltyServiceGrants)
    .values({ customerId: cid, points: punten, reason: reden.slice(0, 500), actor: actor.slice(0, 120), ticketId: String(input.ticketId || "").slice(0, 80) })
    .catch((e) => console.error("[punten-service] logregel mislukt:", e instanceof Error ? e.message : e));

  return { ok: true, punten, saldo: res.balance };
}

export type ServiceGrantRij = {
  id: string;
  customerId: string;
  points: number;
  reason: string;
  actor: string;
  ticketId: string;
  createdAt: string;
};

/** Het logboek van één klant — voor op de klantkaart in de portal. */
export async function serviceGrantsVanKlant(customerId: string, limit = 20): Promise<ServiceGrantRij[]> {
  const cid = String(customerId || "").trim();
  if (!cid) return [];
  const db = getDb();
  const rijen = await db
    .select()
    .from(loyaltyServiceGrants)
    .where(eq(loyaltyServiceGrants.customerId, cid))
    .orderBy(desc(loyaltyServiceGrants.createdAt))
    .limit(Math.max(1, Math.min(100, limit)));
  return rijen.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    points: r.points,
    reason: r.reason,
    actor: r.actor,
    ticketId: r.ticketId,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}
