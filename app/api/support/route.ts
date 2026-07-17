import { NextResponse } from "next/server";
import { rateLimit, fingerprint } from "@/lib/rate-limit";
import { getSessionCustomer } from "@/lib/account";
import { handleSupportQuestion } from "@/lib/support";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * AI-klantenservice: beantwoordt of escaleert een vraag. Voor een INGELOGDE
 * klant wordt het sessie-e-mailadres server-side meegegeven zodat
 * orderstatus-vragen met echte (geverifieerde) data beantwoord worden; het vrij
 * ingetikte e-mailveld blijft puur het antwoord-adres voor escalaties.
 */
export async function POST(req: Request) {
  // Backstop rate-limit per IP (LLM-call + DB-insert + escalatie-mail per request).
  const _ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const _rl = rateLimit("support:" + fingerprint(_ip), 8, 60000);
  if (!_rl.ok) return NextResponse.json({ ok: false, error: "Te veel verzoeken — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(_rl.retryAfterSec) } });
  let body: { question?: string; email?: string; forceEscalate?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "ongeldige body" }, { status: 400 });
  }
  const customer = await getSessionCustomer().catch(() => null);
  const res = await handleSupportQuestion(String(body.question || ""), String(body.email || ""), {
    sessionEmail: customer?.email || "",
    forceEscalate: body.forceEscalate === true,
  });
  return NextResponse.json(res);
}
