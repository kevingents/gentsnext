"use client";

/**
 * Lichtgewicht client-tracker. Genereert een anonieme device-id, batcht events
 * en stuurt ze naar /api/track — met sendBeacon bij het verlaten van de pagina.
 *
 * Drie dingen die hier veranderd zijn ten opzichte van de eerste versie:
 *
 *  1. DE DEVICE-ID STAAT NU ÓÓK IN EEN COOKIE. Hij stond alleen in
 *     localStorage, en dat is voor de browser prima maar voor de SERVER
 *     onzichtbaar. Daardoor kon geen enkele server-route (inloggen, bestellen,
 *     een bon koppelen) het gedrag van vóór dat moment aan de klant hangen. De
 *     cookie is de brug: hij bevat exact dezelfde anonieme waarde, geen PII.
 *  2. ELK EVENT WORDT GESPIEGELD NAAR DE DATALAYER. Eén afvuurpunt, twee
 *     bestemmingen — zo kan er nooit iets in GA4 staan dat niet in onze eigen
 *     database staat, of andersom.
 *  3. ATTRIBUTIE REIST MEE. De eerste batch van een bezoek draagt de bron,
 *     campagne en klik-id's mee, zodat de server weet waar deze klant vandaan
 *     kwam.
 */

import { analyticsAllowed } from "@/lib/consent";
import { spiegelNaarDataLayer } from "@/lib/datalayer";
import { vangAttributie, type Attributie } from "@/lib/attributie-client";

const SID_KEY = "gents-sid";
type Ev = {
  type: string;
  path?: string;
  handle?: string;
  query?: string;
  valueCents?: number;
  props?: Record<string, unknown>;
};

let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** Attributie die nog verstuurd moet worden (gaat mee met de eerstvolgende batch). */
let openstaandeAttributie: Attributie | null = null;

function zetCookie(naam: string, waarde: string, dagen: number) {
  try {
    const veilig = location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${naam}=${encodeURIComponent(waarde)}; path=/; max-age=${dagen * 86400}; samesite=lax${veilig}`;
  } catch {
    /* stil */
  }
}

export function sessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let sid = localStorage.getItem(SID_KEY);
    if (!sid) {
      sid = crypto.randomUUID?.() || String(Date.now()) + Math.round(Math.random() * 1e9).toString(36);
      localStorage.setItem(SID_KEY, sid);
    }
    // Elke keer opnieuw zetten: verlengt de houdbaarheid én herstelt de cookie
    // als de gebruiker alleen zijn cookies wiste en localStorage behield.
    zetCookie(SID_KEY, sid, 365);
    return sid;
  } catch {
    return "";
  }
}

function flush(useBeacon = false) {
  if (!queue.length && !openstaandeAttributie) return;
  const sid = sessionId();
  const body: Record<string, unknown> = { events: queue.map((e) => ({ ...e, sessionId: sid })) };
  if (openstaandeAttributie) body.attributie = openstaandeAttributie;
  const payload = JSON.stringify(body);
  queue = [];
  openstaandeAttributie = null;
  try {
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else {
      fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* stil */
  }
}

export function track(type: string, props: Omit<Ev, "type"> = {}) {
  if (typeof window === "undefined") return;
  if (!analyticsAllowed()) return; // geen tracking zonder analytics-toestemming (AVG)

  // Spiegel eerst naar de dataLayer: die beslist zelf of marketing-toestemming
  // ontbreekt. Zo vertrekt een tag op hetzelfde moment als onze eigen meting en
  // kunnen de twee nooit uiteenlopen.
  spiegelNaarDataLayer(type, props.props ?? {}, props);

  queue.push({ type, ...props });
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => flush(false), 2500);
  if (queue.length >= 12) flush(false);
}

/*
 * Let op wat hier NIET staat: er gaat nooit een klant-id vanuit de browser mee.
 * De server leidt de klant af uit de eigen sessiecookie plus de device-id, en
 * negeert wat de client daarover beweert. Zou de client het mogen zeggen, dan
 * kan iedereen met een open console gedrag aan een willekeurige klant hangen.
 */

let gebonden = false;
export function bindFlushHandlers() {
  if (gebonden || typeof window === "undefined") return;
  gebonden = true;
  const onLeave = () => flush(true);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") onLeave();
  });
  window.addEventListener("pagehide", onLeave);
}

/**
 * Attributie van de huidige URL opvangen. Aanroepen bij elke navigatie: een
 * campagne-link kan ook midden in een bezoek binnenkomen (mail, retargeting).
 */
export function vangAttributieOp() {
  if (!analyticsAllowed()) return;
  const a = vangAttributie();
  if (a) openstaandeAttributie = a;
}

/**
 * Scrolldiepte: vuurt eenmalig per pagina op 25/50/75/90%. Meet of een lange
 * pagina (stijlgids, categorietekst, maatadvies) echt gelezen wordt of dat
 * iedereen na het eerste scherm afhaakt.
 */
export function bindScrollDiepte(path: string) {
  if (typeof window === "undefined") return () => {};
  const drempels = [25, 50, 75, 90];
  const gehaald = new Set<number>();
  const meet = () => {
    const doc = document.documentElement;
    const hoogte = doc.scrollHeight - window.innerHeight;
    if (hoogte <= 0) return;
    const pct = Math.round(((window.scrollY || doc.scrollTop) / hoogte) * 100);
    for (const d of drempels) {
      if (pct >= d && !gehaald.has(d)) {
        gehaald.add(d);
        track("scroll_diep", { path, props: { percent: d } });
      }
    }
  };
  window.addEventListener("scroll", meet, { passive: true });
  return () => window.removeEventListener("scroll", meet);
}
