import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { walletConfigured } from "@/lib/apple-wallet-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/wallet-stats — hoeveel klanten hebben de spaarpas echt in
 * Apple Wallet staan. Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 *
 * De bron is `wallet_apple_registrations`: iOS schrijft daar een regel zodra de
 * pas op een toestel is TOEGEVOEGD. Dat is bewust het getal dat we tellen —
 * downloaden zegt niets, pas bij registratie staat 'ie in de Wallet van de klant
 * en kunnen we 'm ook bijwerken. Verwijdert iemand de pas, dan meldt Apple dat
 * (410) en ruimt de push-rail de registratie op, dus dit telt mee omlaag.
 *
 * Eén klant kan meerdere toestellen hebben (iPhone + iPad), vandaar het verschil
 * tussen `passen` (klanten) en `toestellen`.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  try {
    const db = getDb();
    const [totalen] = (
      await db.execute<{
        passen: number;
        toestellen: number;
        nieuw_7d: number;
        nieuw_30d: number;
        eerste: string | null;
        laatste: string | null;
      }>(sql`
        select count(distinct serial_number)::int as passen,
               count(*)::int as toestellen,
               count(distinct serial_number) filter (where created_at > now() - interval '7 days')::int as nieuw_7d,
               count(distinct serial_number) filter (where created_at > now() - interval '30 days')::int as nieuw_30d,
               min(created_at)::text as eerste,
               max(created_at)::text as laatste
        from wallet_apple_registrations`)
    ).rows;

    /* Waarmee vergelijk je dat? Niet met álle klanten — wie nooit gespaard heeft
       gaat ook geen spaarpas installeren. De eerlijke noemer is "klanten met
       punten", en daarbinnen apart wie genoeg heeft om iets te verzilveren. */
    const [noemer] = (
      await db.execute<{ met_punten: number; besteedbaar_500: number }>(sql`
        with per as (
          select customer_id,
                 sum(points)::int as totaal,
                 sum(case when vests_at is null or vests_at <= now() then points else 0 end)::int as gevest
          from loyalty_events group by 1)
        select count(*) filter (where totaal > 0)::int as met_punten,
               count(*) filter (where gevest >= 500)::int as besteedbaar_500
        from per`)
    ).rows;

    const passen = Number(totalen?.passen) || 0;
    const metPunten = Number(noemer?.met_punten) || 0;

    return NextResponse.json({
      ok: true,
      /* false = de feature staat uit (geen pass-certificaat). Dan is 0 geen
         slechte score maar "niet aangeboden" — dat verschil moet het scherm
         kunnen tonen, anders stuurt iemand op een cijfer dat niet bestaat. */
      actief: walletConfigured(),
      passen,
      toestellen: Number(totalen?.toestellen) || 0,
      nieuw7d: Number(totalen?.nieuw_7d) || 0,
      nieuw30d: Number(totalen?.nieuw_30d) || 0,
      klantenMetPunten: metPunten,
      klantenMetBesteedbaarSaldo: Number(noemer?.besteedbaar_500) || 0,
      // Aandeel van de spaarders dat de pas ook echt geïnstalleerd heeft.
      adoptiePct: metPunten > 0 ? Math.round((passen / metPunten) * 1000) / 10 : 0,
      eerste: totalen?.eerste ?? null,
      laatste: totalen?.laatste ?? null,
    });
  } catch (e) {
    console.error("[studio/wallet-stats]", (e as Error).message);
    return NextResponse.json({ ok: false, error: "Kon de wallet-cijfers niet ophalen." }, { status: 500 });
  }
}
