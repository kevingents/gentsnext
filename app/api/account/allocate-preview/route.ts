import { NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productVariants } from "@/db/schema";
import { getSessionCustomer } from "@/lib/account";
import { allocateOrder } from "@/lib/fulfillment";

export const dynamic = "force-dynamic";

/**
 * Admin: preview van de SRS-allocatie. Geef SKU's (regel per regel, optioneel
 * "sku aantal") → toont waar de order heen zou gaan (welke filialen/magazijn,
 * splitsing, levertijd, tekorten) ZONDER iets naar SRS te pushen.
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer?.isAdmin) return NextResponse.json({ ok: false, error: "geen toegang" }, { status: 403 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  let lines: { sku: string; qty: number }[] = [];
  if (Array.isArray(body?.lines)) {
    lines = body.lines.map((l: any) => ({ sku: String(l.sku || "").trim(), qty: Math.max(1, Math.floor(Number(l.qty) || 1)) }));
  } else if (typeof body?.text === "string") {
    lines = body.text.split(/\r?\n/).map((row: string) => {
      const parts = row.trim().split(/[\s,;]+/);
      return { sku: (parts[0] || "").trim(), qty: Math.max(1, Math.floor(Number(parts[1]) || 1)) };
    });
  }
  lines = lines.filter((l) => l.sku);
  if (!lines.length) return NextResponse.json({ ok: false, error: "Geen SKU's opgegeven." }, { status: 400 });
  if (lines.length > 50) lines = lines.slice(0, 50);

  // Productnamen erbij + check welke SKU's bestaan.
  const db = getDb();
  const rows = await db
    .select({ sku: productVariants.sku, title: products.title })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(inArray(productVariants.sku, lines.map((l) => l.sku)));
  const titleBySku = new Map(rows.map((r) => [r.sku, r.title]));
  const unknown = lines.filter((l) => !titleBySku.has(l.sku)).map((l) => l.sku);

  const input = lines.map((l) => ({ sku: l.sku, qty: l.qty, title: titleBySku.get(l.sku) || l.sku }));
  const plan = await allocateOrder(input, { country: "NL" });

  return NextResponse.json({ ok: true, plan, unknownSkus: unknown, lineCount: lines.length });
}
