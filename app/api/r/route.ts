import { NextResponse } from "next/server";
import { getSiteUrl } from "@/lib/site-url";
import { recordEvents } from "@/lib/analytics";
import { safeInternalPath } from "@/lib/safe-redirect";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/r?to=/products/foo&ev=alt_click&src=mail — meetbare doorklik.
 *
 * Voor links die buiten de site ontstaan (mail) en waar client-side tracking dus
 * niet bestaat: we tellen de klik server-side en sturen door naar de echte pagina.
 *
 * Privacy: bewust ALLEEN een aggregaat. Geen sessie-id, geen ordernummer, geen
 * cookie-uitlezing — we schrijven het producthandle en de bron. Daarmee is er
 * niets op de klant te herleiden en hangt de meting niet aan cookie-toestemming.
 * Zelfde lijn als het meetpunt bij een geboekte afspraak (/api/afspraak).
 *
 * Open redirect is de voor de hand liggende fout hier: `to` mag daarom alleen een
 * pad op onze eigen site zijn. Alles anders → naar de homepage, nooit doorsturen
 * naar een externe host.
 */

/** Toegestane event-types; onbekend type = niet meetellen (wel doorsturen). */
const ALLOWED_EVENTS = new Set(["alt_click"]);

export async function GET(req: Request) {
  const site = getSiteUrl();
  let target: string | null = null;
  let ev = "";
  let src = "";
  let handle = "";

  try {
    const url = new URL(req.url);
    target = safeInternalPath(url.searchParams.get("to") || "");
    ev = String(url.searchParams.get("ev") || "").slice(0, 40);
    src = String(url.searchParams.get("src") || "").slice(0, 40);
    handle = String(url.searchParams.get("h") || "").slice(0, 200);
  } catch {
    target = null;
  }

  if (!target) return NextResponse.redirect(site, 302);

  if (ALLOWED_EVENTS.has(ev)) {
    // Meten mag de doorverwijzing nooit ophouden of stukmaken.
    try {
      await recordEvents([{ type: ev, path: target, handle, props: src ? { src } : {} }]);
    } catch (e) {
      console.error("[r] meetpunt mislukt:", (e as Error).message);
    }
  }

  return NextResponse.redirect(`${site}${target}`, 302);
}
