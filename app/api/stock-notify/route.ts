import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { createStockNotification } from "@/lib/stock-notify";
import { recordEvents } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** Klant aanmelden voor een terug-op-voorraad-melding. */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (DB-insert).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("stocknotify:" + fingerprint(_ip), 8, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }
  const res = await createStockNotification({
    email: String(body.email || ""),
    phone: String(body.phone || ""),
    channel: String(body.channel || "email"),
    productHandle: String(body.productHandle || ""),
    productTitle: String(body.productTitle || ""),
    sku: String(body.sku || ""),
    size: String(body.size || ""),
    color: String(body.color || ""),
  });
  if (!res.ok) return NextResponse.json(res, { status: 400 });

  // `stock_notify` stond al jaren in de toegestane lijst maar werd NERGENS
  // gevuurd — het sterkste vraagsignaal dat we hebben (klant wil dit artikel,
  // in deze maat, en laat er zijn adres voor achter) werd dus nooit geteld.
  // Server-side, zodat het ook telt bij wie analytics weigerde: dit is de
  // registratie van een aanvraag, geen gedragsmeting.
  recordEvents([
    {
      sessionId: "server",
      type: "stock_notify",
      path: "/api/stock-notify",
      handle: String(body.productHandle || ""),
      bron: "server",
      props: { sku: String(body.sku || ""), size: String(body.size || ""), kanaal: String(body.channel || "email") },
    },
  ]).catch(() => {});

  return NextResponse.json({ ok: true });
}
