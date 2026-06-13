import { stockForSkus } from "@/lib/stock";
import { getStores, DAYS } from "@/lib/stores";
import {
  isFulfillable,
  isWarehouse,
  branchPriority,
  safetyStockFor,
  CARRIER_CUTOFF_HOUR,
  BRANCH_CITY,
} from "@/lib/fulfillment-config";

/**
 * Order-allocatie ("welke filialen leveren wat"). Doelen, in volgorde:
 *  1. Order COMPLEET vanaf één locatie → bespaart verzendkosten.
 *  2. Magazijn eerst (retail-voorraad bewaren we voor de winkelklant).
 *  3. Kan het op meerdere plekken → die met de meeste voorraad.
 *  4. Lukt één locatie niet → zo min mogelijk splitsen, en binnen een split
 *     opnieuw magazijn + meeste voorraad.
 *  5. Openingstijden: een filiaal dat vandaag dicht is (bv. Hilversum op maandag)
 *     kan niet vandaag verzenden → we kiezen liever een open locatie.
 */

export type OrderLineInput = { sku: string; qty: number; title?: string };

export type ShipmentLine = { sku: string; qty: number; title?: string };
export type Shipment = {
  branchId: string;
  store: string;
  isWarehouse: boolean;
  canDispatchToday: boolean;
  dispatchLabel: string;
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
  canDispatchToday: boolean;
  dispatchLabel: string;
  avail: Map<string, number>; // sku → beschikbaar (na veiligheidsvoorraad)
};

/* ── Openingstijden → verzendmoment ──────────────────────────────────────── */
function nowNL(): { dayIndex: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const day = (parts.find((p) => p.type === "weekday")?.value || "").toLowerCase();
  const hour = Number(parts.find((p) => p.type === "hour")?.value || 0);
  const minute = Number(parts.find((p) => p.type === "minute")?.value || 0);
  return { dayIndex: Math.max(0, DAYS.indexOf(day)), minutes: hour * 60 + minute };
}

function openOn(branchId: string, dayName: string, hoursByCity: Map<string, Record<string, string>>): boolean {
  if (isWarehouse(branchId)) {
    // Magazijn verzendt op werkdagen (ma–vr).
    return dayName !== "zaterdag" && dayName !== "zondag";
  }
  const city = BRANCH_CITY[branchId];
  const hours = city ? hoursByCity.get(city.toLowerCase()) : undefined;
  if (!hours) return dayName !== "zaterdag" && dayName !== "zondag"; // onbekend → werkdagen
  return Boolean((hours[dayName] || "").trim());
}

/** Eerstvolgende verzenddag voor een filiaal + of dat vandaag nog kan. */
function dispatchInfo(branchId: string, hoursByCity: Map<string, Record<string, string>>) {
  const { dayIndex, minutes } = nowNL();
  for (let k = 0; k < 8; k++) {
    const day = DAYS[(dayIndex + k) % 7];
    if (!openOn(branchId, day, hoursByCity)) continue;
    if (k === 0 && minutes >= CARRIER_CUTOFF_HOUR * 60) continue; // vandaag na cutoff
    const canToday = k === 0;
    const label = k === 0 ? "vandaag" : k === 1 ? "morgen" : day;
    return { canDispatchToday: canToday, dispatchLabel: label };
  }
  return { canDispatchToday: false, dispatchLabel: "z.s.m." };
}

/* ── Kandidaat-filialen opbouwen ─────────────────────────────────────────── */
async function buildBranches(lines: OrderLineInput[]): Promise<Branch[]> {
  const skus = [...new Set(lines.map((l) => l.sku).filter(Boolean))];
  const stock = await stockForSkus(skus);

  const hoursByCity = new Map<string, Record<string, string>>();
  for (const s of getStores()) hoursByCity.set(s.city.toLowerCase(), s.hours);

  // Inverteer: branchId → { store, sku → qty }.
  const byBranch = new Map<string, { store: string; avail: Map<string, number> }>();
  for (const sku of skus) {
    const entry = stock.get(sku);
    if (!entry) continue;
    for (const b of entry.byBranch) {
      if (!isFulfillable(b.branchId)) continue;
      const net = b.qty - safetyStockFor(b.branchId);
      if (net <= 0) continue;
      let rec = byBranch.get(b.branchId);
      if (!rec) {
        rec = { store: b.store, avail: new Map() };
        byBranch.set(b.branchId, rec);
      }
      rec.avail.set(sku, net);
    }
  }

  const branches: Branch[] = [];
  for (const [branchId, rec] of byBranch) {
    const d = dispatchInfo(branchId, hoursByCity);
    branches.push({
      branchId,
      store: rec.store,
      isWarehouse: isWarehouse(branchId),
      priority: branchPriority(branchId),
      canDispatchToday: d.canDispatchToday,
      dispatchLabel: d.dispatchLabel,
      avail: rec.avail,
    });
  }
  return branches;
}

function totalAvail(b: Branch): number {
  let s = 0;
  for (const q of b.avail.values()) s += q;
  return s;
}

/** Comparator: vandaag-verzendbaar > magazijn/prioriteit > meeste voorraad. */
function better(a: Branch, b: Branch): number {
  if (a.canDispatchToday !== b.canDispatchToday) return a.canDispatchToday ? -1 : 1;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return totalAvail(b) - totalAvail(a);
}

/* ── Hoofd-allocatie ─────────────────────────────────────────────────────── */
export async function allocateOrder(lines: OrderLineInput[]): Promise<FulfillmentPlan> {
  const computedAt = new Date().toISOString();
  const branches = await buildBranches(lines);
  const titleBySku = new Map(lines.map((l) => [l.sku, l.title]));

  // 1. Single-source: een filiaal dat de HELE order dekt → bespaart verzendkosten.
  const fullCovers = branches.filter((b) => lines.every((l) => (b.avail.get(l.sku) ?? 0) >= l.qty));
  if (fullCovers.length) {
    const best = [...fullCovers].sort(better)[0];
    return {
      shipments: [toShipment(best, lines.map((l) => ({ sku: l.sku, qty: l.qty, title: l.title })))],
      splitCount: 1,
      fullyAllocated: true,
      shortages: [],
      strategy: "single-source",
      computedAt,
    };
  }

  // 2. Least-split greedy: kies steeds het filiaal dat de meeste resterende
  //    regels VOLLEDIG dekt; gelijkspel → magazijn/voorraad. Daarna pas splitsen.
  const need = new Map(lines.map((l) => [l.sku, l.qty]));
  const assigned = new Map<string, Map<string, number>>(); // branchId → sku → qty
  const work = branches.map((b) => ({ ...b, avail: new Map(b.avail) }));

  const assign = (b: Branch, sku: string, qty: number) => {
    if (qty <= 0) return;
    if (!assigned.has(b.branchId)) assigned.set(b.branchId, new Map());
    const m = assigned.get(b.branchId)!;
    m.set(sku, (m.get(sku) ?? 0) + qty);
    b.avail.set(sku, (b.avail.get(sku) ?? 0) - qty);
    need.set(sku, (need.get(sku) ?? 0) - qty);
  };

  let guard = 0;
  while ([...need.values()].some((q) => q > 0) && guard++ < 100) {
    const open = [...need.entries()].filter(([, q]) => q > 0).map(([sku]) => sku);

    // Beste filiaal op #volledig-dekbare regels.
    let pick: { b: (typeof work)[number]; full: string[] } | null = null;
    for (const b of work) {
      const full = open.filter((sku) => (b.avail.get(sku) ?? 0) >= (need.get(sku) ?? 0));
      if (!full.length) continue;
      if (
        !pick ||
        full.length > pick.full.length ||
        (full.length === pick.full.length && better(b, pick.b) < 0)
      ) {
        pick = { b, full };
      }
    }

    if (pick) {
      for (const sku of pick.full) assign(pick.b, sku, need.get(sku) ?? 0);
      continue;
    }

    // Geen enkel filiaal dekt een regel volledig → split de zwaarste regel.
    const sku = open.sort((a, c) => (need.get(c) ?? 0) - (need.get(a) ?? 0))[0];
    const suppliers = work
      .filter((b) => (b.avail.get(sku) ?? 0) > 0)
      .sort(better);
    let filled = false;
    for (const b of suppliers) {
      const take = Math.min(b.avail.get(sku) ?? 0, need.get(sku) ?? 0);
      assign(b, sku, take);
      filled = true;
      if ((need.get(sku) ?? 0) <= 0) break;
    }
    if (!filled) break; // niets meer beschikbaar → shortage
  }

  // Bouw shipments uit de toewijzingen.
  const shipments: Shipment[] = [];
  for (const [branchId, skuMap] of assigned) {
    const b = branches.find((x) => x.branchId === branchId)!;
    const sLines = [...skuMap.entries()]
      .filter(([, q]) => q > 0)
      .map(([sku, qty]) => ({ sku, qty, title: titleBySku.get(sku) }));
    if (sLines.length) shipments.push(toShipment(b, sLines));
  }
  // Magazijn-shipments eerst tonen.
  shipments.sort((a, b) => Number(b.isWarehouse) - Number(a.isWarehouse) || b.units - a.units);

  const shortages = [...need.entries()]
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
    lines,
    units: lines.reduce((s, l) => s + l.qty, 0),
  };
}
