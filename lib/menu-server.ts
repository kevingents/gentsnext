import { MAIN_MENU, MENU_SERVICE_LINKS, type MenuItem, type MenuLink } from "@/lib/main-menu";
import { getContentDoc } from "@/lib/content-store";

/**
 * Het hoofdmenu — uit onze eigen content-store (content:menu, beheerbaar in de
 * GENTS-portal) met de statische MAIN_MENU als seed/fallback. Vervangt Sanity.
 */
export async function getMenu(): Promise<MenuItem[]> {
  const doc = await getContentDoc<{ items: MenuItem[] }>("menu");
  return Array.isArray(doc?.items) && doc.items.length ? doc.items : MAIN_MENU;
}

/**
 * De servicelinks onderin de mobiele menu-drawer. Bewust een EIGEN document en
 * niet een veld in content:menu: twee routes schrijven dat menu-document met
 * `{ items }`, dus een extra veld daarin zou bij de eerstvolgende menu-opslag
 * stilzwijgend gewist worden.
 */
export async function getServiceLinks(): Promise<MenuLink[]> {
  const doc = await getContentDoc<{ links: MenuLink[] }>("menu-service");
  const links = (doc?.links || []).filter((l) => l?.label && l?.href);
  return links.length ? links : MENU_SERVICE_LINKS;
}
