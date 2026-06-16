import { NextResponse } from "next/server";
import { getMollieMethods } from "@/lib/mollie";

export const dynamic = "force-dynamic";

/** Actieve betaalmethodes voor de eigen methodekeuze op de afrekenpagina. */
export async function GET(req: Request) {
  const amount = Number(new URL(req.url).searchParams.get("amount")) || undefined;
  const methods = await getMollieMethods(amount);
  return NextResponse.json({ methods });
}
