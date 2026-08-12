import { cookies } from "next/headers";
import { getStores, type Store } from "@/lib/stores";
import { getSessionCustomer } from "@/lib/account";
import { BRANCH_CITY } from "@/lib/fulfillment-config";

/**
 * "Mijn winkel" — de klant kiest één vaste winkel en ziet daarna overal meteen
 * of een artikel dáár ligt (vandaag ophalen / passen). Zelfde geest als
 * "Shop in jouw maat" (lib/size-match): een persoonlijke laag over de
 * bestaande data, géén extra voorraadquery — de PDP heeft de winkelvoorraad
 * per maat al binnen.
 *
 * Opslag bewust in een COOKIE (niet localStorage): dan kent de server de keuze
 * al bij de éérste render, dus geen flikkering of na-laden. Ingelogde klanten
 * krijgen 'm daarnaast in customers.preferences, zodat de keuze meereist naar
 * een andere telefoon. Cookie wint (dat is het apparaat waarop je nu kijkt).
 */

export const STORE_COOKIE = "gents-store";
/** Eén jaar: een winkelvoorkeur verandert zelden. */
export const STORE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function storeByPageHandle(handle: string): Store | null {
  const h = (handle || "").trim().toLowerCase();
  if (!h) return null;
  return getStores().find((s) => s.pageHandle.toLowerCase() === h) ?? null;
}

/** Winkelnaam ("GENTS Utrecht") → winkel; de voorraadrijen dragen de naam. */
export function storeByName(name: string): Store | null {
  const n = (name || "").trim().toLowerCase();
  if (!n) return null;
  return getStores().find((s) => s.title.toLowerCase() === n) ?? null;
}

/**
 * Filiaalnummer van een winkel — DE join-sleutel naar de voorraad (srs_stock
 * draagt branch_id, geen pageHandle). Loopt via de stad omdat content/stores.json
 * het filiaalnummer niet kent en BRANCH_CITY de enige plek is waar die koppeling
 * staat. Null = geen filiaal bekend (dan kun je er ook niet op filteren).
 */
export function branchIdForStore(store: Store): string | null {
  const city = store.city.trim().toLowerCase();
  const hit = Object.entries(BRANCH_CITY).find(([, c]) => c.toLowerCase() === city);
  return hit ? hit[0] : null;
}

/**
 * Winkels waar je op voorraad kunt filteren: alleen die met een filiaalnummer.
 * Een winkel zonder nummer zou een leeg resultaat geven zonder uit te leggen
 * waarom — dus bieden we 'm niet aan.
 */
export function storesWithBranch(): { store: Store; branchId: string }[] {
  return getStores()
    .map((store) => ({ store, branchId: branchIdForStore(store) }))
    .filter((x): x is { store: Store; branchId: string } => Boolean(x.branchId));
}

/**
 * Alleen de cookie, géén databasevraag. Voor plekken die op ÉLKE pagina renderen
 * (de kop): getMyStore() valt terug op het profiel en dat is een query per
 * paginaweergave. De cookie wordt gezet zodra de klant hier een winkel kiest, dus
 * op dit apparaat is dit hetzelfde antwoord.
 */
export async function getMyStoreFromCookie(): Promise<Store | null> {
  try {
    return storeByPageHandle((await cookies()).get(STORE_COOKIE)?.value || "");
  } catch {
    return null;
  }
}

/** De gekozen winkel voor dit verzoek (cookie → account → geen). */
export async function getMyStore(): Promise<Store | null> {
  try {
    const fromCookie = (await cookies()).get(STORE_COOKIE)?.value || "";
    const cookieStore = storeByPageHandle(fromCookie);
    if (cookieStore) return cookieStore;
  } catch {
    /* buiten een request-context (scripts) → geen voorkeur */
  }
  try {
    const customer = await getSessionCustomer();
    const prefs = (customer?.preferences ?? {}) as { favoriteStore?: unknown };
    return storeByPageHandle(String(prefs.favoriteStore || ""));
  } catch {
    return null;
  }
}

export type MyStoreStock = {
  /** Winkelnaam zoals in de voorraadrijen ("GENTS Utrecht"). */
  store: string;
  pageHandle: string;
  city: string;
  qty: number;
  /** false = deze winkel voert 'm niet / heeft 'm niet liggen. */
  inStock: boolean;
  openNow: boolean;
  openLabel: string;
};

/**
 * Voorraadstatus van de gekozen maat in mijn winkel. `branches` bevat alléén
 * filialen mét voorraad (zie lib/stock) — ontbreken betekent dus 0, niet
 * "onbekend"; daarom leveren we hier altijd een regel terug zodra de klant een
 * winkel gekozen heeft.
 */
export function myStoreStock(
  store: Store,
  branches: { store: string; qty: number; openNow?: boolean; openLabel?: string }[],
): MyStoreStock {
  const hit = branches.find((b) => b.store.toLowerCase() === store.title.toLowerCase());
  return {
    store: store.title,
    pageHandle: store.pageHandle,
    city: store.city,
    qty: hit?.qty ?? 0,
    inStock: (hit?.qty ?? 0) > 0,
    openNow: hit?.openNow ?? false,
    openLabel: hit?.openLabel ?? "",
  };
}
