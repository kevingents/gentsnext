import { stockForSkus } from "@/lib/stock";
import { getStores, DAYS } from "@/lib/stores";
import {
  isFulfillable,
  isWarehouse,
  branchPriority,
  branchCountry,
  safetyStockFor,
  cutoffHourFor,
  isHoliday,
  BRANCH_CITY,
} from "@/lib/fulfillment-config";
import { getSettings, type Settings } from "@/lib/settings";

/**
 * Order-allocatie ("welke filialen leveren wat"). Doelen, in volgorde:
 *  1. Order COMPLEET vanaf één locatie → bespaart verzendkosten.
 *  2. Magazijn eerst (retail-voorraad bewaren we voor de winkelklant).
 *  3. Kan het op meerdere plekken → die met de meeste voorraad.
 *  4. Geen single-source → zo min mogelijk splitsen; daarbinnen magazijn+voorraad.
 *  5. Openingstijden + feestdagen: een filiaal dat vandaag dicht is (Hilversum
 *     maandag, of een feestdag) of na cutoff → verzendt later; liever open.
 * Extra slimmigheden: pak-sets (groupId) blijven bij elkaar, onderbevoorrade
 * winkels (tekort) springen niet bij, en BE-klanten worden bij voorkeur vanuit
 * Antwerpen bediend (cross-border vermijden).
 */

export type OrderLineInput = { sku: string; qty: number; title?: string; groupId?: string };
export type AllocateOptions = { country?: string; postalCode?: string };

export type ShipmentLine = { sku: string; qty: number; title?: string };
export type Shipment = {
  branchId: string;
  store: string;
  isWarehouse: boolean;
  canDispatchToday: boolean;
  dispatchLabel: string;
  dispatchInDays: number;
  lines: ShipmentLine[];
  units: number;
};
export type FulfillmentPlan = {
  shipments: Shipment[];
  splitCount: number;
  fullyAllocated: boolean;
  shortages: { sku: string; qtyShort: number; title?: string }[];
  strategy: "single-source" | "least-split" | "unfulfillable";
  computedAt: string;
};

type Branch = {
  branchId: string;
  store: string;
  isWarehouse: boolean;
  priority: number;
  country: string;
  canDispatchToday: boolean;
  dispatchLabel: string;
  dispatchInDays: number;
  avail: Map<string, number>; // sku → beschikbaar (na veiligheidsvoorraad/tekort)
  surplus: number; // overstock-eenheden boven ideaal (proxy voor trage/oude schapvoorraad)
};

/* ── Tijd & openingstijden → verzendmoment ───────────────────────────────── */
function nowNL(): { dayIndex: number; minutes: number; y: number; m: number; d: number } {
  const fmt = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(new Date());
  const get = (t: string) => p.find((x) => x.type === t)?.value || "";
  const day = get("weekday").toLowerCase();
  return {
    dayIndex: Math.max(0, DAYS.indexOf(day)),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    y: Number(get("year")),
    m: Number(get("month")),
    d: Number(get("day")),
  };
}

/** yyyy-mm-dd voor 'k' dagen na de NL-datum (date-only, DST-veilig). */
function isoAtOffset(base: { y: number; m: number; d: number }, k: number): string {
  const t = Date.UTC(base.y, base.m - 1, base.d) + k * 86400000;
  const dt = new Date(t);
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${mm}-${dd}`;
}

function openOn(branchId: string, dayName: string, isoDate: string, hoursByCity: Map<string, Record<string, string>>): boolean {
  if (isHoliday(branchId, isoDate)) return false;
  if (isWarehouse(branchId)) return dayName !== "zaterdag" && dayName !== "zondag";
  const city = BRANCH_CITY[branchId];
  const hours = city ? hoursByCity.get(city.toLowerCase()) : undefined;
  if (!hours) return dayName !== "zaterdag" && dayName !== "zondag";
  return Boolean((hours[dayName] || "").trim());
}

function dispatchInfo(branchId: string, hoursByCity: Map<string, Record<string, string>>, settings: Settings) {
  const n = nowNL();
  // Cutoff van vandaag (per-weekdag, bv. magazijn vrijdag 16:00).
  const cutoff = cutoffHourFor(branchId, settings, DAYS[n.dayIndex]);
  for (let k = 0; k < 9; k++) {
    const day = DAYS[(n.dayIndex + k) % 7];
    const iso = isoAtOffset(n, k);
    if (!openOn(branchId, day, iso, hoursByCity)) continue;
    if (k === 0 && n.minutes >= cutoff * 60) continue;
    return { canDispatchToday: k === 0, dispatchLabel: k === 0 ? "vandaag" : k === 1 ? "morgen" : day, dispatchInDays: k };
  }
  return { canDispatchToday: false, dispatchLabel: "z.s.m.", dispatchInDays: 9 };
}

/* ── Kandidaat-filialen ──────────────────────────────────────────────────── */
async function buildBranches(skus: string[], settings: Settings): Promise<Branch[]> {
  const stock = await stockForSkus(skus);
  const hoursByCity = new Map<string, Record<string, string>>();
  for (const s of getStores()) hoursByCity.set(s.city.toLowerCase(), s.hours);

  const byBranch = new Map<string, { store: string; avail: Map<string, number>; surplus: number }>();
  for (const sku of skus) {
    const entry = stock.get(sku);
    if (!entry) continue;
    for (const b of entry.byBranch) {
      if (!isFulfillable(b.branchId)) continue;
      // Onderbevoorrade winkel beschermen: die voorraad heeft de winkel zelf nodig.
      if (settings.protectUnderstockedRetail && !isWarehouse(b.branchId) && b.tekort > 0) continue;
      const net = b.qty - safetyStockFor(b.branchId, settings);
      if (net <= 0) continue;
      let rec = byBranch.get(b.branchId);
      if (!rec) {
        rec = { store: b.store, avail: new Map(), surplus: 0 };
        byBranch.set(b.branchId, rec);
      }
      rec.avail.set(sku, net);
      // Overstock = voorraad boven het ideaal (alleen als er een ideaal bekend is —
      // ideaal=0 betekent "niet ingesteld", dan kunnen we geen doorloop afleiden).
      // Hoe meer boven ideaal, hoe trager/ouder die schapvoorraad: proxy voor doorloop.
      if (b.ideaal > 0) rec.surplus += Math.max(0, b.qty - b.ideaal);
    }
  }

  const branches: Branch[] = [];
  for (const [branchId, rec] of byBranch) {
    const d = dispatchInfo(branchId, hoursByCity, settings);
    branches.push({
      branchId,
      store: rec.store,
      isWarehouse: isWarehouse(branchId),
      priority: branchPriority(branchId),
      country: branchCountry(branchId),
      canDispatchToday: d.canDispatchToday,
      dispatchLabel: d.dispatchLabel,
      dispatchInDays: d.dispatchInDays,
      avail: rec.avail,
      surplus: rec.surplus,
    });
  }
  return branches;
}

function totalAvail(b: Branch): number {
  let s = 0;
  for (const q of b.avail.values()) s += q;
  return s;
}

/**
 * Comparator (kleiner = beter): vandaag-verzendbaar > zelfde land als klant >
 * [doorloop: ruim overstockte winkel eerst, instelbaar] > magazijn/prioriteit >
 * meeste overstock > meeste voorraad > stabiel filiaalnummer (reproduceerbaar).
 */
function makeComparator(country: string, settings: Settings) {
  const cc = (country || "NL").toUpperCase();
  const clearOverstock = settings.routeOverstockFirst?.enabled ?? false;
  const minSurplus = Math.max(1, settings.routeOverstockFirst?.minSurplus ?? 3);
  return (a: Branch, b: Branch): number => {
    if (a.canDispatchToday !== b.canDispatchToday) return a.canDispatchToday ? -1 : 1;
    const aSame = a.country === cc, bSame = b.country === cc;
    if (aSame !== bSame) return aSame ? -1 : 1;
    // Doorloop leegruimen: een winkel die ruim boven ideaal zit (≥ minSurplus) eerst
    // legen — mag dan zelfs vóór het magazijn (trage/oude schapvoorraad eerst weg).
    if (clearOverstock) {
      const aClear = !a.isWarehouse && a.surplus >= minSurplus;
      const bClear = !b.isWarehouse && b.surplus >= minSurplus;
      if (aClear !== bClear) return aClear ? -1 : 1;
    }
    if (a.priority !== b.priority) return b.priority - a.priority;
    if (clearOverstock && a.surplus !== b.surplus) return b.surplus - a.surplus; // meeste overstock eerst
    const ta = totalAvail(a), tb = totalAvail(b);
    if (ta !== tb) return tb - ta;
    return (Number(a.branchId) || 0) - (Number(b.branchId) || 0);
  };
}

/* ── Hoofd-allocatie ─────────────────────────────────────────────────────── */
export async function allocateOrder(lines: OrderLineInput[], opts: AllocateOptions = {}): Promise<FulfillmentPlan> {
  const computedAt = new Date().toISOString();

  // 0. Schoonmaken: lege/0-qty regels eruit; per SKU optellen (dubbele regels!).
  const clean = lines.filter((l) => l.sku && l.qty > 0);
  const need = new Map<string, number>();
  const titleBySku = new Map<string, string | undefined>();
  const groupSkus = new Map<string, Set<string>>(); // groupId → skus (pak-sets bij elkaar)
  for (const l of clean) {
    need.set(l.sku, (need.get(l.sku) ?? 0) + l.qty);
    if (!titleBySku.has(l.sku)) titleBySku.set(l.sku, l.title);
    if (l.groupId) {
      if (!groupSkus.has(l.groupId)) groupSkus.set(l.groupId, new Set());
      groupSkus.get(l.groupId)!.add(l.sku);
    }
  }
  const skus = [...need.keys()];
  if (!skus.length) {
    return { shipments: [], splitCount: 0, fullyAllocated: true, shortages: [], strategy: "single-source", computedAt };
  }

  const settings = await getSettings();
  const branches = await buildBranches(skus, settings);
  const better = makeComparator(opts.country || "NL", settings);

  // 1. Single-source: één filiaal dat de HELE order dekt → bespaart verzendkosten.
  const fullCovers = branches.filter((b) => skus.every((sku) => (b.avail.get(sku) ?? 0) >= (need.get(sku) ?? 0)));
  if (fullCovers.length) {
    const best = [...fullCovers].sort(better)[0];
    const sLines = skus.map((sku) => ({ sku, qty: need.get(sku)!, title: titleBySku.get(sku) }));
    return {
      shipments: [toShipment(best, sLines)],
      splitCount: 1,
      fullyAllocated: true,
      shortages: [],
      strategy: "single-source",
      computedAt,
    };
  }

  // 2. Least-split greedy met groep-bewustzijn.
  const remaining = new Map(need);
  const assigned = new Map<string, Map<string, number>>(); // branchId → sku → qty
  const work = branches.map((b) => ({ ...b, avail: new Map(b.avail) }));
  const branchById = new Map(work.map((b) => [b.branchId, b]));

  const assign = (b: Branch, sku: string, qty: number) => {
    if (qty <= 0) return;
    if (!assigned.has(b.branchId)) assigned.set(b.branchId, new Map());
    const m = assigned.get(b.branchId)!;
    m.set(sku, (m.get(sku) ?? 0) + qty);
    b.avail.set(sku, (b.avail.get(sku) ?? 0) - qty);
    remaining.set(sku, (remaining.get(sku) ?? 0) - qty);
  };

  // 2a. Pak-sets bij elkaar: probeer elke groep volledig uit één filiaal.
  for (const [, set] of groupSkus) {
    const gskus = [...set].filter((s) => (remaining.get(s) ?? 0) > 0);
    if (gskus.length < 2) continue;
    const cover = work.filter((b) => gskus.every((s) => (b.avail.get(s) ?? 0) >= (remaining.get(s) ?? 0)));
    if (!cover.length) continue; // geen filiaal heeft de hele set → laat aan greedy over
    const best = [...cover].sort(better)[0];
    for (const s of gskus) assign(best, s, remaining.get(s)!);
  }

  // 2b. Greedy: kies steeds het filiaal dat de meeste open regels VOLLEDIG dekt.
  let guard = 0;
  const maxGuard = skus.length * (work.length + 1) + 5;
  while ([...remaining.values()].some((q) => q > 0) && guard++ < maxGuard) {
    const open = [...remaining.entries()].filter(([, q]) => q > 0).map(([sku]) => sku);

    let pick: { b: (typeof work)[number]; full: string[] } | null = null;
    for (const b of work) {
      const full = open.filter((sku) => (b.avail.get(sku) ?? 0) >= (remaining.get(sku) ?? 0));
      if (!full.length) continue;
      if (!pick || full.length > pick.full.length || (full.length === pick.full.length && better(b, pick.b) < 0)) {
        pick = { b, full };
      }
    }
    if (pick) {
      for (const sku of pick.full) assign(pick.b, sku, remaining.get(sku)!);
      continue;
    }

    // Geen filiaal dekt een regel volledig → split de zwaarste regel; vul uit de
    // filialen met de MEESTE voorraad eerst (minste versnippering), dan prio.
    const sku = open.sort((a, c) => (remaining.get(c) ?? 0) - (remaining.get(a) ?? 0))[0];
    const suppliers = work
      .filter((b) => (b.avail.get(sku) ?? 0) > 0)
      .sort((a, b) => {
        const qa = a.avail.get(sku) ?? 0, qb = b.avail.get(sku) ?? 0;
        if (qa !== qb) return qb - qa;
        return better(a, b);
      });
    let filled = false;
    for (const b of suppliers) {
      const take = Math.min(b.avail.get(sku) ?? 0, remaining.get(sku) ?? 0);
      assign(b, sku, take);
      filled = true;
      if ((remaining.get(sku) ?? 0) <= 0) break;
    }
    if (!filled) break;
  }

  // Shipments bouwen, magazijn eerst.
  const shipments: Shipment[] = [];
  for (const [branchId, skuMap] of assigned) {
    const b = branchById.get(branchId)!;
    const sLines = [...skuMap.entries()]
      .filter(([, q]) => q > 0)
      .map(([sku, qty]) => ({ sku, qty, title: titleBySku.get(sku) }));
    if (sLines.length) shipments.push(toShipment(b, sLines));
  }
  shipments.sort((a, b) => Number(b.isWarehouse) - Number(a.isWarehouse) || b.units - a.units);

  const shortages = [...remaining.entries()]
    .filter(([, q]) => q > 0)
    .map(([sku, q]) => ({ sku, qtyShort: q, title: titleBySku.get(sku) }));

  return {
    shipments,
    splitCount: shipments.length,
    fullyAllocated: shortages.length === 0,
    shortages,
    strategy: shortages.length && !shipments.length ? "unfulfillable" : "least-split",
    computedAt,
  };
}

function toShipment(b: Branch, lines: ShipmentLine[]): Shipment {
  return {
    branchId: b.branchId,
    store: b.store,
    isWarehouse: b.isWarehouse,
    canDispatchToday: b.canDispatchToday,
    dispatchLabel: b.dispatchLabel,
    dispatchInDays: b.dispatchInDays,
    lines,
    units: lines.reduce((s, l) => s + l.qty, 0),
  };
}

/* ── Levertijd-schatting (vóór de checkout) ──────────────────────────────── */
export type DeliveryOption = {
  /** Bezorgdatum-label: "morgen", "overmorgen", "woensdag 17 juni". */
  dateLabel: string;
  /** Range-label voor standaard: "2-3 werkdagen". */
  rangeLabel: string;
  surchargeCents: number;
};
export type DeliveryEstimate = {
  inStock: boolean;
  fromWarehouseOnly: boolean;
  isSplit: boolean;
  hasStoreSource: boolean;
  /** Korte belofte voor PDP/cart. */
  promise: string;
  /** Cutoff-uur van vandaag (per-weekdag) voor de PDP-aftelteller. */
  cutoffHour: number;
  /** Uitleg waaróm het langer duurt (split/winkel) — logisch voor de klant. */
  note: string | null;
  standard: DeliveryOption;
  /** Express alleen aanwezig als het écht eerder is dan standaard. */
  express: DeliveryOption | null;
};

/** Volgende bezorgdag-offset (kalenderdagen) na 'startK', n leverdagen verder (ma–za, geen feestdag NL). */
function addDeliveryDays(base: { dayIndex: number; y: number; m: number; d: number }, startK: number, n: number): number {
  let k = startK;
  let added = 0;
  while (added < n) {
    k++;
    const day = DAYS[(base.dayIndex + k) % 7];
    const iso = isoAtOffset(base, k);
    if (day === "zondag") continue; // bezorgers leveren ma–za
    if (isHoliday("99", iso)) continue; // NL-feestdag
    added++;
  }
  return k;
}

function dayLabel(base: { dayIndex: number; y: number; m: number; d: number }, k: number): string {
  if (k === 1) return "morgen";
  if (k === 2) return "overmorgen";
  const dt = new Date(Date.UTC(base.y, base.m - 1, base.d) + k * 86400000);
  return new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(dt);
}

/**
 * Schat de bezorging vóór de checkout op basis van de ECHTE allocatie. Twee
 * opties: standaard (gratis) en sneller (+toeslag). Een split- of winkel-zending
 * duurt logischerwijs langer dan rechtstreeks uit het magazijn — dat leggen we
 * ook uit aan de klant. Alle dagen/toeslagen komen uit de instelbare settings.
 */
export async function estimateDelivery(lines: OrderLineInput[], opts: AllocateOptions = {}): Promise<DeliveryEstimate | null> {
  const settings = await getSettings();
  const plan = await allocateOrder(lines, opts);
  if (!plan.shipments.length) return null;

  const n = nowNL();
  const maxDispatch = Math.max(...plan.shipments.map((s) => s.dispatchInDays));
  const isSplit = plan.splitCount > 1;
  const hasStoreSource = plan.shipments.some((s) => !s.isWarehouse);
  const fromWarehouseOnly = !isSplit && !hasStoreSource;

  // Standaard transit: magazijn = snel (warehouseTransitDays); winkel/split = +extra.
  const stdTransit = settings.warehouseTransitDays + (fromWarehouseOnly ? 0 : settings.storeExtraDays);
  const stdMinK = addDeliveryDays(n, maxDispatch, stdTransit);
  const stdMaxK = addDeliveryDays(n, maxDispatch, stdTransit + 1);

  // Express: snelste werkdag na verzending.
  const expK = addDeliveryDays(n, maxDispatch, settings.expressTransitDays);
  const stdShownK = fromWarehouseOnly ? stdMinK : stdMaxK;

  const standard: DeliveryOption = {
    dateLabel: dayLabel(n, stdShownK),
    rangeLabel: fromWarehouseOnly ? `${settings.warehouseTransitDays}-${settings.warehouseTransitDays + 1} werkdagen` : `${settings.standardMinDays}-${settings.standardMaxDays} werkdagen`,
    surchargeCents: 0,
  };
  // Express kan ALLEEN als de hele order rechtstreeks uit het magazijn komt —
  // vanuit een winkel of bij een split is snelle levering niet mogelijk. En het
  // moet écht eerder in huis zijn dan standaard (anders betaalt de klant voor niks).
  const ed = settings.expressTransitDays;
  const express: DeliveryOption | null =
    fromWarehouseOnly && plan.fullyAllocated && expK < stdShownK
      ? { dateLabel: dayLabel(n, expK), rangeLabel: `${ed} werkdag${ed === 1 ? "" : "en"}`, surchargeCents: settings.expressSurchargeCents }
      : null;

  const note = isSplit
    ? "Je bestelling komt deels uit verschillende locaties; daarom kan een deel iets later aankomen."
    : hasStoreSource
      ? "Dit artikel versturen we vanuit een van onze winkels, wat iets langer duurt dan vanuit het magazijn."
      : null;

  // Cutoff van vandaag, per-weekdag, van het filiaal/de filialen die vandaag
  // verzenden (bv. magazijn vrijdag 16:00) — niet langer het basisuur.
  const today = DAYS[n.dayIndex];
  const todayShips = plan.shipments.filter((s) => s.dispatchInDays === 0);
  const cutoffHour = todayShips.length
    ? Math.min(...todayShips.map((s) => cutoffHourFor(s.branchId, settings, today)))
    : cutoffHourFor("99", settings, today);
  const beforeCutoff = maxDispatch === 0;
  const promise = beforeCutoff
    ? `Voor ${cutoffHour}:00 besteld, ${standard.dateLabel} in huis`
    : `Bezorging ${standard.dateLabel}`;

  return { inStock: plan.fullyAllocated, fromWarehouseOnly, isSplit, hasStoreSource, promise, cutoffHour, note, standard, express };
}
