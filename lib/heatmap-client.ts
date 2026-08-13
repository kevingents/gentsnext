"use client";

/**
 * Klik-heatmap: waar klikken bezoekers écht, hoe ver komen ze op de pagina, en
 * waar klikken ze op iets dat niet klikbaar is.
 *
 * EIGEN RAIL, NAAST lib/track-client. Dat is een bewuste afwijking van "één
 * afvuurpunt". De catalogus-events (product_view, add_to_cart, purchase) zijn
 * schaars en kostbaar: die mogen nooit blijven staan achter een stroom kliks.
 * Een bezoeker vuurt op één productpagina een handvol catalogus-events af en
 * makkelijk twintig kliks; door die door dezelfde wachtrij van twaalf te
 * duwen zou elke funnel-meting achter de heatmap aan gaan hobbelen. Daarom een
 * eigen buffer, een eigen endpoint en een eigen tabel — en in
 * lib/event-catalog staat een verwijzing hierheen, zodat niemand zich afvraagt
 * waar de kliks gebleven zijn.
 *
 * WAT ER NIET IN GAAT: geen muisbewegingen, geen toetsaanslagen, geen
 * schermopnames, geen veldwaarden, geen tekst uit formulieren. Een klik levert
 * een positie, een elementpad en — buiten de checkout — het opschrift van de
 * knop of link. Zie lib/heatmap-paginas voor de allowlist en het schoonmaken.
 */

import { analyticsAllowed } from "@/lib/consent";
import { sessionId } from "@/lib/track-client";
import {
  apparaatVoorBreedte,
  magLabelVastleggen,
  paginaSjabloon,
  schoonLabel,
  type Apparaat,
  type KlikSoort,
} from "@/lib/heatmap-paginas";

type Klik = {
  /** x als promille (0–1000) van de vensterbreedte — apparaat-onafhankelijk. */
  x: number;
  /** y in CSS-pixels vanaf de bovenkant van het DOCUMENT, niet van het venster. */
  y: number;
  /** Positie binnen het geraakte element, in promille — overleeft herindeling. */
  ox: number;
  oy: number;
  sel: string;
  label: string;
  soort: KlikSoort;
};

/** Meer dan dit per paginaweergave zegt niets extra's en vult alleen de tabel. */
const MAX_KLIKKEN = 60;
/** Tussentijds versturen; de rest gaat mee op pagehide. */
const FLUSH_MS = 6000;

const KLIKBAAR = [
  "a", "button", "input", "select", "textarea", "label", "summary",
  "[role=button]", "[role=link]", "[role=tab]", "[role=checkbox]", "[role=switch]",
  "[data-klikbaar]", "[onclick]",
].join(",");

/** Elementen met tekst die als opschrift bruikbaar is. */
const HEEFT_OPSCHRIFT = "a,button,summary,label,[role=button],[role=link],[role=tab]";

/** Een id als ":r3:" of "radix-42" is per render anders — daar anker je niet op. */
const STABIEL_ID = /^[A-Za-z][A-Za-z0-9_-]{1,40}$/;

let pagina = "";
let pad = "";
let apparaat: Apparaat = "desktop";
let buffer: Klik[] = [];
let maxScrollPct = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let laatsteKlik = { t: 0, x: 0, y: 0, n: 0 };

function docHoogte(): number {
  const d = document.documentElement;
  return Math.max(d.scrollHeight, document.body?.scrollHeight || 0, 1);
}

/**
 * Elementpad van maximaal vijf niveaus. Stopt zodra er iets stabielers is: een
 * `data-heat`-markering (met de hand gezet op blokken die we willen volgen) of
 * een echt id. Zonder die stop zou elke selector tot aan <body> doorlopen en bij
 * de kleinste herindeling van de pagina niet meer terugvindbaar zijn.
 */
function selectorVoor(start: Element): string {
  const delen: string[] = [];
  let node: Element | null = start;
  for (let diepte = 0; node && diepte < 5; diepte++) {
    const tag = node.tagName.toLowerCase();
    if (tag === "body" || tag === "html") break;

    const merk = node.getAttribute("data-heat");
    if (merk) {
      delen.unshift(`@${merk.slice(0, 40)}`);
      break;
    }
    const id = node.getAttribute("id");
    if (id && STABIEL_ID.test(id)) {
      delen.unshift(`#${id}`);
      break;
    }
    const ouder: Element | null = node.parentElement;
    if (!ouder) break;
    const gelijken = Array.from(ouder.children).filter((k) => k.tagName === node!.tagName);
    delen.unshift(gelijken.length > 1 ? `${tag}:nth-of-type(${gelijken.indexOf(node) + 1})` : tag);
    node = ouder;
  }
  return delen.join(">").slice(0, 200);
}

function opschriftVoor(el: Element, paginaKey: string): string {
  if (!magLabelVastleggen(paginaKey)) return "";
  const drager = el.closest(HEEFT_OPSCHRIFT);
  if (!drager) return "";
  // aria-label vóór de zichtbare tekst: bij een icoonknop is dat het enige wat
  // er staat, en het is door ons geschreven in plaats van door de klant.
  const aria = drager.getAttribute("aria-label") || "";
  return schoonLabel(aria || (drager as HTMLElement).innerText || drager.textContent || "");
}

/** Drie kliks binnen 900 ms in een straal van 45 px = de bezoeker ramt erop. */
function isWoede(x: number, y: number): boolean {
  const nu = Date.now();
  const dichtbij = Math.abs(x - laatsteKlik.x) < 45 && Math.abs(y - laatsteKlik.y) < 45;
  laatsteKlik = dichtbij && nu - laatsteKlik.t < 900
    ? { t: nu, x, y, n: laatsteKlik.n + 1 }
    : { t: nu, x, y, n: 1 };
  return laatsteKlik.n >= 3;
}

function verstuur(viaBeacon: boolean) {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const klikken = buffer;
  const scrollPct = maxScrollPct;
  buffer = [];
  if (!klikken.length && scrollPct <= 0) return;
  if (!pagina) return;
  if (!analyticsAllowed()) {
    // Toestemming ingetrokken tussen vastleggen en versturen: weggooien.
    maxScrollPct = 0;
    return;
  }

  const body = JSON.stringify({
    pagina,
    pad,
    apparaat,
    sessie: sessionId(),
    docHoogte: docHoogte(),
    vensterBreedte: window.innerWidth,
    vensterHoogte: window.innerHeight,
    klikken,
    // Scroll gaat één keer per paginaweergave mee, als het diepste punt dat
    // gehaald is. Dat is precies wat een scroll-heatmap nodig heeft en het is
    // één rij in plaats van een regen van scroll-events.
    scrollPct: scrollPct > 0 ? scrollPct : null,
  });
  maxScrollPct = 0;

  try {
    if (viaBeacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/heatmap", new Blob([body], { type: "application/json" }));
    } else {
      fetch("/api/heatmap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* meten mag de site nooit breken */
  }
}

function plan() {
  if (timer) return;
  timer = setTimeout(() => verstuur(false), FLUSH_MS);
}

function opKlik(ev: MouseEvent) {
  // Toestemming toetsen bij het VASTLEGGEN, niet bij het binden. Iemand
  // accepteert de cookiebalk meestal op de pagina waar hij binnenkomt; werd de
  // toestemming alleen bij het binden gelezen, dan viel juist die eerste
  // pagina — vaak de landingspagina van een campagne — structureel buiten de
  // meting. Andersom mag er niets blijven hangen van vóór de keuze: een klik
  // zonder toestemming wordt hier weggegooid, niet bewaard tot later.
  if (!analyticsAllowed()) return;
  if (buffer.length >= MAX_KLIKKEN) return;
  const doel = ev.target as Element | null;
  if (!doel || doel.nodeType !== 1) return;
  // Ontsnappingsluik voor blokken die per se niet gemeten mogen worden.
  if (doel.closest("[data-heat-uit]")) return;

  const breedte = window.innerWidth || 1;
  const paginaY = Math.round(ev.clientY + window.scrollY);
  const x = Math.min(1000, Math.max(0, Math.round((ev.clientX / breedte) * 1000)));

  const vak = doel.getBoundingClientRect();
  const ox = vak.width > 0 ? Math.min(1000, Math.max(0, Math.round(((ev.clientX - vak.left) / vak.width) * 1000))) : 0;
  const oy = vak.height > 0 ? Math.min(1000, Math.max(0, Math.round(((ev.clientY - vak.top) / vak.height) * 1000))) : 0;

  const raaktKlikbaar = !!doel.closest(KLIKBAAR);
  const soort: KlikSoort = isWoede(ev.clientX, paginaY) ? "woede" : raaktKlikbaar ? "klik" : "dood";

  buffer.push({
    x,
    y: Math.min(200000, Math.max(0, paginaY)),
    ox,
    oy,
    sel: selectorVoor(doel),
    label: opschriftVoor(doel, pagina),
    soort,
  });
  plan();
}

function opScroll() {
  if (!analyticsAllowed()) return;
  const d = document.documentElement;
  const scrollbaar = docHoogte() - window.innerHeight;
  // Past de pagina in één scherm, dan is hij per definitie helemaal gezien.
  const pct = scrollbaar <= 0 ? 100 : Math.round(((window.scrollY || d.scrollTop) / scrollbaar) * 100);
  if (pct > maxScrollPct) maxScrollPct = Math.min(100, Math.max(0, pct));
}

/**
 * Aanroepen per paginaweergave (ook bij client-side navigatie). Geeft een
 * opruimfunctie terug die de laatste kliks van díé pagina nog wegschrijft —
 * anders verdwijnt alles wat er ná de laatste flush op de pagina gebeurde zodra
 * de bezoeker doorklikt.
 */
export function bindHeatmap(huidigPad: string): () => void {
  if (typeof window === "undefined") return () => {};

  // In een iframe niet meten. De site staat op X-Frame-Options SAMEORIGIN, dus
  // het enige dat haar kán inbedden zijn wij: de heatmap-viewer, die de pagina
  // in een frame zet om de kleurlaag eroverheen te leggen. Zonder deze regel
  // schrijft elke keer dat iemand de heatmap bekijkt een verse
  // paginaweergave weg — de meting zou zichzelf gaan meten.
  try {
    if (window.top !== window.self) return () => {};
  } catch {
    return () => {}; // cross-origin frame: al helemaal niet meten
  }

  const key = paginaSjabloon(huidigPad);
  if (!key) return () => {}; // pagina staat niet in de allowlist

  pagina = key;
  pad = String(huidigPad || "").split("?")[0].slice(0, 300);
  apparaat = apparaatVoorBreedte(window.innerWidth || 1024);
  buffer = [];
  maxScrollPct = 0;
  laatsteKlik = { t: 0, x: 0, y: 0, n: 0 };
  opScroll(); // korte pagina's tellen meteen als volledig gezien

  const opVerlaten = () => verstuur(true);
  const opVerborgen = () => {
    if (document.visibilityState === "hidden") verstuur(true);
  };

  document.addEventListener("click", opKlik, { capture: true, passive: true });
  window.addEventListener("scroll", opScroll, { passive: true });
  window.addEventListener("pagehide", opVerlaten);
  document.addEventListener("visibilitychange", opVerborgen);

  return () => {
    document.removeEventListener("click", opKlik, { capture: true });
    window.removeEventListener("scroll", opScroll);
    window.removeEventListener("pagehide", opVerlaten);
    document.removeEventListener("visibilitychange", opVerborgen);
    verstuur(true);
    pagina = "";
  };
}
