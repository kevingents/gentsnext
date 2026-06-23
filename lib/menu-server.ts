import { MAIN_MENU, type MenuItem } from "@/lib/main-menu";
import { getContentDoc } from "@/lib/content-store";

/**
 * Het hoofdmenu — uit onze eigen content-store (content:menu, beheerbaar in de
 * GENTS-portal) met de statische MAIN_MENU als seed/fallback. Vervangt Sanity.
 */
export async function getMenu(): Promise<MenuItem[]> {
  const doc = await getContentDoc<{ items: MenuItem[] }>("menu");
  return Array.isArray(doc?.items) && doc.items.length ? doc.items : MAIN_MENU;
}
