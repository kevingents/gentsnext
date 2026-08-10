/**
 * Toegangscontrole voor de cron-routes (zie vercel.json). Eén plek, omdat het
 * eerder acht identieke kopietjes waren — inclusief acht keer dezelfde bug.
 *
 * Twee manieren binnen te komen:
 *  - `Authorization: Bearer <CRON_SECRET>` — zo roept Vercel de cron zelf aan;
 *  - `?secret=<CRON_SECRET>` — om 'm handmatig te kunnen aftrappen.
 *
 * Die tweede werkte niet met een base64-secret. `searchParams.get()` volgt de
 * form-encoding-regel en leest een `+` in de querystring als spatie, dus een
 * secret met een `+` erin (bij 44 tekens base64 nogal waarschijnlijk) matchte
 * nooit — en dat zag je alleen aan een 401 zonder uitleg. Daarom lezen we de
 * ruwe query en decoderen we met decodeURIComponent, die `+` met rust laat.
 * Zowel `?secret=ab+cd` als `?secret=ab%2Bcd` komt nu goed aan.
 *
 * De routes bepalen zélf of een ingelogde beheerder er ook bij mag; dit gaat
 * alleen over het geheim.
 */
function secretUitQuery(url: URL): string {
  const veld = url.search.replace(/^\?/, "").split("&").find((p) => p.startsWith("secret="));
  if (!veld) return "";
  try {
    return decodeURIComponent(veld.slice("secret=".length));
  } catch {
    // Kapotte percent-encoding: dan is het sowieso het geheim niet.
    return "";
  }
}

/** True als de aanroeper het cron-geheim meestuurt (header of querystring). */
export function cronSecretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  if (header === `Bearer ${secret}`) return true;
  return secretUitQuery(new URL(req.url)) === secret;
}
