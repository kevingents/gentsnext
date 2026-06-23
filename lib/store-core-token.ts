import { adminOrToken } from "@/lib/studio-token";

/**
 * Auth voor de omnichannel core-API. De kassa (storegents) authenticeert met een
 * dedicated bearer-token (STORE_CORE_TOKEN); een ingelogde admin of de
 * STUDIO_API_TOKEN mag ook (handig voor testen vanuit de portal).
 */
export async function coreAuth(req: Request): Promise<boolean> {
  const tok = process.env.STORE_CORE_TOKEN || "";
  if (tok && (req.headers.get("authorization") || "") === `Bearer ${tok}`) return true;
  return adminOrToken(req);
}
