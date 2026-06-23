import { NextResponse } from "next/server";
import { getStores } from "@/lib/stores";

export const dynamic = "force-dynamic";

/** Winkels voor de afhaal-keuze in de checkout. name = winkelnaam ("GENTS Groningen"). */
export async function GET() {
  const stores = getStores().map((s) => ({ name: s.title, city: s.city }));
  return NextResponse.json({ stores });
}
