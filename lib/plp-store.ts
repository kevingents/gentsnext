import { getStoreStockCount, type ProductFilters } from "@/lib/catalog";
import { getMyStoreFromCookie, storeByPageHandle, storesWithBranch, branchIdForStore } from "@/lib/store-preference";

/**
 * Het winkelfilter op de PLP ("alleen wat in mijn winkel ligt") — gedeeld door
 * /categorie en /collections, zodat beide lijsten hetzelfde doen.
 *
 * Twee losse dingen, bewust gescheiden:
 *  - het FILTER staat in de URL (?winkel=gents-utrecht) en bepaalt de query;
 *  - de GEKOZEN winkel (cookie/profiel) bepaalt alleen wat er voorgeselecteerd
 *    in de keuzelijst staat en waarvoor we het aantal tellen.
 * Zo filtert een gedeelde link ook voor iemand met een andere winkel, en zet het
 * hebben van een winkelvoorkeur nooit ongevraagd een filter aan.
 */

/** Filiaalnummer voor de query — onbekende winkel in de URL = geen filter. */
export function storeFilterBranchId(selStore?: string): string | undefined {
  const store = selStore ? storeByPageHandle(selStore) : null;
  return store ? branchIdForStore(store) ?? undefined : undefined;
}

export type PlpStoreProps = {
  stores: { pageHandle: string; city: string; title: string }[];
  myStore: string | null;
  storeCount: number | null;
};

/**
 * Props voor het filterpaneel. `customerFavorite` komt uit de al opgehaalde
 * klant (customers.preferences.favoriteStore) — zo kost de voorkeur van een
 * ingelogde klant hier geen tweede databasevraag.
 */
export async function plpStoreProps(
  selStore: string | undefined,
  customerFavorite: unknown,
  base: Pick<ProductFilters, "collectionId" | "category">,
): Promise<PlpStoreProps> {
  const list = storesWithBranch();
  const cookieStore = await getMyStoreFromCookie();
  const myStore = cookieStore ?? storeByPageHandle(String(customerFavorite || ""));
  // Tellen doen we voor de winkel die de klant nú ziet staan: het filter uit de
  // URL, anders de eigen winkel — anders belooft de knop een getal van een
  // andere winkel.
  const shown = (selStore ? storeByPageHandle(selStore) : null) ?? myStore;
  const branchId = shown ? branchIdForStore(shown) : null;
  return {
    stores: list.map(({ store }) => ({ pageHandle: store.pageHandle, city: store.city, title: store.title })),
    myStore: myStore?.pageHandle ?? null,
    storeCount: branchId ? await getStoreStockCount(base, branchId) : null,
  };
}
