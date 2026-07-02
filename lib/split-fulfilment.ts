import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Completeness-gate voor split-orders: een order die uit MEERDERE WINKELS geleverd
 * wordt, mag pas een verzendlabel krijgen als élk winkel-deel gepickt/gereed is —
 * anders zou een winkel z'n deel al versturen terwijl een ander filiaal nog moet
 * picken (half-verscheepte order). Elke winkel meldt zijn deel gereed
 * (setShipmentPicked); order-docs geeft pas een label als canReleaseLabel() waar is.
 *
 * Een "deel" = een niet-magazijn shipment in het fulfillment_plan. Het magazijn-deel
 * telt niet mee in de gate (het magazijn heeft z'n eigen pick-track en is geen
 * winkel-coördinatie); daardoor blokkeert een order uit 1 winkel + magazijn niet.
 */

type PlanShip = {
  store?: string;
  isWarehouse?: boolean;
  lines?: { sku?: string; qty?: number; title?: string }[];
  units?: number;
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** De winkel-delen (niet-magazijn) van een order-plan — de delen die fysiek in een
 *  winkel gepickt moeten worden vóór verzending. */
export function storeShipments(plan: unknown): { store: string; key: string; units: number }[] {
  const ships = (plan as { shipments?: PlanShip[] } | null)?.shipments || [];
  return ships
    .filter((s) => !s.isWarehouse && norm(s.store))
    .map((s) => ({
      store: String(s.store),
      key: norm(s.store),
      units: Number(s.units) || (s.lines?.reduce((n, l) => n + (Number(l.qty) || 0), 0) ?? 0),
    }));
}

export type PickShipment = { store: string; key: string; picked: boolean; pickedAt: string | null; pickedBy: string };
export type PickStatus = {
  /** Totaal aantal shipments (incl. magazijn). */
  parts: number;
  /** Aantal winkel-delen dat gepickt moet worden. */
  storeParts: number;
  pickedCount: number;
  /** Alle winkel-delen gereed. */
  allPicked: boolean;
  /** ≥2 winkel-delen → coördinatie nodig, gate is actief. */
  isSplit: boolean;
  shipments: PickShipment[];
};

/** Pick-status per winkel-deel voor een order (op basis van het meegegeven plan). */
export async function pickStatusForPlan(orderNumber: string, plan: unknown): Promise<PickStatus> {
  const stores = storeShipments(plan);
  const parts = ((plan as { shipments?: PlanShip[] } | null)?.shipments || []).length;

  let rows: { shipment_key: string; picked_by: string; picked_at: string }[] = [];
  if (stores.length) {
    const res = await getDb().execute<{ shipment_key: string; picked_by: string; picked_at: string }>(
      sql`select shipment_key, picked_by, to_char(picked_at, 'YYYY-MM-DD"T"HH24:MI:SS') picked_at
          from order_shipment_picks where order_number = ${orderNumber}`,
    );
    rows = res.rows;
  }
  const byKey = new Map(rows.map((r) => [r.shipment_key, r]));
  const shipments: PickShipment[] = stores.map((s) => {
    const hit = byKey.get(s.key);
    return { store: s.store, key: s.key, picked: Boolean(hit), pickedAt: hit?.picked_at ?? null, pickedBy: hit?.picked_by ?? "" };
  });
  const pickedCount = shipments.filter((s) => s.picked).length;
  return {
    parts,
    storeParts: stores.length,
    pickedCount,
    allPicked: stores.length > 0 && pickedCount >= stores.length,
    isSplit: stores.length >= 2,
    shipments,
  };
}

/**
 * Mag er een verzendlabel komen? Alleen blokkeren bij een echte multi-winkel-split
 * (≥2 winkel-delen) waar nog niet elk deel gereed is. Eén winkel (± magazijn) of
 * magazijn-only → altijd toegestaan (geen coördinatie tussen winkels nodig).
 */
export function canReleaseLabel(status: PickStatus): boolean {
  return !status.isSplit || status.allPicked;
}

/** Markeer (of ontmarkeer) een winkel-deel als gereed. Idempotent via unique-index. */
export async function setShipmentPicked(
  orderNumber: string,
  store: string,
  pickedBy: string,
  done: boolean,
): Promise<void> {
  const key = norm(store);
  if (!orderNumber || !key) return;
  const db = getDb();
  if (done) {
    await db.execute(sql`
      insert into order_shipment_picks (order_number, shipment_key, store, picked_by)
      values (${orderNumber}, ${key}, ${store}, ${pickedBy})
      on conflict (order_number, shipment_key)
      do update set picked_by = excluded.picked_by, picked_at = now()`);
  } else {
    await db.execute(sql`delete from order_shipment_picks where order_number = ${orderNumber} and shipment_key = ${key}`);
  }
}

/** Aantal gemelde winkel-delen per ordernummer (batch, voor de kassa-lijst). */
export async function pickedCountByOrder(orderNumbers: string[]): Promise<Map<string, number>> {
  const uniq = [...new Set(orderNumbers.filter(Boolean))];
  if (!uniq.length) return new Map();
  const res = await getDb().execute<{ order_number: string; c: number }>(
    sql`select order_number, count(*)::int c from order_shipment_picks
        where order_number in (${sql.join(uniq.map((o) => sql`${o}`), sql`, `)})
        group by order_number`,
  );
  return new Map(res.rows.map((r) => [r.order_number, Number(r.c)]));
}
