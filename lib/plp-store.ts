import { getStoreStockCount, type ProductFilters } from "@/lib/catalog";
import { getMyStoresFromCookie, storeByPageHandle, storesFromPreferences, branchIdForStore } from "@/lib/store-preference";

/**
 * Het winkelfilter op de PLP ("alleen wat in mijn winkel ligt") — gedeeld door
 * /categorie en /collections, zodat beide lijsten hetzelfde doen.
 *
 * Twee losse dingen, bewust gescheiden:
 *  - het FILTER staat in de URL (?winkel=gents-utrecht,gents-breda) en bepaalt
 *    de query: op voorraad in ten mínste één van die winkels;
 *  - de GEKOZEN winkels (cookie/profiel) bepalen alleen wélke vinkjes je ziet
 *    en waarvoor we tellen.
 * Zo filtert een gedeelde link ook voor iemand met andere winkels, en zet het
 * hebben van een winkelvoorkeur nooit ongevraagd een filter aan.
 */

/** Filiaalnummers voor de query — onbekende winkel in de URL telt niet mee. */
export function storeFilterBranchIds(selStores: string[]): string[] {
  const out: string[] = [];
  for (const handle of selStores) {
    const store = storeByPageHandle(handle);
    const branchId = store ? branchIdForStore(store) : null;
    if (branchId && !out.includes(branchId)) out.push(branchId);
  }
  return out;
}

export type PlpStoreOption = { pageHandle: string; city: string; title: string; count: number | null };

export type PlpStoreProps = {
  /** Winkels met een vinkje in het filter: die van de klant + wat in de URL staat. */
  storeOptions: PlpStoreOption[];
  /** Winkelnamen van de klant — voor de kiezer (die werkt op naam). */
  myStoreTitles: string[];
};

/**
 * Props voor het filterpaneel. `preferences` komt uit de al opgehaalde klant, zo
 * kost de voorkeur van een ingelogde klant hier geen tweede databasevraag.
 */
export async function plpStoreProps(
  selStores: string[],
  preferences: unknown,
  base: Pick<ProductFilters, "collectionId" | "category">,
): Promise<PlpStoreProps> {
  const cookieStores = await getMyStoresFromCookie();
  const mijn = cookieStores.length ? cookieStores : storesFromPreferences(preferences);
  // Een gedeelde link kan een winkel bevatten die niet van deze klant is; die
  // hoort er wél bij te staan, anders staat het filter aan zonder vinkje.
  const extra = selStores
    .map((h) => storeByPageHandle(h))
    .filter((s): s is NonNullable<typeof s> => Boolean(s) && !mijn.some((m) => m.pageHandle === s!.pageHandle));
  const lijst = [...mijn, ...extra];

  const storeOptions = await Promise.all(
    lijst.map(async (store) => {
      const branchId = branchIdForStore(store);
      return {
        pageHandle: store.pageHandle,
        city: store.city,
        title: store.title,
        // Telling is per winkel gecached (180s), dus dit zijn hooguit een paar
        // goedkope treffers — en meestal heeft een klant één of twee winkels.
        count: branchId ? await getStoreStockCount(base, branchId) : null,
      };
    }),
  );
  return { storeOptions, myStoreTitles: mijn.map((s) => s.title) };
}
