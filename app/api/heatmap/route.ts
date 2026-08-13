import { NextResponse } from "next/server";
import { bewaarHeatmap } from "@/lib/heatmap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Ontvangt de klik-/scrollbatch van één paginaweergave (lib/heatmap-client).
 * Anoniem: een sessie-id, posities en elementpaden — geen klant, geen tekst uit
 * formulieren, geen muisspoor.
 *
 * Eigen endpoint naast /api/track omdat dit een veelvoud aan volume is; zie de
 * toelichting boven lib/heatmap-client. Antwoordt altijd 200: de browser stuurt
 * dit met sendBeacon en kan toch niets met een fout, en een meting mag nooit de
 * reden zijn dat er iets misgaat op de site.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (body && typeof body === "object") await bewaarHeatmap(body);
  } catch {
    /* stil — meten mag de site nooit breken */
  }
  return NextResponse.json({ ok: true });
}
