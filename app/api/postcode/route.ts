import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Adres-autofill: postcode + huisnummer → straat + plaats via de gratis PDOK
 * Locatieserver (geen key nodig). Voorkomt typefouten en mislukte bezorgingen.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const postcode = (searchParams.get("postcode") || "").replace(/\s+/g, "").toUpperCase();
  const number = (searchParams.get("number") || "").trim().replace(/[^0-9a-zA-Z]/g, "");
  if (!/^[1-9][0-9]{3}[A-Z]{2}$/.test(postcode) || !number) return NextResponse.json({});

  try {
    const url = `https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?q=${encodeURIComponent(
      `${postcode} ${number}`
    )}&fq=type:adres&rows=1`;
    const r = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) return NextResponse.json({});
    const d = await r.json();
    const doc = d?.response?.docs?.[0];
    if (!doc?.straatnaam) return NextResponse.json({});
    return NextResponse.json({ street: String(doc.straatnaam), city: String(doc.woonplaatsnaam || "") });
  } catch {
    return NextResponse.json({});
  }
}
