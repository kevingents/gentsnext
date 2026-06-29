import { NextResponse } from "next/server";
import { consumeMagicToken } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Verzilvert de magic-link → zet de sessie-cookie → stuurt door naar /account
 *  (of naar een veilige interne `next`, bv. terug naar de punten-claim-pagina). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const nextRaw = url.searchParams.get("next") || "";
  const safeNext = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "";
  const base = getSiteUrl();
  if (!token) return NextResponse.redirect(`${base}/account/login?error=token`);
  const ok = await consumeMagicToken(token);
  if (!ok) return NextResponse.redirect(`${base}/account/login?error=verlopen`);
  return NextResponse.redirect(`${base}${safeNext || "/account"}`);
}
