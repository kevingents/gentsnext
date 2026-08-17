/**
 * Cookie-/tracking-toestemming (AVG + Telecommunicatiewet art. 11.7a).
 * Functionele opslag is altijd toegestaan (noodzakelijk); analytics + marketing
 * vereisen vrije, specifieke opt-in. Geen pre-tick, gelijkwaardige weiger-knop.
 */
export type Consent = { analytics: boolean; marketing: boolean };

export const CONSENT_KEY = "gents-consent-v2";
export const CONSENT_EVENT = "gents-consent-change";
export const OPEN_CONSENT_EVENT = "gents-open-consent";

export function readConsent(): Consent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    return { analytics: !!c.analytics, marketing: !!c.marketing };
  } catch {
    return null;
  }
}

export function writeConsent(c: Consent) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(c));
    document.cookie = `${CONSENT_KEY}=${(c.analytics ? "a" : "") + (c.marketing ? "m" : "") || "0"}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    pushConsentMode(c);
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: c }));
  } catch {
    /* leeg */
  }
}

/**
 * Google Consent Mode v2 bijwerken. Hier en niet in lib/datalayer, omdat die
 * module `readConsent` hiervandaan haalt — elkaar over en weer importeren maakt
 * de laadvolgorde afhankelijk van toeval.
 *
 * Dit is ook het punt waar de marketing-schakelaar eindelijk iets DOET. Hij
 * stond al in de banner, werd netjes opgeslagen, en werd vervolgens nergens
 * uitgelezen: er hing letterlijk niets aan die keuze.
 */
export function pushConsentMode(c: Consent) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push({
    event: "consent_update",
    consent: {
      ad_storage: c.marketing ? "granted" : "denied",
      ad_user_data: c.marketing ? "granted" : "denied",
      ad_personalization: c.marketing ? "granted" : "denied",
      analytics_storage: c.analytics ? "granted" : "denied",
      functionality_storage: "granted",
      security_storage: "granted",
    },
  });
}

/** Alleen tracken/analyseren ná expliciete opt-in. */
export function analyticsAllowed(): boolean {
  return readConsent()?.analytics ?? false;
}

/** Heropent de cookie-voorkeuren (bv. vanuit de footer). */
export function openConsent() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}
