import { NextResponse } from "next/server";
import { getSessionCustomer, updatePreference } from "@/lib/account";
import {
  STORE_COOKIE,
  STORE_COOKIE_MAX_AGE,
  MAX_MY_STORES,
  storeByPageHandle,
  storeByName,
  storesFromHandles,
  storesFromPreferences,
} from "@/lib/store-preference";
import type { Store } from "@/lib/stores";

export const dynamic = "force-dynamic";

/**
 * "Mijn winkels" kiezen of wissen. Werkt óók zonder account: de keuze gaat in een
 * cookie (server kent 'm dan bij de eerste render). Ingelogd? Dan slaan we 'm
 * daarnaast op in het profiel zodat de voorkeur meereist naar een ander apparaat.
 *
 * POST { toggle: "<pageHandle of winkelnaam>" }  → erbij of eraf (de UI-knop)
 * POST { stores: ["<handle>", …] }               → hele lijst zetten
 * POST { store: "<handle of naam>" }             → precies één winkel
 * POST { store: "" }                             → alles wissen
 *
 * Een klant komt vaak in meer dan één winkel (thuis, werk, familie), vandaar de
 * lijst; `favoriteStore` in het profiel blijft gelijk aan de eerste winkel omdat
 * de profielchecklist en de eenmalige winkel-bonus daaraan hangen.
 */
export async function POST(req: Request) {
  let body: { store?: unknown; stores?: unknown; toggle?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige aanvraag" }, { status: 400 });
  }

  const resolve = (raw: unknown): Store | null => {
    const v = String(raw ?? "").trim();
    return v ? storeByPageHandle(v) ?? storeByName(v) : null;
  };

  const customer = await getSessionCustomer().catch(() => null);
  let next: Store[];

  if (body.toggle !== undefined) {
    const store = resolve(body.toggle);
    // Onbekende winkel → weigeren, zodat er nooit een dode voorkeur ontstaat.
    if (!store) return NextResponse.json({ ok: false, error: "onbekende winkel" }, { status: 400 });
    const huidig = await huidigeWinkels(req, customer);
    next = huidig.some((s) => s.pageHandle === store.pageHandle)
      ? huidig.filter((s) => s.pageHandle !== store.pageHandle)
      : [...huidig, store].slice(0, MAX_MY_STORES);
  } else if (Array.isArray(body.stores)) {
    next = storesFromHandles(body.stores.map((v) => String(resolve(v)?.pageHandle ?? "")));
  } else {
    const raw = String(body.store ?? "").trim();
    if (!raw) next = [];
    else {
      const store = resolve(raw);
      if (!store) return NextResponse.json({ ok: false, error: "onbekende winkel" }, { status: 400 });
      next = [store];
    }
  }

  const handles = next.map((s) => s.pageHandle);
  let bonus: { kind: string; points: number } | null = null;
  if (customer) {
    await updatePreference(customer.id, "favoriteStores", handles).catch(() => {});
    await updatePreference(customer.id, "favoriteStore", handles[0] ?? "").catch(() => {});
    if (handles[0]) {
      /* Eenmalige winkel-bonus ook hier toekennen: een klant die z'n winkel op
         een productpagina kiest hoort dezelfde punten te krijgen als iemand die
         'm in z'n profiel zet — welk formulier je gebruikt mag niet uitmaken.
         awardBonus is idempotent, een tweede winkel levert dus niets extra op. */
      const { awardStoreBonusIfEarned } = await import("@/lib/loyalty-bonus");
      const r = await awardStoreBonusIfEarned({ id: customer.id, preferences: { favoriteStore: handles[0] } });
      if (r.awarded) bonus = { kind: "winkel", points: r.points };
    }
  }

  const res = NextResponse.json({
    ok: true,
    stores: next.map((s) => ({ pageHandle: s.pageHandle, title: s.title, city: s.city })),
    // Eén winkel meesturen voor oudere aanroepers.
    store: next[0] ? { pageHandle: next[0].pageHandle, title: next[0].title, city: next[0].city } : null,
    bonus,
  });
  if (handles.length) {
    res.cookies.set(STORE_COOKIE, handles.join(","), {
      path: "/",
      maxAge: STORE_COOKIE_MAX_AGE,
      sameSite: "lax",
    });
  } else {
    res.cookies.set(STORE_COOKIE, "", { path: "/", maxAge: 0 });
  }
  return res;
}

/** De lijst waar een toggle op werkt: cookie van dit apparaat, anders het profiel. */
async function huidigeWinkels(req: Request, customer: { preferences?: unknown } | null): Promise<Store[]> {
  // Bewust uit de binnenkomende request en niet via cookies(): dan werkt deze
  // route ook wanneer de cookie in dezelfde ronde al gezet is.
  const raw = req.headers.get("cookie") || "";
  const hit = raw.split(/;\s*/).find((c) => c.startsWith(`${STORE_COOKIE}=`));
  const fromCookie = hit ? storesFromHandles(decodeURIComponent(hit.slice(STORE_COOKIE.length + 1))) : [];
  if (fromCookie.length) return fromCookie;
  return customer ? storesFromPreferences(customer.preferences) : [];
}
