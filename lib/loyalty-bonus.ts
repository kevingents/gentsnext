/**
 * lib/loyalty-bonus.ts
 *
 * Eenmalige punten-bonussen die RETOUREN moeten terugdringen. Eén keer per
 * klant, direct besteedbaar:
 *
 *   account    → profiel aangemaakt, online (eerste bevestigde login) of aan de kassa
 *   maatadvies → de klant heeft z'n maten bewaard (via /maatadvies of Mijn maten)
 *   wallet     → de memberspas staat écht in Apple Wallet (device-registratie)
 *   winkel     → er staat een vaste winkel in het profiel
 *   profiel    → leeftijd, kleuren, vaste winkel en gelegenheden zijn ingevuld
 *
 * Waarom dit werkt tegen retouren: de duurste retour is "verkeerde maat besteld".
 * Wie z'n maat kent bestelt gerichter, en een compleet profiel laat ons in de
 * mail en op de site tonen wat er in zijn maat/kleur/winkel ligt.
 *
 * Idempotentie: het grootboek zelf is de guard. Elk event krijgt
 * refType = "bonus_…" met refId = het klant-id, en op (ref_type, ref_id) staat
 * een unieke index — twee gelijktijdige verzoeken kunnen dus niet dubbel
 * bijschrijven (neon-http kent geen transacties, dus de index dóét het werk).
 */
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { customers, loyaltyEvents } from "@/db/schema";
import { creditBonusOnce } from "@/lib/loyalty-claim";
import { getSettings, type Settings } from "@/lib/settings";
import { isProfileComplete, sizeProfileComplete, type ProfilePreferences } from "@/lib/profiel-voorkeuren";

export type BonusKind = "account" | BonusTaakKind;

/**
 * De TAKEN: dingen die een klant nog kán doen, in de volgorde waarin hij ze ziet.
 *
 * "account" hoort hier bewust niet bij, en het typesysteem houdt dat vast. Dat is
 * een gebeurtenis, geen taak: wie de accountpagina bekijkt hééft al een account,
 * dus als openstaand klusje zou hij er eeuwig blijven staan. Hij verschijnt
 * gewoon in de puntenhistorie.
 */
export type BonusTaakKind = "maatadvies" | "wallet" | "winkel" | "profiel";
export const BONUS_KINDS: BonusTaakKind[] = ["maatadvies", "wallet", "winkel", "profiel"];

/** Alles wat punten oplevert, inclusief de welkomstbonus — voor rapportage. */
export const ALLE_BONUSSEN: BonusKind[] = ["account", ...BONUS_KINDS];

/** refType per bonus. Vast — dit staat straks in het grootboek van elke klant. */
const REF_TYPE: Record<BonusKind, string> = {
  account: "bonus_account",
  maatadvies: "bonus_maatadvies",
  wallet: "bonus_wallet",
  winkel: "bonus_winkel",
  // Bestaande sleutel uit de "+50 punten"-mail: dezelfde bonus, dus dezelfde
  // refType. Zo kan niemand hem twee keer pakken (mail én zelf invullen).
  profiel: "profile_completion",
};

const REASON: Record<BonusKind, string> = {
  account: "Welkom bij GENTS",
  maatadvies: "Maatprofiel ingevuld",
  wallet: "Memberspas in Apple Wallet",
  winkel: "Vaste winkel gekozen",
  profiel: "Profiel afgerond",
};

/** Welke instelling hoort bij welke bonus. */
function bedrag(bp: Settings["loyaltyConfig"]["bonusPoints"] | undefined, kind: BonusKind): number {
  const val =
    kind === "account" ? bp?.accountCreated
    : kind === "maatadvies" ? bp?.sizeAdvice
    : kind === "wallet" ? bp?.walletPass
    : kind === "winkel" ? bp?.favoriteStore
    : bp?.profileComplete;
  return Math.max(0, Math.round(Number(val) || 0));
}

/** Wat deze bonus nu waard is (0 = uit). Instelbaar in de tool, niet in code. */
export async function bonusPointsFor(kind: BonusKind): Promise<number> {
  return bedrag((await getSettings()).loyaltyConfig?.bonusPoints, kind);
}

export type BonusResult = { awarded: boolean; points: number };

/**
 * Ken een bonus toe (of stel vast dat hij er al was). De aanroeper heeft de
 * VOORWAARDE al gecontroleerd — deze functie gaat alleen over de uitbetaling.
 * Nooit fataal: een mislukte bonus mag een profiel-opslag niet omgooien.
 */
export async function awardBonus(customerId: string, kind: BonusKind): Promise<BonusResult> {
  const cid = String(customerId || "").trim();
  if (!cid) return { awarded: false, points: 0 };
  try {
    const points = await bonusPointsFor(kind);
    if (points <= 0) return { awarded: false, points: 0 };

    /* De profielbonus bestond al vóór deze functie (de "+50 punten"-mail) en zette
       toen een vlag op de klant, met een grootboekregel ZONDER refId. Die oude
       regels vangt de unieke index niet, dus daar is de vlag de guard. */
    if (kind === "profiel" && (await profileBonusClaimed(cid))) return { awarded: false, points: 0 };

    const res = await creditBonusOnce(cid, points, REASON[kind], REF_TYPE[kind]);
    const awarded = Boolean(res.ok && res.points);
    if (awarded && kind === "profiel") await markProfileBonusClaimed(cid);
    return { awarded, points: awarded ? points : 0 };
  } catch (e) {
    console.error("[loyalty-bonus] toekennen mislukt:", kind, e instanceof Error ? e.message : e);
    return { awarded: false, points: 0 };
  }
}

async function profileBonusClaimed(customerId: string): Promise<boolean> {
  const db = getDb();
  const [c] = await db
    .select({ claimed: customers.profileCompletionBonusClaimed })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  return Boolean(c?.claimed);
}

/** Vlag zetten + het (nu overbodige) mail-token intrekken. */
export async function markProfileBonusClaimed(customerId: string): Promise<void> {
  const db = getDb();
  await db
    .update(customers)
    .set({ profileCompletionBonusClaimed: true, profileCompletionTokenHash: null })
    .where(eq(customers.id, customerId));
}

/* ── Voorwaarden per bonus ────────────────────────────────────────────────── */

type CustomerLike = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  sizeProfile?: unknown;
  preferences?: unknown;
  profileCompletionBonusClaimed?: boolean | null;
};

/**
 * Welkomstbonus bij het aanmaken van een profiel — online én aan de kassa.
 *
 * Bewust op twee plekken aangeroepen die allebei een ECHT nieuw account
 * betekenen: de eerste e-mailbevestiging (magic-link) en het aanmaken van een
 * klant vanaf de kassa. Niet bij `findOrCreateCustomer`: dat maakt al een rij
 * zodra iemand een adres intikt op het inlogformulier, dus dan kon je met
 * honderd verzonnen adressen honderd bonussen "verdienen" zonder ooit één
 * mailbox te openen. De unieke index op (ref_type, ref_id) zorgt dat een klant
 * die aan de kassa is aangemaakt en later online inlogt, hem één keer krijgt.
 *
 * Geen `IfEarned`-variant: de aanroeper wéét dat het account net is ontstaan.
 */
export async function awardAccountBonus(customerId: string): Promise<BonusResult> {
  return awardBonus(customerId, "account");
}

/** Bonus voor het maatprofiel — alleen als het profiel er ook écht staat. */
export async function awardSizeAdviceBonusIfEarned(c: CustomerLike): Promise<BonusResult> {
  if (!sizeProfileComplete(c.sizeProfile as Record<string, unknown>)) return { awarded: false, points: 0 };
  return awardBonus(c.id, "maatadvies");
}

/**
 * Bonus voor het kiezen van een vaste winkel. Aparte, kleine stap: het is één
 * klik, en hij levert meteen iets op (overal "ligt het in mijn winkel?"). De
 * winkel telt óók mee voor "profiel compleet" — dat is geen dubbeltelling maar
 * twee verschillende beloningen: de eerste stap en de hele set.
 */
export async function awardStoreBonusIfEarned(c: CustomerLike): Promise<BonusResult> {
  const prefs = (c.preferences || {}) as ProfilePreferences;
  if (!String(prefs.favoriteStore || "").trim()) return { awarded: false, points: 0 };
  return awardBonus(c.id, "winkel");
}

/** Bonus voor een compleet profiel — de checklist uit lib/profiel-voorkeuren. */
export async function awardProfileBonusIfEarned(c: CustomerLike): Promise<BonusResult> {
  const compleet = isProfileComplete({
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    preferences: (c.preferences || {}) as ProfilePreferences,
  });
  if (!compleet) return { awarded: false, points: 0 };
  return awardBonus(c.id, "profiel");
}

/* ── Status voor de klant-UI ──────────────────────────────────────────────── */

export type BonusTask = {
  kind: BonusTaakKind;
  points: number;
  /** Al uitbetaald? */
  done: boolean;
  /** Voorwaarde gehaald maar (nog) niet uitbetaald — kan alleen bij punten = 0. */
  earned: boolean;
};

/**
 * De vier taken met hun stand, voor het "verdien punten"-blok op de accountpagina.
 * `done` leest de vlag/het grootboek, zodat een klant die z'n punten al kreeg de
 * taak afgevinkt ziet — ook als hij z'n profiel later weer uitkleedt.
 */
export async function bonusTasks(c: CustomerLike, walletInstalled: boolean): Promise<BonusTask[]> {
  const bp = (await getSettings()).loyaltyConfig?.bonusPoints;
  const claimed = await claimedBonusKinds(c.id, Boolean(c.profileCompletionBonusClaimed));
  const prefs = (c.preferences || {}) as ProfilePreferences;
  const voorwaarde: Record<BonusTaakKind, boolean> = {
    maatadvies: sizeProfileComplete(c.sizeProfile as Record<string, unknown>),
    wallet: walletInstalled,
    winkel: Boolean(String(prefs.favoriteStore || "").trim()),
    profiel: isProfileComplete({ firstName: c.firstName, lastName: c.lastName, phone: c.phone, preferences: prefs }),
  };
  return BONUS_KINDS.map((kind) => ({
    kind,
    points: bedrag(bp, kind),
    done: claimed.has(kind),
    earned: voorwaarde[kind],
  }));
}

/** Welke bonussen staan er al in het grootboek van deze klant? */
async function claimedBonusKinds(customerId: string, profileFlag: boolean): Promise<Set<BonusKind>> {
  const out = new Set<BonusKind>();
  if (profileFlag) out.add("profiel"); // oude mail-bonus: regel zonder refId
  try {
    const db = getDb();
    const rows = await db
      .select({ refType: loyaltyEvents.refType })
      .from(loyaltyEvents)
      .where(and(eq(loyaltyEvents.customerId, customerId), inArray(loyaltyEvents.refType, Object.values(REF_TYPE))));
    const byRef = new Map(Object.entries(REF_TYPE).map(([kind, ref]) => [ref, kind as BonusKind]));
    for (const r of rows) {
      const kind = byRef.get(String(r.refType || ""));
      if (kind) out.add(kind);
    }
  } catch {
    /* grootboek onbereikbaar → liever "nog niet gedaan" tonen dan de pagina slopen */
  }
  return out;
}
