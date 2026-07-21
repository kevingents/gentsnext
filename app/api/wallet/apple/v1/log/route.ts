export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PassKit web service — logboek. iOS post hier fouten naartoe (bv. push-issues).
 * We loggen ze beknopt server-side en bevestigen met 200; nooit falen.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { logs?: unknown[] };
    const logs = Array.isArray(body?.logs) ? body.logs : [];
    if (logs.length) console.log("[wallet/v1/log]", logs.slice(0, 5).map((l) => String(l).slice(0, 300)).join(" | "));
  } catch {
    /* lege/ongeldige body — negeren */
  }
  return new Response(null, { status: 200 });
}
