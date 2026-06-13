import { NextResponse } from "next/server";
import { createStockNotification } from "@/lib/stock-notify";

export const dynamic = "force-dynamic";

/** Klant aanmelden voor een terug-op-voorraad-melding. */
export async function POST(req: Request) {
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const res = await createStockNotification({
    email: String(body.email || ""),
    productHandle: String(body.productHandle || ""),
    productTitle: String(body.productTitle || ""),
    sku: String(body.sku || ""),
    size: String(body.size || ""),
    color: String(body.color || ""),
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  return NextResponse.json({ ok: true });
}
