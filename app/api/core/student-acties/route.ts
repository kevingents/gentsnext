import { NextResponse } from "next/server";
import { coreAuth } from "@/lib/store-core-token";
import { listStudentActies, getStudentActie, registreerStudentVerkoop, looptVandaag, geldtInWinkel, doetMee } from "@/lib/student-acties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/student-acties — KASSA-kant van de Students-acties
 * (auth: STORE_CORE_TOKEN; de winkel-scope handhaaft de storegents-proxy).
 *
 *   list     { store }                 → { ok, acties }   (alleen lopend + geldig in deze winkel)
 *   register { actieId, store, saleId, klantNaam, klantEmail, klantId, kassier, regels }
 *            → { ok, kortingCent, omzetCent, deduped }
 *
 * De korting wordt bij register SERVER-SIDE herrekend uit de actie zelf — wat de
 * kassa toont is een voorvertoning, wat hier geregistreerd wordt is de waarheid
 * waarop Remy rapporteert.
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; store?: string; actieId?: string; saleId?: string;
    klantNaam?: string; klantEmail?: string; klantId?: string; kassier?: string;
    regels?: { sku?: string; barcode?: string; title?: string; qty?: number; priceCent?: number }[];
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
