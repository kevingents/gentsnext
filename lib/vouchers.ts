import { and, eq, or, sql } from "drizzle-orm";
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

/**
 * Verzilvert een code vanuit een BON (kassa) i.p.v. een weborder — idempotent op
 * de bon-referentie.
 *
 * Waarom niet gewoon redeemVoucher(): die geeft `false` zodra de code al op
 * 'redeemed' staat, ook als wij 'm net zelf voor DEZE bon verzilverden. Aan de
 * kassa kan dezelfde POST tweemaal aankomen (netwerk, offline-sync), en dan ziet
 * de kassier een geldige tegoedbon geweigerd worden — of trekt 'm bij een tweede
 * poging alsnog dubbel af. Door de referentie in dezelfde atomaire UPDATE mee te
 * schrijven is "al door mijzelf verzilverd" te onderscheiden van "echt op".
 */
export async function redeemVoucherForRef(
  code: string,
  ref: string,
): Promise<{ ok: boolean; herhaald?: boolean; error?: string }> {
  const norm = code.trim().toUpperCase();
  const bon = String(ref || "").trim();
  if (!norm) return { ok: false, error: "Geen code." };
  if (!bon) return { ok: false, error: "Bon-referentie vereist." };
  const db = getDb();

  const claimed = await db
    .update(vouchers)
    .set({ status: "redeemed", redeemedAt: sql`now()`, redeemedRef: bon })
    .where(and(eq(vouchers.code, norm), eq(vouchers.singleUse, true), eq(vouchers.status, "active")))
    .returning({ id: vouchers.id, customerId: vouchers.customerId });
  if (claimed.length) {
    // Pas bijwerken: het tegoed staat erop, en een pas die een net uitgegeven
    // bedrag blijft tonen laat de klant met verkeerde verwachtingen rondlopen.
    // Best-effort en dynamisch geimporteerd (passkit hoort niet in deze graph).
    const owner = claimed[0].customerId;
    if (owner) {
      try { await (await import("@/lib/apple-wallet-push")).pushPassUpdate(owner); } catch { /* best-effort */ }
      try { await (await import("@/lib/google-wallet-push")).pushGoogleWalletForCustomer(owner); } catch { /* best-effort */ }
    }
    return { ok: true };
  }

  const [v] = await db
    .select({ singleUse: vouchers.singleUse, status: vouchers.status, redeemedRef: vouchers.redeemedRef })
    .from(vouchers)
    .where(eq(vouchers.code, norm))
    .limit(1);
  if (!v) return { ok: false, error: "Onbekende code." };
  if (!v.singleUse) return { ok: true }; // herbruikbaar → altijd goed
  if (v.status === "redeemed" && v.redeemedRef === bon) return { ok: true, herhaald: true };
  return { ok: false, error: "Deze code is al gebruikt." };
}

/**
 * Geeft een tegoedbon terug die DEZE bon verzilverde. Nodig omdat de kassa
 * fail-closed werkt: eerst verzilveren, dan pas vastleggen. Struikelt het
 * vastleggen daarna (prijsverschil, storing), dan is de bon zonder aankoop
 * verbrand.
 *
 * De ref-guard is het hele punt: zonder die voorwaarde kan wie het core-token
 * heeft elke willekeurige verzilverde bon weer activeren — inclusief bonnen die
 * bij een andere, gewoon afgeronde verkoop hoorden. Alleen wie 'm verzilverde
 * mag 'm teruggeven.
 */
export async function releaseVoucherForRef(code: string, ref: string): Promise<{ ok: boolean; hersteld?: boolean; error?: string }> {
  const norm = code.trim().toUpperCase();
  const bon = String(ref || "").trim();
  if (!norm || !bon) return { ok: false, error: "Code en bon-referentie vereist." };
  const rows = await getDb()
    .update(vouchers)
    .set({ status: "active", redeemedAt: null, redeemedRef: "" })
    .where(and(eq(vouchers.code, norm), eq(vouchers.status, "redeemed"), eq(vouchers.redeemedRef, bon)))
    .returning({ id: vouchers.id, customerId: vouchers.customerId });
  /* Niets geraakt = niet door deze bon verzilverd. Geen fout: een release die twee
     keer binnenkomt (retry) hoort geen storing te veroorzaken. Maar `ok` zegt dan
     ook niets over wat er gebeurd is - vandaar `hersteld`, zodat een aanroeper
     (kassa-retour) niet "code staat weer klaar" logt terwijl er niets veranderde. */
  if (rows.length) {
    const owner = rows[0].customerId;
    if (owner) {
      try { await (await import("@/lib/apple-wallet-push")).pushPassUpdate(owner); } catch { /* best-effort */ }
      try { await (await import("@/lib/google-wallet-push")).pushGoogleWalletForCustomer(owner); } catch { /* best-effort */ }
    }
  }
  return { ok: true, hersteld: rows.length > 0 };
}

/** Maakt een net-verzilverde single-use code weer actief (bij een teruggedraaide order). */
export async function releaseVoucher(code: string): Promise<void> {
  const db = getDb();
  await db
    .update(vouchers)
    .set({ status: "active", redeemedAt: null, redeemedRef: "" })
    .where(and(eq(vouchers.code, code.trim().toUpperCase()), eq(vouchers.singleUse, true), eq(vouchers.status, "redeemed")));
}

/**
 * De besteedbare tegoeden van een klant — voor de kassa, die de spaarpas scant
 * (de QR bevat het klant-id) en dan wil weten wat deze klant openstaan heeft.
 * Matcht ook op e-mail, zodat een welkomst-/gastcode die op adres is uitgegeven
 * meekomt. Alleen actief en niet verlopen.
 */
export async function activeVouchersForCustomer(input: { customerId?: string; email?: string }) {
  const cid = String(input.customerId || "").trim();
  const mail = String(input.email || "").trim().toLowerCase();
  if (!cid && !mail) return [];
  const db = getDb();
  const ors = [];
  if (cid) ors.push(eq(vouchers.customerId, cid));
  if (mail) ors.push(sql`lower(${vouchers.email}) = ${mail}`);
  const rows = await db
    .select()
    .from(vouchers)
    .where(and(eq(vouchers.status, "active"), or(...ors), sql`(${vouchers.expiresAt} is null or ${vouchers.expiresAt} > now())`))
    .limit(25);
  return rows.map((v) => ({
    code: v.code,
    omschrijving: v.description,
    soort: v.kind,
    valueCents: v.valueCents,
    percentOff: v.percentOff,
    minSpendCents: v.minSpendCents,
    verlooptOp: v.expiresAt,
    label: v.kind === "percent" ? `${v.percentOff}% korting` : `${formatEuro(v.valueCents)} tegoed`,
  }));
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
