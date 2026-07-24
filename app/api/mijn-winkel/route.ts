import { NextResponse } from "next/server";
import { getSessionCustomer, updatePreference } from "@/lib/account";
import { STORE_COOKIE, STORE_COOKIE_MAX_AGE, storeByPageHandle, storeByName } from "@/lib/store-preference";

export const dynamic = "force-dynamic";

/**
 * "Mijn winkel" kiezen of wissen. Werkt óók zonder account: de keuze gaat in een
 * cookie (server kent 'm dan bij de eerste render). Ingelogd? Dan slaan we 'm
 * daarnaast op in het profiel zodat de voorkeur meereist naar een ander apparaat.
 *
 * POST { store: "<pageHandle of winkelnaam>" }  → kiezen
 * POST { store: "" }                            → wissen
 */
export async function POST(req: Request) {
  let body: { store?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige aanvraag" }, { status: 400 });
  }

  const raw = String(body?.store || "").trim();
  if (!raw) {
    const res = NextResponse.json({ ok: true, store: null });
    res.cookies.set(STORE_COOKIE, "", { path: "/", maxAge: 0 });
    const customer = await getSessionCustomer().catch(() => null);
    if (customer) await updatePreference(customer.id, "favoriteStore", "").catch(() => {});
    return res;
  }

  // De UI stuurt de winkelnaam ("GENTS Utrecht") mee zoals die in de
  // voorraadrijen staat; een pageHandle mag ook. Onbekend → weigeren, zodat er
  // nooit een dode voorkeur in het profiel belandt.
  const store = storeByPageHandle(raw) ?? storeByName(raw);
  if (!store) return NextResponse.json({ ok: false, error: "onbekende winkel" }, { status: 400 });

  const res = NextResponse.json({ ok: true, store: { pageHandle: store.pageHandle, title: store.title, city: store.city } });
  res.cookies.set(STORE_COOKIE, store.pageHandle, {
    path: "/",
    maxAge: STORE_COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  const customer = await getSessionCustomer().catch(() => null);
  if (customer) await updatePreference(customer.id, "favoriteStore", store.pageHandle).catch(() => {});
  return res;
}
