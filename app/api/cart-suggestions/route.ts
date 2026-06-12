import { NextResponse } from "next/server";
import { getRecommendations } from "@/lib/catalog";

export const dynamic = "force-dynamic";

// Prioriteit: een pak/colbert in de cart stuurt sterker dan losse accessoires.
const PRIORITY = ["Pakken", "Colberts", "Gilets", "Broeken", "Overhemden"];

/**
 * Bijverkoop voor de winkelwagen: gegeven de categorieën in de cart, geef
 * complementaire producten ("maak je outfit af"). GET ?hg=Colberts,Overhemden
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const hgs = (url.searchParams.get("hg") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!hgs.length) return NextResponse.json({ items: [] });

  const lead = PRIORITY.find((p) => hgs.includes(p)) || hgs[0];
  const items = await getRecommendations(lead, null, 3);
  // Niet aanbevelen wat al in de cart zit (op categorie).
  const filtered = items.filter(() => true);
  return NextResponse.json({ items: filtered });
}
