import { NextResponse } from "next/server";
import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { audiences, emailFlowLeden, emailFlowStappen, emailFlows } from "@/db/schema";
import { coreAuth } from "@/lib/store-core-token";
import { OPERATOREN, VELDEN, omschrijfDefinitie, valideerDefinitie, type RegelGroep } from "@/lib/audience-regels";
import { loopFlows, vulFlow, type Stap } from "@/lib/email-flows";
import { SJABLOON_INFO } from "@/lib/email-flow-sjablonen";
import { FLOW_CATEGORIEEN } from "@/lib/email-flow-categorieen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * POST /api/core/email-flows — flows beheren vanuit de portal.
 *
 * Acties:
 *   opties     → sjablonen, doelgroepen, velden + operatoren voor de bouwer
 *   lijst      → alle flows mét het aantal klanten per stap (de trechter)
 *   haal       → één flow + wie er nu waar staat + laatste verzendingen
 *   bewaar     → opslaan (stappen + uitstapregel)
 *   aanzetten  → actief maken; bewust een APARTE actie, niet een veld in bewaar
 *   vullen     → nu instappen laten gebeuren (zonder te versturen)
 *   proefstap  → één ronde van de loper, begrensd
 *
 * Aan/uit is een eigen actie omdat het de enige handeling is waarna er echt
 * mails vertrekken. Verstopt in een opslagformulier zet iemand hem per ongeluk
 * aan terwijl hij alleen een wachttijd wilde wijzigen.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const db = getDb();
  const actie = String(b?.actie || "");
  const id = String(b?.id || "");

  try {
    switch (actie) {
      case "opties": {
        const dg = await db
          .select({ id: audiences.id, slug: audiences.slug, naam: audiences.naam, soort: audiences.soort, aantalBereikbaar: audiences.aantalBereikbaar })
          .from(audiences)
          .where(eq(audiences.actief, true));
        return NextResponse.json({ ok: true, sjablonen: SJABLOON_INFO, doelgroepen: dg, velden: VELDEN, operatoren: OPERATOREN, categorieen: FLOW_CATEGORIEEN });
      }

      case "lijst": {
        const rijen = await db.execute<Record<string, unknown>>(sql`
          select f.*,
            (select count(*)::int from ${emailFlowLeden} l where l.flow_id = f.id and l.status = 'loopt') lopend,
            (select count(*)::int from ${emailFlowLeden} l where l.flow_id = f.id and l.status = 'klaar') klaar,
            (select count(*)::int from ${emailFlowLeden} l where l.flow_id = f.id and l.status = 'uitgestapt') uitgestapt,
            (select count(*)::int from ${emailFlowStappen} s where s.flow_id = f.id and s.soort = 'mail' and s.gelukt) mails,
            a.naam doelgroep_naam, a.aantal_bereikbaar doelgroep_bereikbaar
          from ${emailFlows} f
          left join ${audiences} a on a.id = f.trigger_doelgroep_id
          order by f.actief desc, f.naam asc
        `);
        return NextResponse.json({
          ok: true,
          flows: rijen.rows.map((f) => ({
            ...f,
            uitstapTekst: omschrijfDefinitie(f.uitstap as RegelGroep),
          })),
        });
      }

      case "haal": {
        const [flow] = await db.select().from(emailFlows).where(eq(emailFlows.id, id)).limit(1);
        if (!flow) return NextResponse.json({ ok: false, error: "Flow bestaat niet." }, { status: 404 });
        // Per stap tellen hoeveel mensen daar nu staan — dát maakt de trechter
        // zichtbaar en laat zien waar mensen blijven hangen.
        const perStap = await db.execute<{ stap: number; n: number }>(sql`
          select stap, count(*)::int n from ${emailFlowLeden}
          where flow_id = ${id}::uuid and status = 'loopt' group by 1 order by 1
        `);
        const verstuurd = await db.execute<{ stap: number; n: number }>(sql`
          select stap, count(*)::int n from ${emailFlowStappen}
          where flow_id = ${id}::uuid and soort = 'mail' and gelukt group by 1 order by 1
        `);
        return NextResponse.json({
          ok: true,
          flow: { ...flow, uitstapTekst: omschrijfDefinitie(flow.uitstap as RegelGroep) },
          perStap: perStap.rows,
          verstuurd: verstuurd.rows,
        });
      }

      case "bewaar": {
        const stappen = (b.stappen ?? []) as Stap[];
        const uitstap = (b.uitstap ?? { op: "en", regels: [] }) as RegelGroep;
        const fouten = uitstap.regels?.length ? valideerDefinitie(uitstap) : [];
        if (fouten.length) return NextResponse.json({ ok: false, error: fouten.join(" ") }, { status: 400 });
        // Een mailstap zonder sjabloon zou stil niets doen; dat mag niet door.
        const kaal = stappen.findIndex((s) => s.soort === "mail" && !s.sjabloon);
        if (kaal >= 0) return NextResponse.json({ ok: false, error: `Stap ${kaal + 1} is een mail zonder sjabloon.` }, { status: 400 });

        const leeg = stappen.findIndex((s) => s.soort === "punten" && !Math.round(Number(s.punten) || 0));
        if (leeg >= 0) return NextResponse.json({ ok: false, error: `Stap ${leeg + 1} kent 0 punten toe.` }, { status: 400 });

        /* Een doelgroepstap die naar een DYNAMISCHE doelgroep wijst, faalt stil:
           het lidmaatschap wordt bij de eerstvolgende herbouw uit de regel
           weggegooid. Dat merk je pas als een advertentiecampagne scheef loopt,
           dus dat weigeren we hier in plaats van het te laten gebeuren. */
        const dgStappen = stappen.filter((s) => s.soort === "doelgroep");
        if (dgStappen.length) {
          const ids = [...new Set(dgStappen.map((s) => String(s.doelgroepId || "")))].filter(Boolean);
          const gevonden = ids.length
            ? await db.select({ id: audiences.id, soort: audiences.soort, naam: audiences.naam }).from(audiences).where(inArray(audiences.id, ids))
            : [];
          for (const [i, s] of stappen.entries()) {
            if (s.soort !== "doelgroep") continue;
            const dg = gevonden.find((g) => g.id === s.doelgroepId);
            if (!dg) return NextResponse.json({ ok: false, error: `Stap ${i + 1} wijst naar een doelgroep die niet bestaat.` }, { status: 400 });
            if (dg.soort !== "statisch")
              return NextResponse.json(
                { ok: false, error: `Stap ${i + 1}: "${dg.naam}" is een dynamische doelgroep. Die wordt uit zijn eigen regel herbouwd, dus wat een flow erin zet verdwijnt weer. Maak er een statische doelgroep voor aan.` },
                { status: 400 }
              );
          }
        }

        const waarden = {
          slug: String(b.slug || "").trim() || String(b.naam || "flow").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60),
          naam: String(b.naam || "").slice(0, 120),
          omschrijving: String(b.omschrijving || "").slice(0, 800),
          triggerSoort: String(b.triggerSoort || "doelgroep"),
          triggerDoelgroepId: (b.triggerDoelgroepId as string) || null,
          triggerEvent: String(b.triggerEvent || ""),
          categorie: FLOW_CATEGORIEEN.some((c) => c.key === b.categorie) ? String(b.categorie) : "overig",
          stappen: stappen as unknown as Record<string, unknown>[],
          uitstap: uitstap as unknown as Record<string, unknown>,
          herhaalbaar: Boolean(b.herhaalbaar),
          herhaalNaDagen: Math.max(0, Number(b.herhaalNaDagen) || 90),
          aangemaaktDoor: String(b.door || "").slice(0, 120),
        };
        const [rij] = await db
          .insert(emailFlows)
          .values(waarden)
          .onConflictDoUpdate({ target: emailFlows.slug, set: { ...waarden, updatedAt: sql`now()` } })
          .returning();
        return NextResponse.json({ ok: true, flow: rij });
      }

      case "aanzetten": {
        const aan = b.aan === true;
        await db.update(emailFlows).set({ actief: aan, updatedAt: sql`now()` }).where(eq(emailFlows.id, id));
        return NextResponse.json({ ok: true, actief: aan });
      }

      case "vullen":
        return NextResponse.json({ ok: true, ingestapt: await vulFlow(id) });

      case "proefstap":
        return NextResponse.json({ ok: true, ...(await loopFlows(Math.min(50, Number(b.max) || 10))) });

      case "verwijder":
        await db.delete(emailFlows).where(eq(emailFlows.id, id));
        return NextResponse.json({ ok: true });

      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie: ${actie.slice(0, 40)}` }, { status: 400 });
    }
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    console.warn(`[email-flows] ${actie} mislukt:`, melding);
    return NextResponse.json({ ok: false, error: melding.slice(0, 300) }, { status: 400 });
  }
}
