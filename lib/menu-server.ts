import { getSanityMenu, urlForImage, type SanityMenu } from "@/lib/sanity";
import { MAIN_MENU, type MenuItem } from "@/lib/main-menu";

/**
 * Het hoofdmenu — uit Sanity (beheerbaar in de Studio) met de statische
 * MAIN_MENU als veilige fallback wanneer er (nog) geen menu in de CMS staat.
 */
export async function getMenu(): Promise<MenuItem[]> {
  try {
    const data = await getSanityMenu();
    const items = (data?.items || []).map(fromSanity).filter(Boolean) as MenuItem[];
    return items.length ? items : MAIN_MENU;
  } catch {
    return MAIN_MENU;
  }
}

function fromSanity(it: NonNullable<SanityMenu["items"]>[number]): MenuItem | null {
  if (!it?.label) return null;
  const columns = (it.columns || [])
    .map((c) => ({ title: c.title, links: (c.links || []).filter((l) => l?.label && l?.href) }))
    .filter((c) => c.links.length);
  const featImg = it.feature?.image ? urlForImage(it.feature.image, 600) : "";
  const features =
    it.feature && featImg && it.feature.href
      ? [{ label: it.feature.label || "", caption: it.feature.caption, href: it.feature.href, image: featImg }]
      : [];
  return {
    label: it.label,
    href: it.href || "#",
    ...(columns.length ? { columns } : {}),
    ...(features.length ? { features } : {}),
  };
}
