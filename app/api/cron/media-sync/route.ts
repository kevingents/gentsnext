import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { synchroniseerProductMedia } from "@/lib/shopify-media";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Haalt productfoto's uit Shopify die er sinds de vorige run bij kwamen.
 *
 * Waarom deze cron bestaat: op 14 aug stond `pak-3-delig-double-breasted-ecru`
 * actief op de site met 240 stuks voorraad en zonder foto, terwijl Shopify er
 * elf had — geüpload op 4 augustus, ná onze laatste import van 28 juli. Niets
 * haalde die op. `sync-catalog` berekent alleen `has_image` uit de beelden die
 * er al zijn; binnenhalen deed uitsluitend een handmatig script.
 *
 * Venster: standaard 3 dagen terug, ruim over de dagelijkse cadans heen. Een
 * gemiste nacht (deploy, storing) haalt zichzelf dan in plaats van een gat te
 * laten. `?dagen=` om het te verruimen, `?zonderbeeld=1` voor de opruimactie
 * over artikelen die bij ons helemaal geen foto hebben.
 *
 * Vercel stuurt `Authorization: Bearer <CRON_SECRET>`; een ingelogde beheerder
 * mag 'm ook met de hand openen. Zelfde patroon als /api/cron/sync-catalog.
 */
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  const customer = secretOk(req) ? null : await getSessionCustomer();
  if (!secretOk(req) && !customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const dagen = Math.min(Math.max(Number(sp.get("dagen")) || 3, 1), 90);
  const zonderBeeld = sp.get("zonderbeeld") === "1";
  const droogdraaien = sp.get("droog") === "1";

  const r = await synchroniseerProductMedia(
    zonderBeeld
      ? { alleenZonderBeeld: true, limiet: 400, droogdraaien }
      : { sinds: new Date(Date.now() - dagen * 24 * 60 * 60 * 1000), droogdraaien },
  );
  if ("error" in r) return NextResponse.json({ ok: false, error: r.error }, { status: 502 });
  return NextResponse.json({ ok: true, modus: zonderBeeld ? "zonder-beeld" : `laatste ${dagen} dagen`, ...r });
}
