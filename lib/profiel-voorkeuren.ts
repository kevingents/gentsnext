/**
 * lib/profiel-voorkeuren.ts
 *
 * De "wie ben jij"-laag van het klantprofiel: geboortedatum, leeftijdsgroep,
 * favoriete kleuren, vaste winkel en waarvoor je bij ons koopt.
 *
 * Bewust in customers.preferences (jsonb) en niet in losse kolommen: dit is een
 * lijst die blijft groeien, en een voorkeur erbij mag geen migratie op productie
 * kosten (migraties draaien hier handmatig). `favoriteStore` bestond al — die
 * sleutel is en blijft de bron voor "Mijn winkel" (lib/store-preference).
 *
 * Pure data + validatie, géén DB-import: het formulier (client) en de
 * bonus-engine (server) rekenen zo met exact dezelfde regels.
 */
import { COLOR_FAMILIES } from "@/lib/colors";

export type ProfilePreferences = {
  /** yyyy-mm-dd. Voor de verjaardagsattentie én om de leeftijdsgroep af te leiden. */
  birthDate?: string;
  /** Alternatief voor wie z'n exacte geboortedatum niet kwijt wil. */
  ageRange?: string;
  /** Kleurfamilies uit lib/colors — dezelfde sleutels als het PLP-kleurfilter. */
  favoriteColors?: string[];
  /** pageHandle van de vaste winkel (deelt de sleutel met "Mijn winkel"). */
  favoriteStore?: string;
  /** Waarvoor koopt deze klant? Slugs sluiten aan op /gelegenheden. */
  occasions?: string[];
  /** Vrij veld: "draag nooit bruin", "altijd extra lange mouw". */
  styleNote?: string;
};

export const AGE_RANGES: { key: string; label: string }[] = [
  { key: "18-24", label: "18 – 24" },
  { key: "25-34", label: "25 – 34" },
  { key: "35-44", label: "35 – 44" },
  { key: "45-54", label: "45 – 54" },
  { key: "55-64", label: "55 – 64" },
  { key: "65+", label: "65 en ouder" },
];

/* Waarvoor shop je? Slugs volgen /gelegenheden (lib/occasions-server) zodat een
   voorkeur later direct in merchandising/mailing te gebruiken is. "Uitvaart"
   staat er bewust NIET bij: dat is geen voorkeur die je aanvinkt. */
export const SHOP_OCCASIONS: { key: string; label: string }[] = [
  { key: "zakelijk", label: "Werk & zakelijk" },
  { key: "bruiloft", label: "Bruiloft" },
  { key: "gala-black-tie", label: "Gala & black tie" },
  { key: "casual", label: "Casual & weekend" },
  { key: "feest", label: "Feest & uitgaan" },
];

const COLOR_KEYS = new Set(COLOR_FAMILIES.map((c) => c.key as string));
const AGE_KEYS = new Set(AGE_RANGES.map((a) => a.key));
const OCCASION_KEYS = new Set(SHOP_OCCASIONS.map((o) => o.key));

/** Leeftijdsgroep uit een geboortedatum — zo hoeft de klant maar één van beide te geven. */
export function ageRangeFromBirthDate(iso: string): string {
  const d = new Date(String(iso || ""));
  if (isNaN(d.getTime())) return "";
  const nu = new Date();
  let leeftijd = nu.getFullYear() - d.getFullYear();
  const m = nu.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && nu.getDate() < d.getDate())) leeftijd--;
  if (leeftijd < 18) return ""; // te jong/onzin — dan liever geen groep dan een verkeerde
  if (leeftijd < 25) return "18-24";
  if (leeftijd < 35) return "25-34";
  if (leeftijd < 45) return "35-44";
  if (leeftijd < 55) return "45-54";
  if (leeftijd < 65) return "55-64";
  return "65+";
}

/**
 * Sanitizer: alleen bekende sleutels en bekende waarden komen erdoor. Een
 * onbekende winkel/kleur weigeren we stil (die kan uit een oude tab komen);
 * `knownStores` levert de aanroeper omdat de winkellijst content is, geen code.
 */
export function cleanPreferences(raw: unknown, knownStores?: Set<string>): ProfilePreferences {
  const b = (raw || {}) as Record<string, unknown>;
  const out: ProfilePreferences = {};

  const birth = String(b.birthDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    // Niet in de toekomst en niet absurd oud: houdt tikfouten ("0202-…", een
    // datum van volgend jaar) buiten het profiel — en dus buiten de bonus.
    const ms = Date.parse(`${birth}T00:00:00Z`);
    const nu = Date.now();
    if (!Number.isNaN(ms) && ms <= nu && nu - ms < 120 * 365.25 * 86400000) out.birthDate = birth;
  }

  const age = String(b.ageRange ?? "").trim();
  if (AGE_KEYS.has(age)) out.ageRange = age;
  // Geboortedatum wint: dan is de groep afgeleid en kan hij nooit tegenstrijdig staan.
  if (out.birthDate) {
    const afgeleid = ageRangeFromBirthDate(out.birthDate);
    if (afgeleid) out.ageRange = afgeleid;
  }

  if (Array.isArray(b.favoriteColors)) {
    out.favoriteColors = [...new Set(b.favoriteColors.map((c) => String(c).trim()))]
      .filter((c) => COLOR_KEYS.has(c))
      .slice(0, 6);
  }

  const store = String(b.favoriteStore ?? "").trim();
  if (store && (!knownStores || knownStores.has(store))) out.favoriteStore = store;

  if (Array.isArray(b.occasions)) {
    out.occasions = [...new Set(b.occasions.map((o) => String(o).trim()))]
      .filter((o) => OCCASION_KEYS.has(o))
      .slice(0, SHOP_OCCASIONS.length);
  }

  const note = String(b.styleNote ?? "").trim();
  if (note) out.styleNote = note.slice(0, 400);

  return out;
}

export type ProfileCheck = { key: string; labelKey: string; done: boolean };

/**
 * Waar wordt "profiel compleet" aan afgemeten? Bewust zichtbaar als lijstje in
 * de UI: de klant moet kunnen zien wat er nog mist voor z'n punten.
 *
 * Wat er NIET in zit: de nieuwsbrief-opt-in. Toestemming die je met punten
 * koopt is geen vrije toestemming (AVG) — de opt-in staat los in het formulier
 * en telt niet mee voor de bonus.
 */
export function profileChecklist(input: {
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  preferences?: ProfilePreferences | null;
}): ProfileCheck[] {
  const p = (input.preferences || {}) as ProfilePreferences;
  const gevuld = (v: unknown) => String(v ?? "").trim().length > 0;
  return [
    { key: "naam", labelKey: "account.prefs.check.name", done: gevuld(input.firstName) && gevuld(input.lastName) },
    { key: "telefoon", labelKey: "account.prefs.check.phone", done: gevuld(input.phone) },
    { key: "leeftijd", labelKey: "account.prefs.check.age", done: gevuld(p.birthDate) || gevuld(p.ageRange) },
    { key: "kleuren", labelKey: "account.prefs.check.colors", done: (p.favoriteColors?.length ?? 0) > 0 },
    { key: "winkel", labelKey: "account.prefs.check.store", done: gevuld(p.favoriteStore) },
    { key: "gelegenheden", labelKey: "account.prefs.check.occasions", done: (p.occasions?.length ?? 0) > 0 },
  ];
}

export function isProfileComplete(input: Parameters<typeof profileChecklist>[0]): boolean {
  return profileChecklist(input).every((c) => c.done);
}

/* ── Maatprofiel ──────────────────────────────────────────────────────────── */

/** De maten waar de bonus op telt — de velden die een retour voorkómen. */
export const SIZE_KEYS_FOR_BONUS = ["colbert", "broek", "overhemd", "schoen"] as const;

/**
 * Genoeg maatprofiel voor de bonus? Twee van de vier hoofdmaten. Het maatadvies
 * (/maatadvies) vult colbert + overhemd in één keer, dus wie het advies doorloopt
 * haalt 'm automatisch; wie z'n maten zelf intikt net zo goed. Eén losse
 * schoenmaat is te weinig — daar kan de webshop niets mee voor de pasvorm.
 */
export function sizeProfileComplete(sizeProfile: Record<string, unknown> | null | undefined): boolean {
  const sp = (sizeProfile || {}) as Record<string, unknown>;
  const gevuld = SIZE_KEYS_FOR_BONUS.filter((k) => String(sp[k] ?? "").trim().length > 0);
  return gevuld.length >= 2;
}
