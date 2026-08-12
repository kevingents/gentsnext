import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import {
  listStudentActies, getStudentActie, registreerStudentVerkoop, saveStudentActie, setStudentActieActief,
  looptVandaag, geldtInWinkel, doetMee, type ActieInvoer,
} from "@/lib/student-acties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/student-acties — KASSA-kant van de Students-acties
 * (auth: STORE_CORE_TOKEN; de winkel-scope handhaaft de storegents-proxy).
 *
 *   list       { store }               → { ok, acties }   (alleen lopend + geldig in deze winkel)
 *   register   { actieId, store, saleId, klantNaam, klantEmail, klantId, kassier, regels }
 *              → { ok, kortingCent, omzetCent, deduped }
 *   save       { id?, actie:{…} }      → { ok, actie }
 *   set-actief { actieId, actief }     → { ok }
 *
 * De korting wordt bij register SERVER-SIDE herrekend uit de actie zelf — wat de
 * kassa toont is een voorvertoning, wat hier geregistreerd wordt is de waarheid
 * waarop Remy rapporteert.
 *
 * save/set-actief zijn de BEHEER-kant: storegents spiegelt een verenigings-deal
 * hier naartoe, zodat die deal via deze bestaande kassaroute loopt in plaats van
 * via een tweede, eigen kortingsweg. Alleen bereikbaar met het core-token — de
 * winkelproxy (/api/store/student-acties) laat enkel list en register door.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; store?: string; actieId?: string; saleId?: string;
    klantNaam?: string; klantEmail?: string; klantId?: string; kassier?: string;
    regels?: { sku?: string; barcode?: string; title?: string; qty?: number; priceCent?: number }[];
    id?: string; actie?: ActieInvoer; actief?: unknown;
  };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  try {
    switch (String(b?.action || "")) {
      case "list": {
        const store = String(b.store || "").trim();
        if (!store) return NextResponse.json({ ok: false, error: "store vereist." }, { status: 400 });
        const acties = await listStudentActies({ alleenLopend: true, store });
        /* De kassa krijgt ook de productlijst mee: die bepaalt lokaal welke
           regels in het mandje korting tonen (de registratie herrekent). */
        return NextResponse.json({ ok: true, acties });
      }
      case "register": {
        const r = await registreerStudentVerkoop({
          actieId: String(b.actieId || ""),
          store: String(b.store || "").trim(),
          saleId: String(b.saleId || "").trim(),
          klantNaam: b.klantNaam, klantEmail: b.klantEmail, klantId: b.klantId, kassier: b.kassier,
          regels: Array.isArray(b.regels) ? b.regels : [],
        });
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        return NextResponse.json(r);
      }
      /* Beheer: actie aanmaken of bijwerken. Zonder id → nieuw. saveStudentActie
         valideert zelf (naam, vereniging, 1-100%, datumvolgorde) en die tekst gaat
         onverkort terug, zodat de beheerder in de portal leest wát er mis is. */
      case "save": {
        const r = await saveStudentActie(String(b.id || "").trim() || null, (b.actie || {}) as ActieInvoer);
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        return NextResponse.json(r);
      }
      /* Aan/uit zonder de rest aan te raken. Nodig omdat een deal die uitgezet of
         verwijderd wordt anders als levende korting aan de kassa blijft staan —
         en dat is precies het soort stille fout waar geld doorheen loopt. */
      case "set-actief": {
        const id = String(b.actieId || "").trim();
        if (!id) return NextResponse.json({ ok: false, error: "actieId vereist." }, { status: 400 });
        if (!(await getStudentActie(id))) return NextResponse.json({ ok: false, error: "Actie niet gevonden." }, { status: 404 });
        await setStudentActieActief(id, Boolean(b.actief));
        return NextResponse.json({ ok: true });
      }
      /* Voorvertoning: mag deze actie op deze regel? (voor een losse check) */
      case "check": {
        const actie = await getStudentActie(String(b.actieId || ""));
        if (!actie) return NextResponse.json({ ok: false, error: "Actie niet gevonden." }, { status: 404 });
        const store = String(b.store || "").trim();
        return NextResponse.json({
          ok: true,
          loopt: looptVandaag(actie),
          geldigInWinkel: geldtInWinkel(actie, store),
          regels: (Array.isArray(b.regels) ? b.regels : []).map((l) => ({ sku: l.sku, meedoen: doetMee(actie, String(l.sku || ""), String(l.barcode || "")) })),
        });
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${String(b?.action || "")}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
