import { cookies } from "next/headers";
import { getStores, type Store } from "@/lib/stores";
import { getSessionCustomer } from "@/lib/account";

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
