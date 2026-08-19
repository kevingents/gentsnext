import { NextResponse } from "next/server";
import { maakNieuweArtikelen, srsBeschikbaar } from "@/lib/srs-artikelen";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/* Het volledige SRS-productenbestand ophalen en vergelijken kost tijd. */
export const maxDuration = 300;

/**
 * Nachtelijke cron (zie vercel.json): nieuwe SRS-artikelen als CONCEPT-product
 * het PIM in. Zo staat nieuwe collectie die fysiek de winkel in komt (Den
 * Bosch, drager T000001298) er 's ochtends al in — scanbaar bij de ontvangst,
 * zichtbaar met naam/kleur/maat/prijs, en voor content te vinden via het
 * Herkomst=SRS-filter in de productenlijst.
 *
 * Veiligheid zit in maakNieuweArtikelen zelf: noodrem op een verdacht kleine
 * feed, nooit aanmaken naast iets bestaands (sku- én artikelnummer+kleur-check),
 * en alles als 'draft' — de site toont niets tot content het afmaakt.
 *
 * Vercel-cron stuurt `Authorization: Bearer <CRON_SECRET>` mee.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

/* WAAKHOND-SPOOR (Kevin, 19 aug: "zit er nu een check op als hij gaat?").
   Deze import heeft wekenlang stil gefaald (SRS 403) zonder dat iemand het
   zag. Elke run — geslaagd of niet — legt daarom z'n uitslag vast in
   app_settings (rij 'srs-import-status'); de storegents-cron srs-import-check
   leest die elke ochtend en meldt supply chain zodra de import faalde of niet
   gedraaid heeft. Best-effort: het vastleggen mag de run zelf nooit breken. */
async function legStatusVast(status: Record<string, unknown>) {
  try {
    await getDb().execute(sql`
      insert into app_settings (id, data, updated_at)
      values ('srs-import-status', ${JSON.stringify({ at: new Date().toISOString(), ...status })}::jsonb, now())
      on conflict (id) do update set data = excluded.data, updated_at = now()`);
  } catch (e) {
    console.warn("[srs-nieuwe-artikelen] status vastleggen mislukt:", (e as Error).message);
  }
}

export async function GET(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  if (!srsBeschikbaar()) {
    await legStatusVast({ ok: false, error: "SRS_API_USER/SRS_API_PASSWORD ontbreken." });
    return NextResponse.json({ ok: false, error: "SRS_API_USER/SRS_API_PASSWORD ontbreken." }, { status: 503 });
  }
  try {
    /* Default 500/nacht (was 200; Kevin 19 aug: "kunnen we de producten niet
       sneller inladen met de export?") — de achterstand loopt zo dagen sneller
       in, en ?max= laat een handmatige inhaalrun tot 2000 doen. De noodremmen
       (kleine-feed-weigering, nooit naast iets bestaands, alles draft) zitten in
       maakNieuweArtikelen zelf en gelden onverkort. */
    const url = new URL(req.url);
    const max = Math.min(2000, Math.max(1, Number(url.searchParams.get("max")) || 500));
    const r = await maakNieuweArtikelen({ max });
    if ("error" in r) {
      await legStatusVast({ ok: false, error: r.error });
      return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
    }
    await legStatusVast({
      ok: true,
      feedRijen: r.feedRijen,
      kandidaten: r.kandidaten,
      aangemaakt: r.aangemaakt,
      varianten: r.varianten,
      restant: r.restant,
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    await legStatusVast({ ok: false, error: (e as Error).message });
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
