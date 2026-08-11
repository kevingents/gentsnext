import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { walletConfigured } from "@/lib/apple-wallet-config";
import { pushPassUpdate } from "@/lib/apple-wallet-push";
import { cronSecretOk } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Houdt de Apple-Wallet-spaarpas gelijk aan het echte saldo.
 *
 * Twee manieren waarop een pas stil kan gaan achterlopen:
 *  1. VESTING is puur tijd-gebaseerd (vests_at ≤ now) en maakt geen mutatie aan,
 *     dus niets triggert daar een push.
 *  2. Een SCHRIJFPAD dat pushPassUpdate niet aanroept. Dat is geen theorie: de
 *     punten-backfill boekte 2,87 mln punten rechtstreeks in SQL, en een gemiste
 *     push geeft geen fout — de klant ziet alleen een oud getal op z'n pas.
 *
 * Vandaar dat deze cron niet op mutaties stuurt maar op DRIFT: elke geregistreerde
 * pas waarvan het opgeslagen `last_pushed_points` afwijkt van het huidige saldo
 * krijgt een push, ongeacht welk pad het saldo veranderde. Zelfherstellend en
 * idempotent — is er geen verschil, dan doet deze cron niets.
 *
 * Vercel stuurt `Authorization: Bearer <CRON_SECRET>`. Env-gated: no-op zonder
 * pass-certificaat.
 */
export async function GET(req: Request) {
  if (!cronSecretOk(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!walletConfigured()) return NextResponse.json({ ok: true, skipped: "wallet-niet-geconfigureerd", pushed: 0 });

  try {
    const db = getDb();
    /* Passen waarvan het getoonde saldo niet (meer) klopt. Vergelijken op het
       GEVESTE saldo — dat is wat de pas rendert — zodat zowel een gemiste push
       als een puur tijd-gebaseerde vesting hier boven komt drijven. De join op
       customers via de serial (= customerId) houdt weespassen buiten de deur. */
    const scheef = await db.execute<{ serial: string; saldo: number; pas: number | null }>(sql`
      with saldi as (
        -- Apart aggregeren: één rij per klant. Zou dit in de join met de
        -- registraties zitten, dan telt een pas op twee toestellen elk
        -- puntenevent dubbel en pusht deze cron eeuwig door.
        select customer_id,
               greatest(0, coalesce(sum(points) filter (where vests_at is null or vests_at <= now()), 0))::int saldo
        from loyalty_events group by customer_id
      ), passen as (
        select r.serial_number serial,
               -- Meerdere toestellen op één pas: is er één achter (of nog nooit
               -- gepusht → NULL, hier -1), dan moet de serial gepusht worden.
               min(coalesce(r.last_pushed_points, -1)) pas,
               coalesce(s.saldo, 0) saldo
        from wallet_apple_registrations r
        join customers c on c.id::text = r.serial_number
        left join saldi s on s.customer_id = c.id
        group by r.serial_number, s.saldo
      )
      select serial, pas, saldo from passen
      where pas is distinct from saldo
      limit 500`);

    let pushed = 0;
    for (const p of scheef.rows) pushed += await pushPassUpdate(String(p.serial)).catch(() => 0);
    if (scheef.rows.length) {
      console.info(`[cron/wallet-vesting-push] ${scheef.rows.length} passen liepen achter, ${pushed} devices bijgewerkt`);
    }
    return NextResponse.json({ ok: true, achterlopend: scheef.rows.length, pushed });
  } catch (e) {
    console.error("[cron/wallet-vesting-push]", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
