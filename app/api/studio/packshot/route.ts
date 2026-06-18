import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { generatePackshot } from "@/lib/packshot";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/studio/packshot — genereert een AI-packshot uit tekst voor een
 * product zonder bronfoto (gebruikt door de portal-Fotostatus-tool). Auth: een
 * gentsnext-admin-sessie OF de server-to-server token (STUDIO_API_TOKEN).
 *
 * Body: { title, color?, hoofdgroep?, ref? } → { ok, url, prompt } | { ok:false, error }
 */
function tokenOk(req: Request): boolean {
  const want = (process.env.STUDIO_API_TOKEN || "").trim();
  if (!want) return false;
  const got = (req.headers.get("authorization") || req.headers.get("x-studio-token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return !!got && got === want;
}

export async function POST(req: Request) {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer?.isAdmin && !tokenOk(req)) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  let body: { title?: unknown; color?: unknown; hoofdgroep?: unknown; ref?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const res = await generatePackshot({
    title: String(body?.title || ""),
    color: body?.color ? String(body.color) : null,
    hoofdgroep: body?.hoofdgroep ? String(body.hoofdgroep) : null,
    ref: body?.ref ? String(body.ref) : null,
  });
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
