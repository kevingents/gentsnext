import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { vouchers } from "@/db/schema";
import { formatEuro } from "@/lib/format";

/**
 * Vouchers / kortingscodes — valideren en verzilveren. Korting altijd
 * server-side berekend (nooit het clientbedrag vertrouwen). Een code is
 * percentage (percentOff) of vast bedrag (valueCents), met optionele
 * minimumbesteding en vervaldatum.
 */

export type VoucherValidation = {
  valid: boolean;
  code: string;
  discountCents: number;
  label: string;
  error?: string;
};

export async function validateVoucher(rawCode: string, subtotalCents: number): Promise<VoucherValidation> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { valid: false, code, discountCents: 0, label: "", error: "Vul een code in." };
  const db = getDb();
  const rows = await db.select().from(vouchers).where(eq(vouchers.code, code)).limit(1);
  const v = rows[0];
  if (!v || v.status !== "active") return { valid: false, code, discountCents: 0, label: "", error: "Onbekende of gebruikte code." };
  if (v.expiresAt && v.expiresAt.getTime() < Date.now()) return { valid: false, code, discountCents: 0, label: "", error: "Deze code is verlopen." };
  if (v.minSpendCents && subtotalCents < v.minSpendCents) {
    return { valid: false, code, discountCents: 0, label: "", error: `Geldig vanaf ${formatEuro(v.minSpendCents)}.` };
  }
  const discountCents =
    v.kind === "percent"
      ? Math.min(subtotalCents, Math.round((subtotalCents * v.percentOff) / 100))
      : Math.min(subtotalCents, v.valueCents);
  const label = v.kind === "percent" ? `${v.percentOff}% korting` : `${formatEuro(v.valueCents)} korting`;
  return { valid: true, code, discountCents, label };
}

/**
 * Verzilvert een single-use code ATOMAIR: de UPDATE eist `status='active'`, dus van
 * twee gelijktijdige checkouts kan er maar één 'm flippen (active→redeemed). Voorkomt
 * dat dezelfde eenmalige code dubbel wordt gebruikt (bv. een vast-bedrag-code die het
 * totaal naar €0 duwt). Retourneert false ALLEEN als een single-use code al verzilverd
 * was (race verloren); herbruikbare codes geven altijd true.
 */
export async function redeemVoucher(code: string): Promise<boolean> {
  const db = getDb();
  const norm = code.trim().toUpperCase();
  const rows = await db
    .update(vouchers)
    .set({ status: "redeemed", redeemedAt: sql`now()` })
    .where(and(eq(vouchers.code, norm), eq(vouchers.singleUse, true), eq(vouchers.status, "active")))
    .returning({ id: vouchers.id });
  if (rows.length) return true; // single-use net atomair verzilverd
  // Niets geraakt: óf een herbruikbare code (prima), óf een single-use die al weg was.
  const [v] = await db.select({ singleUse: vouchers.singleUse }).from(vouchers).where(eq(vouchers.code, norm)).limit(1);
  return !!v && !v.singleUse;
}

/** Maakt een net-verzilverde single-use code weer actief (bij een teruggedraaide order). */
export async function releaseVoucher(code: string): Promise<void> {
  const db = getDb();
  await db
    .update(vouchers)
    .set({ status: "active", redeemedAt: null })
    .where(and(eq(vouchers.code, code.trim().toUpperCase()), eq(vouchers.singleUse, true), eq(vouchers.status, "redeemed")));
}

/** Maakt een unieke welkomstvoucher (percentage) voor een e-mailadres. */
export async function createWelcomeVoucher(email: string, percentOff = 10, days = 30): Promise<string> {
  const db = getDb();
  const norm = email.trim().toLowerCase();
  // Bestaat er al een actieve welkomstcode voor dit adres? Hergebruik 'm.
  const existing = await db
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.email, norm), eq(vouchers.status, "active")))
    .limit(1);
  if (existing[0]) return existing[0].code;

  const code = "WELKOM-" + Math.abs(hash(norm)).toString(36).toUpperCase().slice(0, 6);
  await db
    .insert(vouchers)
    .values({
      code,
      email: norm,
      description: "Welkomstkorting eerste bestelling",
      kind: "percent",
      percentOff,
      status: "active",
      singleUse: true,
      expiresAt: new Date(Date.now() + days * 86400000),
    })
    .onConflictDoNothing();
  return code;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
