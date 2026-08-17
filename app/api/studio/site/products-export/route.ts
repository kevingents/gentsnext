import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { exporteerProducten } from "@/lib/pim";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/studio/site/products-export?search&status&kwaliteit&merk&groep
 *
 * De productenlijst als CSV, mét dezelfde filters als het scherm — hetzelfde
 * filter zelfs, letterlijk: pimWhereSql() in lib/pim.ts. Een export die net iets
 * anders selecteert dan de lijst waar je op stond is een fuik.
 *
 * De kolom "Ontbreekt" noemt per artikel welke kwaliteitseisen falen. Daarmee is
 * dit het offline-werkblad van het PIM: filter in Excel, vul aan, en zet het met
 * de bulkbalk terug.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  try {
    const csv = await exporteerProducten({
      search: sp.get("search") || undefined,
      status: sp.get("status") || undefined,
      kwaliteit: sp.get("kwaliteit") || undefined,
      merk: sp.get("merk") || undefined,
      groep: sp.get("groep") || undefined,
    });
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="producten.csv"`,
      },
    });
  } catch (e) {
    const msg = (e as Error).message;
    return NextResponse.json({ ok: false, error: msg }, { status: msg.includes("kwaliteitsfilter") ? 400 : 500 });
  }
}
