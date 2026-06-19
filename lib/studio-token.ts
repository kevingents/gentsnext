import { getSessionCustomer } from "@/lib/account";

/**
 * Auth voor de portal→gentsnext admin-API ("Nieuwe site"-CMS): een gentsnext-
 * admin-sessie (customers.isAdmin) OF de gedeelde server-to-server token
 * (STUDIO_API_TOKEN, zelfde als de studio/media-endpoints). Zo kan zowel een
 * ingelogde gentsnext-admin als de portal-BFF erbij.
 */
export async function adminOrToken(req: Request): Promise<boolean> {
  const customer = await getSessionCustomer().catch(() => null);
  if (customer?.isAdmin) return true;
  const want = (process.env.STUDIO_API_TOKEN || "").trim();
  const got = (req.headers.get("authorization") || req.headers.get("x-studio-token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return !!want && got === want;
}

/** Standaard datumbereik uit ?from&?to (ISO), default = laatste N dagen. */
export function rangeFromQuery(url: URL, defaultDays = 30): { from: Date; to: Date } {
  const to = parseDate(url.searchParams.get("to")) || new Date();
  const fromParam = parseDate(url.searchParams.get("from"));
  const from = fromParam || new Date(to.getTime() - defaultDays * 24 * 60 * 60 * 1000);
  return { from, to };
}

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
