import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { dupliceerVoorbereiden } from "@/lib/order-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 20;

/**
 * GET /api/studio/site/order-duplicaat?order=G2A3B4C — zet een bestaande
 * bestelling klaar als voorstel voor een nieuwe: klantgegevens + de regels die
 * vandaag nog te bestellen zijn, tegen de HUIDIGE catalogusprijs.
 *
 * Voedt de orderbouwer in de portal (dupliceren, en daarmee ook "wijzigen":
 * dupliceren → aanpassen → de oude annuleren).
 *
 * Auth: admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const orderNumber = (new URL(req.url).searchParams.get("order") || "").trim();
  if (!orderNumber) return NextResponse.json({ ok: false, error: "Geen ordernummer." }, { status: 400 });
  try {
    const voorstel = await dupliceerVoorbereiden(orderNumber);
    if (!voorstel) return NextResponse.json({ ok: false, error: "Order niet gevonden." }, { status: 404 });
    return NextResponse.json({ ok: true, ...voorstel });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
