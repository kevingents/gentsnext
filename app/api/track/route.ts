import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { visitorAttribution } from "@/db/schema";
import { recordEvents, onbekendeEvents } from "@/lib/analytics";
import { klantVoorIdentiteit } from "@/lib/identity";

export const dynamic = "force-dynamic";

/**
 * Ontvangt een batch storefront-events.
 *
 * De klant wordt hier SERVER-side bepaald, uit de identiteitsgrafiek op basis
 * van de device-id — nooit uit wat de client meestuurt. Was dat andersom, dan
 * kon iedereen met een open console gedrag aan een willekeurige klant hangen.
 * Voor het overgrote deel van het verkeer blijft de uitkomst gewoon `null`, en
 * dat is de normale situatie: een onbekende bezoeker meten we anoniem.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const list = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : [];

    // Eén indexed lookup per batch (batches komen hoogstens elke 2,5s), niet per
    // event. De sessie zelf valideren zou duurder zijn én zou het device van een
    // uitgelogde-maar-bekende bezoeker missen.
    const sid = String(list.find((e: { sessionId?: string }) => e?.sessionId)?.sessionId || "");
    const customerId = sid ? await klantVoorIdentiteit("device", sid).catch(() => null) : null;

    // Onbekende namen niet stil weggooien: dát is precies hoe search_click
    // maandenlang onzichtbaar bleef. Loggen, dan zie je een typefout terug.
    const onbekend = onbekendeEvents(list);
    if (onbekend.length) console.warn("[track] events buiten de catalogus:", onbekend.join(", "));

    await recordEvents(list.map((e: Record<string, unknown>) => ({ ...e, customerId, bron: "web" })));

    if (body?.attributie && sid) await bewaarAttributie(sid, body.attributie);
  } catch {
    /* analytics mag nooit de UX breken */
  }
  return NextResponse.json({ ok: true });
}

/**
 * Eerste aanraking wordt één keer vastgelegd en daarna nooit meer overschreven
 * (COALESCE op de bestaande waarde) — dat is de campagne die de klant bracht.
 * Laatste aanraking en klik-id's mogen wél bijwerken, maar alleen met een
 * niet-lege waarde: een gewoon vervolgbezoek zonder parameters moet een eerder
 * opgevangen gclid niet wissen.
 */
async function bewaarAttributie(sessionId: string, a: Record<string, unknown>) {
  const s = (v: unknown) => String(v ?? "").slice(0, 300);
  const db = getDb();
  await db
    .insert(visitorAttribution)
    .values({
      sessionId,
      firstSource: s(a.firstSource), firstMedium: s(a.firstMedium), firstCampaign: s(a.firstCampaign),
      firstTerm: s(a.firstTerm), firstContent: s(a.firstContent),
      firstReferrer: s(a.firstReferrer), firstLanding: s(a.firstLanding),
      lastSource: s(a.lastSource), lastMedium: s(a.lastMedium), lastCampaign: s(a.lastCampaign),
      gclid: s(a.gclid), gbraid: s(a.gbraid), wbraid: s(a.wbraid),
      fbclid: s(a.fbclid), ttclid: s(a.ttclid), msclkid: s(a.msclkid),
    })
    .onConflictDoUpdate({
      target: visitorAttribution.sessionId,
      set: {
        firstSource: sql`coalesce(nullif(${visitorAttribution.firstSource}, ''), excluded.first_source)`,
        firstMedium: sql`coalesce(nullif(${visitorAttribution.firstMedium}, ''), excluded.first_medium)`,
        firstCampaign: sql`coalesce(nullif(${visitorAttribution.firstCampaign}, ''), excluded.first_campaign)`,
        firstTerm: sql`coalesce(nullif(${visitorAttribution.firstTerm}, ''), excluded.first_term)`,
        firstContent: sql`coalesce(nullif(${visitorAttribution.firstContent}, ''), excluded.first_content)`,
        firstReferrer: sql`coalesce(nullif(${visitorAttribution.firstReferrer}, ''), excluded.first_referrer)`,
        firstLanding: sql`coalesce(nullif(${visitorAttribution.firstLanding}, ''), excluded.first_landing)`,
        lastSource: sql`coalesce(nullif(excluded.last_source, ''), ${visitorAttribution.lastSource})`,
        lastMedium: sql`coalesce(nullif(excluded.last_medium, ''), ${visitorAttribution.lastMedium})`,
        lastCampaign: sql`coalesce(nullif(excluded.last_campaign, ''), ${visitorAttribution.lastCampaign})`,
        gclid: sql`coalesce(nullif(excluded.gclid, ''), ${visitorAttribution.gclid})`,
        gbraid: sql`coalesce(nullif(excluded.gbraid, ''), ${visitorAttribution.gbraid})`,
        wbraid: sql`coalesce(nullif(excluded.wbraid, ''), ${visitorAttribution.wbraid})`,
        fbclid: sql`coalesce(nullif(excluded.fbclid, ''), ${visitorAttribution.fbclid})`,
        ttclid: sql`coalesce(nullif(excluded.ttclid, ''), ${visitorAttribution.ttclid})`,
        msclkid: sql`coalesce(nullif(excluded.msclkid, ''), ${visitorAttribution.msclkid})`,
        lastSeen: sql`now()`,
      },
    });
}
