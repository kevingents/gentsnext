import { NextResponse } from "next/server";
import { consumeMagicToken } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Verzilvert de magic-link → zet de sessie-cookie → stuurt door naar /account. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";
  const base = getSiteUrl();
  if (!token) return NextResponse.redirect(`${base}/account/login?error=token`);
  const ok = await consumeMagicToken(token);
  return NextResponse.redirect(`${base}/account${ok ? "" : "/login?error=verlopen"}`);
}
