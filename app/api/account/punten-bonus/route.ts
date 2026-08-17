import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations } from "@/db/schema";
import { getSessionCustomer } from "@/lib/account";
import {
  awardBonus,
  awardProfileBonusIfEarned,
  awardSizeAdviceBonusIfEarned,
  awardStoreBonusIfEarned,
  type BonusKind,
} from "@/lib/loyalty-bonus";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/account/punten-bonus — "haal mijn punten op".
 *
 * Voor wie de actie al gedaan hád vóórdat deze bonussen bestonden: z'n maten
 * stonden er al, of de spaarpas stond al op z'n telefoon. Die klant ziet de taak
 * als openstaand, en dan moet hij 'm ook kunnen verzilveren — een stille
 * massa-nabetaling over het hele klantenbestand is een geldbesluit, geen
 * bijwerking van een deploy.
 *
 * De server controleert alle drie de voorwaarden zélf opnieuw; de client vraagt
 * alleen om de controle. Toekennen is idempotent (unieke index op het
 * grootboek), dus twee keer klikken levert nooit twee keer punten op.
 */
export async function POST() {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });

  const awarded: { kind: BonusKind; points: number }[] = [];
  const push = (kind: BonusKind, r: { awarded: boolean; points: number }) => {
    if (r.awarded) awarded.push({ kind, points: r.points });
  };

  push("maatadvies", await awardSizeAdviceBonusIfEarned(customer));
  push("winkel", await awardStoreBonusIfEarned(customer));
  push("profiel", await awardProfileBonusIfEarned(customer));

  // Wallet: de registratie van het toestel is het bewijs dat de pas erop staat.
  let opToestel = false;
  try {
    const rows = await getDb()
      .select({ d: walletAppleRegistrations.deviceLibraryIdentifier })
      .from(walletAppleRegistrations)
      .where(eq(walletAppleRegistrations.serialNumber, customer.id))
      .limit(1);
    opToestel = rows.length > 0;
  } catch {
    /* registratietabel onbereikbaar → geen wallet-bonus, de rest gaat gewoon door */
  }
  if (opToestel) push("wallet", await awardBonus(customer.id, "wallet"));

  return NextResponse.json({ ok: true, awarded, total: awarded.reduce((n, a) => n + a.points, 0) });
}
