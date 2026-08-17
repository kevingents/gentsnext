import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productVariants } from "@/db/schema";
import { adminOrToken } from "@/lib/studio-token";
import { allocateOrder } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/site/allocate-preview — laat zien waar een order heen zou
 * gaan: welke filialen of het magazijn, hoe hij splitst, welke levertijd en
 * welke tekorten. Er wordt NIETS geboekt en niets naar SRS gestuurd; dit is een
 * doorrekening van de allocatie-engine met dezelfde regels als een echte order.
 *
 * body { lines: [{ sku, qty }] } of { text: "sku aantal\n…" }, optioneel
 * { country } voor het land waarheen geleverd wordt (default NL — dat bepaalt
 * mee welke levertijden gelden).
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: { lines?: { sku?: unknown; qty?: unknown }[]; text?: unknown; country?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  let lines: { sku: string; qty: number }[] = [];
  if (Array.isArray(body.lines)) {
    lines = body.lines.map((l) => ({
      sku: String(l?.sku ?? "").trim(),
      qty: Math.max(1, Math.floor(Number(l?.qty) || 1)),
    }));
  } else if (typeof body.text === "string") {
    lines = body.text.split(/\r?\n/).map((row) => {
      const parts = row.trim().split(/[\s,;]+/);
      return { sku: (parts[0] || "").trim(), qty: Math.max(1, Math.floor(Number(parts[1]) || 1)) };
    });
  }
  lines = lines.filter((l) => l.sku);
  if (!lines.length) return NextResponse.json({ ok: false, error: "Geen SKU's opgegeven." }, { status: 400 });
  if (lines.length > 50) lines = lines.slice(0, 50);

  const country = String(body.country || "NL").trim().toUpperCase().slice(0, 2) || "NL";

  try {
    // Productnamen erbij, en meteen de check welke SKU's überhaupt bestaan —
    // een typefout in een SKU levert anders stilzwijgend een "niet leverbaar"
    // op, wat iets heel anders betekent dan "die SKU ken ik niet".
    const db = getDb();
    const rows = await db
      .select({ sku: productVariants.sku, title: products.title })
      .from(productVariants)
      .innerJoin(products, eq(products.id, productVariants.productId))
      .where(inArray(productVariants.sku, lines.map((l) => l.sku)));
    const titleBySku = new Map(rows.map((r) => [r.sku, r.title]));
    const unknownSkus = lines.filter((l) => !titleBySku.has(l.sku)).map((l) => l.sku);

    const input = lines.map((l) => ({ sku: l.sku, qty: l.qty, title: titleBySku.get(l.sku) || l.sku }));
    const plan = await allocateOrder(input, { country });

    return NextResponse.json({ ok: true, plan, unknownSkus, lineCount: lines.length, country });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
