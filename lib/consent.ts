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
    window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: c }));
  } catch {
    /* leeg */
  }
}

/** Alleen tracken/analyseren ná expliciete opt-in. */
export function analyticsAllowed(): boolean {
  return readConsent()?.analytics ?? false;
}

/** Heropent de cookie-voorkeuren (bv. vanuit de footer). */
export function openConsent() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}
