/**
 * lib/loyalty-bonus.ts
 *
 * Eenmalige spaarpunten-bonussen die RETOUREN moeten terugdringen. Drie acties,
 * één keer per klant, direct besteedbaar:
 *
 *   maatadvies → de klant heeft z'n maten bewaard (via /maatadvies of Mijn maten)
 *   wallet     → de spaarpas staat écht in Apple Wallet (device-registratie)
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
import { getSettings } from "@/lib/settings";
import { isProfileComplete, sizeProfileComplete, type ProfilePreferences } from "@/lib/profiel-voorkeuren";

export type BonusKind = "maatadvies" | "wallet" | "profiel";

/** refType per bonus. Vast — dit staat straks in het grootboek van elke klant. */
const REF_TYPE: Record<BonusKind, string> = {
  maatadvies: "bonus_maatadvies",
  wallet: "bonus_wallet",
  // Bestaande sleutel uit de "+50 punten"-mail: dezelfde bonus, dus dezelfde
  // refType. Zo kan niemand hem twee keer pakken (mail én zelf invullen).
  profiel: "profile_completion",
};

const REASON: Record<BonusKind, string> = {
  maatadvies: "Maatprofiel ingevuld",
  wallet: "Spaarpas in Apple Wallet",
  profiel: "Profiel afgerond",
};

/** Wat deze bonus nu waard is (0 = uit). Instelbaar in de tool, niet in code. */
export async function bonusPointsFor(kind: BonusKind): Promise<number> {
  const bp = (await getSettings()).loyaltyConfig?.bonusPoints;
  const val = kind === "maatadvies" ? bp?.sizeAdvice : kind === "wallet" ? bp?.walletPass : bp?.profileComplete;
  return Math.max(0, Math.round(Number(val) || 0));
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

/** Bonus voor het maatprofiel — alleen als het profiel er ook écht staat. */
export async function awardSizeAdviceBonusIfEarned(c: CustomerLike): Promise<BonusResult> {
  if (!sizeProfileComplete(c.sizeProfile as Record<string, unknown>)) return { awarded: false, points: 0 };
  return awardBonus(c.id, "maatadvies");
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
  kind: BonusKind;
  points: number;
  /** Al uitbetaald? */
  done: boolean;
  /** Voorwaarde gehaald maar (nog) niet uitbetaald — kan alleen bij punten = 0. */
  earned: boolean;
};

/**
 * De drie taken met hun stand, voor het "verdien punten"-blok op de accountpagina.
 * `done` leest de vlag/het grootboek, zodat een klant die z'n punten al kreeg de
 * taak afgevinkt ziet — ook als hij z'n profiel later weer uitkleedt.
 */
export async function bonusTasks(c: CustomerLike, walletInstalled: boolean): Promise<BonusTask[]> {
  const { loyaltyConfig } = await getSettings();
  const bp = loyaltyConfig?.bonusPoints;
  const claimed = await claimedBonusKinds(c.id, Boolean(c.profileCompletionBonusClaimed));
  const sizeOk = sizeProfileComplete(c.sizeProfile as Record<string, unknown>);
  const profielOk = isProfileComplete({
    firstName: c.firstName,
    lastName: c.lastName,
    phone: c.phone,
    preferences: (c.preferences || {}) as ProfilePreferences,
  });
  return [
    { kind: "maatadvies", points: Math.max(0, Number(bp?.sizeAdvice) || 0), done: claimed.has("maatadvies"), earned: sizeOk },
    { kind: "wallet", points: Math.max(0, Number(bp?.walletPass) || 0), done: claimed.has("wallet"), earned: walletInstalled },
    { kind: "profiel", points: Math.max(0, Number(bp?.profileComplete) || 0), done: claimed.has("profiel"), earned: profielOk },
  ];
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
