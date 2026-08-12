import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  bewaarDoelgroep, bouwDoelgroep, haalDoelgroep, lijstDoelgroepen,
  telDoelgroep, verwijderDoelgroep, voorbeeldLeden, type AudienceInvoer,
} from "@/lib/audiences";
import { OPERATOREN, VELDEN, omschrijfDefinitie, valideerDefinitie, type RegelGroep } from "@/lib/audience-regels";
import { STANDAARD_DOELGROEPEN } from "@/lib/audience-standaard";
import { exporteerCsv, leverUit, syncGeschiedenis, type SyncKanaal } from "@/lib/audience-sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/doelgroepen — alles rond doelgroepen, voor de portal.
 *
 * Eén endpoint met een `actie`-veld in plaats van tien losse routes: dat is het
 * patroon dat de rest van de core-API ook gebruikt, en het scheelt tien keer
 * dezelfde auth- en foutafhandeling.
 *
 * Acties:
 *   velden          → de beschikbare velden + operatoren (vult de bouwer in de portal)
 *   lijst           → alle doelgroepen
 *   haal            → één doelgroep + uitleverlogboek
 *   tel             → live telling bij een (nog niet bewaarde) definitie
 *   voorbeeld       → wie er in zou vallen — controle vóór opslaan
 *   bewaar          → opslaan/bijwerken
 *   bouw            → leden vastzetten
 *   verwijder       → weg
 *   uitleveren      → naar resend | meta | google
 *   csv             → export als tekst
 *   standaard       → de startset aanmaken
 *
 * Let op: `definitie` komt hier als DATA binnen en wordt nooit als SQL
 * uitgevoerd. lib/audience-regels vertaalt hem tegen een vaste veldenlijst;
 * staat een veld daar niet in, dan bestaat het niet.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const actie = String(b?.actie || "");
  const id = String(b?.id || "");
  const definitie = (b?.definitie ?? null) as RegelGroep | null;

  try {
    switch (actie) {
      case "velden":
        return NextResponse.json({ ok: true, velden: VELDEN, operatoren: OPERATOREN });

      case "lijst": {
        const lijst = await lijstDoelgroepen();
        return NextResponse.json({
          ok: true,
          doelgroepen: lijst.map((a) => ({
            ...a,
            samenvatting: omschrijfDefinitie(a.definitie as unknown as RegelGroep),
          })),
        });
      }

      case "haal": {
        const a = await haalDoelgroep(id);
        if (!a) return NextResponse.json({ ok: false, error: "Doelgroep bestaat niet." }, { status: 404 });
        const [logboek, voorbeeld] = await Promise.all([
          syncGeschiedenis(a.id),
          voorbeeldLeden(a.definitie as unknown as RegelGroep),
        ]);
        return NextResponse.json({
          ok: true,
          doelgroep: { ...a, samenvatting: omschrijfDefinitie(a.definitie as unknown as RegelGroep) },
          logboek,
          voorbeeld,
        });
      }

      case "tel": {
        const fouten = valideerDefinitie(definitie);
        if (fouten.length) return NextResponse.json({ ok: false, error: fouten.join(" ") }, { status: 400 });
        const t = await telDoelgroep(definitie);
        return NextResponse.json({ ok: true, ...t, samenvatting: omschrijfDefinitie(definitie) });
      }

      case "voorbeeld": {
        const fouten = valideerDefinitie(definitie);
        if (fouten.length) return NextResponse.json({ ok: false, error: fouten.join(" ") }, { status: 400 });
        return NextResponse.json({ ok: true, leden: await voorbeeldLeden(definitie) });
      }

      case "bewaar": {
        const rij = await bewaarDoelgroep(b as unknown as AudienceInvoer, String(b?.door || ""));
        return NextResponse.json({ ok: true, doelgroep: rij });
      }

      case "bouw": {
        const t = await bouwDoelgroep(id);
        return NextResponse.json({ ok: true, ...t });
      }

      case "verwijder":
        await verwijderDoelgroep(id);
        return NextResponse.json({ ok: true });

      case "uitleveren": {
        const kanaal = String(b?.kanaal || "") as SyncKanaal;
        if (!["resend", "meta", "google", "csv"].includes(kanaal)) {
          return NextResponse.json({ ok: false, error: "Onbekend kanaal." }, { status: 400 });
        }
        // Altijd eerst de leden bijwerken: uitleveren van een verouderde lijst is
        // erger dan niet uitleveren — je adverteert dan op mensen die er volgens
        // je eigen regel niet meer in horen.
        await bouwDoelgroep(id);
        return NextResponse.json({ ok: true, resultaat: await leverUit(id, kanaal) });
      }

      case "csv": {
        await bouwDoelgroep(id);
        const csv = await exporteerCsv(id, b?.alles !== true);
        return new NextResponse(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="doelgroep-${id}.csv"`,
          },
        });
      }

      case "standaard": {
        // Idempotent: bewaarDoelgroep werkt bij op slug, dus nogmaals draaien
        // maakt geen duplicaten en overschrijft geen handmatige aanpassing aan
        // de NAAM — wel aan de definitie, want dat is de bedoelde herstelknop.
        const gemaakt: string[] = [];
        for (const d of STANDAARD_DOELGROEPEN) {
          const bestond = d.slug ? await haalDoelgroep(d.slug) : null;
          if (bestond && b?.overschrijven !== true) continue;
          await bewaarDoelgroep(d, "standaard");
          gemaakt.push(d.slug!);
        }
        return NextResponse.json({ ok: true, aangemaakt: gemaakt });
      }

      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie: ${actie.slice(0, 40)}` }, { status: 400 });
    }
  } catch (e) {
    const melding = e instanceof Error ? e.message : String(e);
    console.warn(`[doelgroepen] actie=${actie} mislukt:`, melding);
    return NextResponse.json({ ok: false, error: melding.slice(0, 300) }, { status: 400 });
  }
}
