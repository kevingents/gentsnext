import { NextResponse } from "next/server";
import {
  getSessionCustomer,
  mergePreferences,
  updateProfile,
  updateSizeProfile,
  type SizeProfile,
} from "@/lib/account";
import {
  awardProfileBonusIfEarned,
  awardSizeAdviceBonusIfEarned,
  awardStoreBonusIfEarned,
  type BonusKind,
} from "@/lib/loyalty-bonus";
import { cleanPreferences, type ProfilePreferences } from "@/lib/profiel-voorkeuren";
import { getStores } from "@/lib/stores";
import { STORE_COOKIE, STORE_COOKIE_MAX_AGE } from "@/lib/store-preference";

export const dynamic = "force-dynamic";

type Toegekend = { kind: BonusKind; points: number };

/** Alleen NIEUW toegekende bonussen melden — anders juicht de UI bij elke opslag. */
function toegekend(...paren: [BonusKind, { awarded: boolean; points: number }][]): Toegekend[] {
  return paren.filter(([, r]) => r.awarded).map(([kind, r]) => ({ kind, points: r.points }));
}

/**
 * Werkt persoonsgegevens, maatprofiel of stijlvoorkeuren bij voor de ingelogde
 * klant. Levert `bonuses` terug met elke eenmalige spaarpunten-bonus die déze
 * opslag oplevert — de server beslist dat, niet de client: het formulier kan
 * hooguit vragen om op te slaan.
 *
 * Het zijn er méér dan één tegelijk: wie in één keer z'n vaste winkel kiest én
 * daarmee z'n profiel afmaakt, verdient beide bonussen.
 */
export async function POST(req: Request) {
  const customer = await getSessionCustomer();
  if (!customer) return NextResponse.json({ ok: false, error: "niet ingelogd" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "ongeldige body" }, { status: 400 });
  }

  if (body.section === "size") {
    const incoming = (body.sizeProfile || {}) as SizeProfile;
    const base = (customer.sizeProfile || {}) as SizeProfile;
    let saved: SizeProfile;
    if (body.merge) {
      // Merge: alleen niet-lege velden over het bestaande profiel; zo overschrijft
      // het maatadvies (colbert/overhemd/pasvorm) niet je schoenmaat of notities.
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(incoming)) {
        if (typeof v === "string" && v.trim()) clean[k] = v.trim();
      }
      saved = { ...base, ...clean };
    } else {
      saved = incoming;
    }
    await updateSizeProfile(customer.id, saved);
    // Bonus is best-effort: mislukt hij, dan is het maatprofiel wél bewaard.
    const bonus = await awardSizeAdviceBonusIfEarned({ id: customer.id, sizeProfile: saved as Record<string, unknown> });
    return NextResponse.json({ ok: true, bonuses: toegekend(["maatadvies", bonus]) });
  }

  if (body.section === "preferences") {
    const handles = new Set(getStores().map((s) => s.pageHandle));
    const schoon = cleanPreferences(body.preferences, handles);
    /* Elke sleutel die dit formulier beheert gaat mee — óók leeg. Zo kan de klant
       een voorkeur weghalen; de sanitizer heeft ongeldige waarden er al uit. */
    const patch: Required<Pick<ProfilePreferences, "birthDate" | "ageRange" | "favoriteStore" | "styleNote">> & {
      favoriteColors: string[];
      occasions: string[];
    } = {
      birthDate: schoon.birthDate ?? "",
      ageRange: schoon.ageRange ?? "",
      favoriteStore: schoon.favoriteStore ?? "",
      styleNote: schoon.styleNote ?? "",
      favoriteColors: schoon.favoriteColors ?? [],
      occasions: schoon.occasions ?? [],
    };
    const preferences = await mergePreferences(customer.id, patch);
    /* Volgorde telt: eerst de winkel-bonus, dan de profielbonus. Wie in één keer
       z'n winkel kiest én daarmee z'n profiel afmaakt, hoort beide te krijgen —
       en de klant leest ze dan in de logische volgorde (kleine stap, hele set). */
    const winkel = await awardStoreBonusIfEarned({ ...customer, preferences });
    const profiel = await awardProfileBonusIfEarned({ ...customer, preferences });

    const res = NextResponse.json({ ok: true, bonuses: toegekend(["winkel", winkel], ["profiel", profiel]) });
    /* "Mijn winkel" leest primair een cookie (server kent de keuze dan al bij de
       eerste render). Die hier meteen meezetten, anders kiest de klant hier een
       vaste winkel en blijft de rest van de site z'n oude keuze tonen. */
    if (patch.favoriteStore) {
      res.cookies.set(STORE_COOKIE, patch.favoriteStore, { path: "/", maxAge: STORE_COOKIE_MAX_AGE, sameSite: "lax" });
    } else {
      res.cookies.set(STORE_COOKIE, "", { path: "/", maxAge: 0 });
    }
    return res;
  }

  const patch = {
    firstName: typeof body.firstName === "string" ? body.firstName : undefined,
    lastName: typeof body.lastName === "string" ? body.lastName : undefined,
    phone: typeof body.phone === "string" ? body.phone : undefined,
    marketingOptIn: typeof body.marketingOptIn === "boolean" ? body.marketingOptIn : undefined,
  };
  await updateProfile(customer.id, patch);
  // Naam en telefoon tellen mee voor "profiel compleet" — dus ook hier kijken.
  const bonus = await awardProfileBonusIfEarned({
    ...customer,
    firstName: patch.firstName ?? customer.firstName,
    lastName: patch.lastName ?? customer.lastName,
    phone: patch.phone ?? customer.phone,
  });
  return NextResponse.json({ ok: true, bonuses: toegekend(["profiel", bonus]) });
}
