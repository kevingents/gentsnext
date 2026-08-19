import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { storeStockMovements } from "@/db/schema";
import { stockForSkus, stockSyncedAt } from "@/lib/stock";
import { type StockChannel } from "@/lib/fulfillment-config";
import { safetyAllocationFor, safetyKey } from "@/lib/safety-stock";
import { resolveStockAliases, type ResolvedStockKey } from "@/lib/stock-key-alias";
import { orderPickRefBase, orderPickBeslissing } from "@/lib/order-pick-regels.js";

/**
 * Omnichannel voorraad-core (Fase A). De zelfgebouwde kassa (storegents) én de
 * webshop schrijven hier hun voorraad-mutaties naartoe — één transactioneel
 * grootboek bovenop de SRS-magazijn-baseline:
 *
 *   beschikbaar(locatie, artikel) = SRS-baseline(locatie) + Σ core-delta
 *
 * Append-only (audit + reconcilieerbaar). Idempotent op (ref, channel, stockKey)
 * zodat dezelfde verkoop niet dubbel boekt (offline-sync/retries).
 */

export type MovementLine = {
  barcode?: string | null;
  sku?: string | null;
  articleNumber?: string | null;
  qty: number;
  name?: string | null;
  color?: string | null;
  size?: string | null;
  lineType?: string | null; // 'custom' → geen voorraad-sleutel, overslaan
};

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();

/**
 * Voorraad-sleutel van een regel: sku > barcode > artikelnummer (lowercase).
 *
 * SKU EERST, en dat is cruciaal: de voorraad-BASELINE (srs_stock → lib/stock.ts) is
 * op de SRS-sku gesleuteld, en ÁLLE lezers vragen op sku op — availableForSkus (web),
 * availableInStore/availableBreakdown (kassa-gate /api/core/stock/available, checkout,
 * reserveringen, inventory-telling). Een barcode-query levert daar "systeem 0".
 *
 * Stond deze sleutel op barcode-eerst (zoals voorheen), dan werden de mutaties
 * (pos/correctie/reservering/inbound) van elk artikel met een eigen leveranciers-EAN
 * (~48% van de catalogus: barcode <> sku) NOOIT teruggevonden door de sku-reads: de
 * kassa/web-voorraadoverlay was de facto dood (0/103 POS-mutaties matchten een
 * baseline-sleutel, gemeten op prod) en verkopen werden pas bij de volgende SRS-sync
 * verrekend → oversell-venster. De inventory-telling loste dit voor de LEESkant al op
 * door bewust op sku te zoeken; deze sleutel trekt de SCHRIJFkant daarmee gelijk.
 * Barcode blijft de fallback voor gescande regels zonder sku (die matchen sowieso niet
 * op de sku-baseline, maar we willen ze wel uniek en idempotent boeken).
 */
export function stockKey(line: Pick<MovementLine, "barcode" | "sku" | "articleNumber"> = {}): string {
  const key = lower(line.sku) || lower(line.barcode) || lower(line.articleNumber);
  // Dienst-regels (vermaakservice, sku VERMAAK-<code>) zijn geen voorraad — zonder
  // deze uitsluiting zou elke kassa-verkoop/annulering/retour van een dienst een
  // fantoom-mutatie op een niet-bestaande sleutel in store_stock_movements schrijven.
  return key.startsWith("vermaak-") ? "" : key;
}

export type RecordInput = {
  location: string;
  channel?: "pos" | "web" | "correction" | "inbound" | "transfer";
  reason?: string;
  ref?: string | null;
  /** sign −1 = verkoop/reservering (eraf), +1 = inboeken/retour/vrijgave (erbij). Default −1. */
  sign?: 1 | -1;
  lines: MovementLine[];
};

/** Boek mutaties in het core-grootboek (geaggregeerd per stockKey). Idempotent op ref. */
export async function recordMovements(input: RecordInput): Promise<{ applied: { stockKey: string; delta: number }[] }> {
  const location = norm(input.location);
  if (!location) throw new Error("location vereist");
  const sign = input.sign === 1 ? 1 : -1;
  const channel = input.channel || "web";
  const reason = norm(input.reason);
  const ref = input.ref ? norm(input.ref) : null;

  const byKey = new Map<string, { delta: number; meta: Record<string, string> }>();
  for (const l of input.lines || []) {
    if (l?.lineType === "custom") continue;
    const key = stockKey(l);
    const qty = Math.abs(Math.round(Number(l?.qty) || 0));
    if (!key || qty === 0) continue;
    const cur = byKey.get(key) || {
      delta: 0,
      meta: { name: norm(l.name), color: norm(l.color), size: norm(l.size), barcode: norm(l.barcode), sku: norm(l.sku) },
    };
    cur.delta += sign * qty;
    byKey.set(key, cur);
  }
  const rows = [...byKey.entries()].map(([key, v]) => ({
    location,
    stockKey: key,
    delta: v.delta,
    channel,
    reason,
    ref,
    meta: v.meta,
  }));
  if (!rows.length) return { applied: [] };

  const db = getDb();
  await db
    .insert(storeStockMovements)
    .values(rows)
    .onConflictDoNothing({
      target: [storeStockMovements.ref, storeStockMovements.channel, storeStockMovements.stockKey],
    });
  return { applied: rows.map((r) => ({ stockKey: r.stockKey, delta: r.delta })) };
}

/**
 * Markeer de kassa-mutaties van een verkoop (ref = sale-id) als 'in SRS geboekt'.
 * De delta blijft nog meetellen tot een SRS-sync ná dit moment de baseline
 * bijwerkt; daarna valt 'ie uit de posDelta-som (geen dubbeltelling). Aangeroepen
 * door storegents zodra een POS-verkoop succesvol naar SRS is gepost.
 */
export async function markMovementsSrsPosted(ref: string, channel: "pos" | "inbound" | "transfer" = "pos"): Promise<void> {
  const r = String(ref || "").trim();
  if (!r) return;
  const ch = (["inbound", "transfer"] as const).includes(channel as "inbound" | "transfer") ? channel : "pos";
  const db = getDb();
  await db.execute(sql`
    update store_stock_movements
    set srs_posted_at = now()
    where ref = ${r} and channel = ${ch} and srs_posted_at is null
  `);
}

/**
 * Voorraad-afboeking van een WINKELDEEL van een (split-)bezorgweborder op het moment
 * van gereedmelden (/api/core/order-pick). Dit dicht het gat waarbij het stuk na
 * 'shipped' weer beschikbaar telde: de web-reservering hield het vast tot de order
 * verzonden was, maar er kwam nooit een échte −1 — niet hier en niet in SRS.
 *
 * KEUZE dubbeltelling (gedocumenteerd, zie ook webReservedAllLocations): de movement
 * wordt bij de PICK geboekt (−1, channel 'transfer'), en de web-reservering slaat
 * gepickte winkeldelen vanaf dat moment OVER (join op order_shipment_picks). Zo telt
 * het stuk tussen pick en shipped precies één keer mee (via de movement) en na
 * shipped blijft de −1 staan tot SRS de transferbon heeft geaccepteerd én de
 * baseline-sync 'm heeft overgenomen (srs_posted_at-mechaniek, zoals bij de
 * winkel-transfers). Alternatief was boeken bij het vrijvallen van de reservering
 * (shipped), maar dat moment is order-breed i.p.v. per winkeldeel en mist de
 * koppeling met de SRS-spiegel die storegents bij het gereedmelden boekt.
 *
 * Idempotent én undo-baar via het ref-tellertje in lib/order-pick-regels.js
 * (ORDERPICK-<order>-<winkel>[-n|-UNDO-n]). Retourneert de geboekte (of staande)
 * ref + of er daadwerkelijk NIEUW geboekt is — storegents spiegelt alleen een
 * nieuwe boeking naar SRS (transferbon 'naar' filiaal 90) en markeert de ref
 * daarna synced (coreMovementSynced).
 */
export async function recordOrderPickMovement(input: {
  orderNumber: string;
  /** Locatie zoals in het fulfillment-plan ("GENTS Groningen") — moet byte-gelijk
   *  zijn aan de locatie waarmee de kassa/web beschikbaarheid opvraagt. */
  store: string;
  /** Genormaliseerde winkelsleutel (plan-key, lowercase). */
  storeKey: string;
  lines: MovementLine[];
  done: boolean;
}): Promise<{ ref: string | null; booked: boolean }> {
  const base = orderPickRefBase(input.orderNumber, input.storeKey);
  if (!base || !Array.isArray(input.lines) || !input.lines.length) return { ref: null, booked: false };
  const db = getDb();
  const existing = await db.execute<{ ref: string }>(sql`
    select distinct ref from store_stock_movements
    where channel = 'transfer' and (ref = ${base} or ref like ${base + "-%"})
  `);
  const besluit = orderPickBeslissing(existing.rows.map((r) => String(r.ref)), base, input.done);
  if (!besluit.boek) return { ref: besluit.ref, booked: false };
  const { applied } = await recordMovements({
    location: input.store,
    channel: "transfer",
    reason: input.done ? "weborder-pick" : "weborder-pick-undo",
    ref: besluit.ref,
    sign: besluit.sign === 1 ? 1 : -1,
    lines: input.lines,
  });
  // applied is alleen leeg als geen enkele regel een voorraad-sleutel opleverde
  // (dienst-/custom-regels) — dan valt er ook niets naar SRS te spiegelen.
  // Een parallelle dubbelboeking op dezelfde ref vangt de unieke index af
  // (onConflictDoNothing in recordMovements): er landt hoe dan ook precies één rij.
  return { ref: besluit.ref, booked: applied.length > 0 };
}

/** Netto core-delta per stockKey voor één locatie. */
export async function coreDeltaForKeys(location: string, keys: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const loc = norm(location);
  const clean = [...new Set(keys.map(lower).filter(Boolean))];
  if (!loc || !clean.length) return out;
  const db = getDb();
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  const rows = await db.execute<{ stock_key: string; net: number }>(sql`
    select stock_key, sum(delta)::int as net
    from store_stock_movements
    where location = ${loc} and stock_key in (${sql.join(clean.map((k) => sql`${k}`), sql`, `)})
      and (srs_posted_at is null or srs_posted_at >= ${syncedAt.toISOString()})
    group by stock_key
  `);
  for (const r of rows.rows) out.set(r.stock_key, Number(r.net) || 0);
  return out;
}

/**
 * Web-reserveringen per stockKey voor één locatie. Afgeleid uit de orders +
 * hun fulfillment_plan (welke locatie welk artikel levert), zodat de KASSA de
 * lopende web-orders meeneemt en het laatste stuk niet dubbel verkoopt.
 *
 * Telt mee zolang een web-order betaald-maar-niet-verzonden is, óf verzonden ná
 * de laatste SRS-sync (model A voor het MAGAZIJN-deel: het magazijn pickt in SRS,
 * de eerstvolgende baseline-sync laat 'm zakken → reservering valt vrij).
 *
 * WINKEL-delen zijn hiervan uitgezonderd zodra ze GEREED gemeld zijn: het
 * gereedmelden (/api/core/order-pick) boekt sindsdien een échte −1-movement
 * (recordOrderPickMovement, channel 'transfer') die het stuk permanent afboekt —
 * de winkel boekt níét zelf in SRS uit, dus het model-A-mechanisme werkte daar
 * nooit en het stuk kwam na 'shipped' weer beschikbaar. Een gepickt deel hier
 * óók blijven meetellen zou dubbel aftrekken (movement + reservering); vandaar
 * de join op order_shipment_picks: gepickt deel → overslaan, de movement telt.
 */
export async function webReservedAllLocations(): Promise<Map<string, Map<string, number>>> {
  // locatie(lower) → (stockKey(lower) → gereserveerd aantal)
  const out = new Map<string, Map<string, number>>();
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  try {
    const db = getDb();
    // Alléén web-orders met een fulfillment_plan (geïmporteerde historie heeft er geen → uitgesloten).
    const rows = await db.execute<{ order_number: string; fulfillment_plan: unknown }>(sql`
      select order_number, fulfillment_plan from orders
      where (status in ('paid','ready_pickup')
             or (status in ('shipped','delivered') and updated_at > ${syncedAt.toISOString()}))
        and fulfillment_plan is not null
    `);
    // Gereed gemelde winkeldelen (order → set winkelsleutels): die zijn al als
    // movement afgeboekt en mogen niet óók als reservering meetellen.
    const picked = new Set<string>();
    const nums = [...new Set(rows.rows.map((r) => String(r.order_number || "")).filter(Boolean))];
    if (nums.length) {
      const p = await db.execute<{ order_number: string; shipment_key: string }>(sql`
        select order_number, shipment_key from order_shipment_picks
        where order_number in (${sql.join(nums.map((n) => sql`${n}`), sql`, `)})
      `);
      for (const r of p.rows) picked.add(`${r.order_number}|${lower(r.shipment_key)}`);
    }
    for (const r of rows.rows) {
      const plan = r.fulfillment_plan as { shipments?: { store?: string; lines?: { sku?: string; qty?: number }[] }[] } | null;
      for (const s of plan?.shipments || []) {
        const loc = lower(s.store);
        if (!loc) continue;
        // shipment_key = genormaliseerde winkelnaam (zelfde norm als loc).
        if (picked.has(`${String(r.order_number)}|${loc}`)) continue;
        let m = out.get(loc);
        if (!m) { m = new Map(); out.set(loc, m); }
        for (const l of s.lines || []) {
          const key = lower(l.sku);
          const qty = Math.abs(Math.round(Number(l.qty) || 0));
          if (!key || !qty) continue;
          m.set(key, (m.get(key) || 0) + qty);
        }
      }
    }
  } catch {
    // Bij een fout liever niets reserveren dan blokkeren.
  }
  return out;
}

/** Web-reserveringen per stockKey voor één locatie (gebruikt door de kassa-core). */
export async function webReservedForLocation(location: string): Promise<Map<string, number>> {
  const loc = lower(location);
  if (!loc) return new Map();
  return (await webReservedAllLocations()).get(loc) || new Map();
}

/** Kassa/pos-delta (core-grootboek) per locatie+stockKey voor een set artikelen. */
export async function posDeltaByLocationKey(keys: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  const clean = [...new Set(keys.map(lower).filter(Boolean))];
  if (!clean.length) return out;
  const db = getDb();
  const syncedAt = (await stockSyncedAt()) ?? new Date(0);
  const rows = await db.execute<{ location: string; stock_key: string; net: number }>(sql`
    select location, stock_key, sum(delta)::int as net
    from store_stock_movements
    where stock_key in (${sql.join(clean.map((k) => sql`${k}`), sql`, `)})
      and (srs_posted_at is null or srs_posted_at >= ${syncedAt.toISOString()})
    group by location, stock_key
  `);
  for (const r of rows.rows) {
    const loc = lower(r.location);
    let m = out.get(loc);
    if (!m) { m = new Map(); out.set(loc, m); }
    m.set(String(r.stock_key), Number(r.net) || 0);
  }
  return out;
}

/**
 * Sleutel-resolutie voor de LEESkant. De schrijfkant is al sku-eerst (zie
 * stockKey hierboven), maar aanroepers vragen nog in elke vorm op: de webshop
 * met de sku, de kassa/scanner (storegents article-search) met `barcode || sku`
 * — voor ~48% van de catalogus de leveranciers-EAN. De baseline en de
 * web-reserveringen sleutelen op sku, dus zonder resolutie leverde een
 * EAN-query "systeem 0" en viel storegents stil terug op de blob-snapshot
 * (gemeten op prod, 18 aug: nul coreNet-vlaggen in de kassa-maatboog).
 * Lookups: baseline/safety op de canonieke sku, het mutatie-grootboek en de
 * reserveringen over álle aliassen (historische regels kunnen nog EAN-gekeyd
 * zijn — vóór de sku-eerst-fix, en nooit-gsyncte correcties tellen eeuwig mee).
 */
function keyResolvers(aliasMap: Map<string, ResolvedStockKey>) {
  const skuOf = (key: string) => {
    const r = aliasMap.get(lower(key));
    if (!r) return key;
    // Niet via de catalogus opgelost (sku = de sleutel zelf, geen extra vormen)?
    // Dan de OORSPRONKELIJKE schrijfwijze teruggeven — stockForSkus matcht exact
    // op hoofdlettergebruik en dit was het gedrag van vóór de resolutie.
    return r.sku === lower(key) && r.aliases.length === 1 ? key : r.sku;
  };
  const aliasesOf = (key: string) => aliasMap.get(lower(key))?.aliases || [lower(key)];
  const sumOver = (m: Map<string, number> | undefined, key: string) =>
    m ? aliasesOf(key).reduce((s, a) => s + (m.get(a) || 0), 0) : 0;
  return { skuOf, aliasesOf, sumOver };
}

/**
 * Beschikbaar per artikel in één locatie =
 *   SRS-baseline(locatie) + core-delta(kassa/pos) − web-reservering(locatie).
 * Dit is de gedeelde waarheid: de kassa én de webshop rekenen hiermee, dus het
 * laatste stuk kan maar één keer verkocht worden (online of in de winkel).
 */
export async function availableInStore(location: string, keys: string[], opts: { channel?: StockChannel } = {}): Promise<Map<string, number>> {
  const loc = norm(location);
  const clean = [...new Set(keys.map(norm).filter(Boolean))];
  const out = new Map<string, number>();
  if (!clean.length) return out;
  const { skuOf, aliasesOf, sumOver } = keyResolvers(await resolveStockAliases(clean));
  const skus = [...new Set(clean.map(skuOf))];
  const [stock, delta, webRes, safetyAlloc] = await Promise.all([
    stockForSkus(skus),
    coreDeltaForKeys(loc, [...new Set(clean.flatMap(aliasesOf))]),
    webReservedForLocation(loc),
    safetyAllocationFor(skus, { channel: opts.channel }),
  ]);
  for (const key of clean) {
    const sku = skuOf(key);
    const st = stock.get(sku);
    const branch = st ? st.byBranch.find((b) => lower(b.store) === lower(loc)) : undefined;
    const baseline = branch?.qty ?? 0;
    const safety = branch ? safetyAlloc.get(safetyKey(branch.branchId, sku)) || 0 : 0;
    const net = baseline + sumOver(delta, key) - sumOver(webRes, key) - safety;
    out.set(key, Math.max(0, net));
  }
  return out;
}

/**
 * Beschikbaar mét uitsplitsing per artikel in één locatie — voor de kassa-weergave
 * (read-side cut-over): { baseline (SRS), posDelta (kassa), webReserved, available }.
 * Eén bron: de kassa toont deze getallen i.p.v. z'n eigen Blob-core.
 */
export async function availableBreakdown(
  location: string,
  keys: string[],
  opts: { channel?: StockChannel } = {},
): Promise<Map<string, { baseline: number; posDelta: number; webReserved: number; safety: number; available: number }>> {
  const loc = norm(location);
  const clean = [...new Set(keys.map(norm).filter(Boolean))];
  const out = new Map<string, { baseline: number; posDelta: number; webReserved: number; safety: number; available: number }>();
  if (!clean.length) return out;
  const { skuOf, aliasesOf, sumOver } = keyResolvers(await resolveStockAliases(clean));
  const skus = [...new Set(clean.map(skuOf))];
  const [stock, delta, webRes, safetyAlloc] = await Promise.all([
    stockForSkus(skus),
    coreDeltaForKeys(loc, [...new Set(clean.flatMap(aliasesOf))]),
    webReservedForLocation(loc),
    safetyAllocationFor(skus, { channel: opts.channel }),
  ]);
  for (const key of clean) {
    const sku = skuOf(key);
    const st = stock.get(sku);
    const branch = st ? st.byBranch.find((b) => lower(b.store) === lower(loc)) : undefined;
    const baseline = branch?.qty ?? 0;
    const safety = branch ? safetyAlloc.get(safetyKey(branch.branchId, sku)) || 0 : 0;
    const posDelta = sumOver(delta, key);
    const webReserved = sumOver(webRes, key);
    out.set(key, { baseline, posDelta, webReserved, safety, available: Math.max(0, baseline + posDelta - webReserved - safety) });
  }
  return out;
}

export type BranchAvailability = {
  branchId: string;
  store: string;
  baseline: number;
  posDelta: number;
  webReserved: number;
  safety: number;
  available: number;
};

/**
 * Beschikbaar per artikel, uitgesplitst over ÁLLE filialen tegelijk (één call).
 * Zelfde formule als availableInStore, maar dan voor elk filiaal dat het artikel
 * in de SRS-baseline heeft: net = max(0, baseline + posDelta − webReserved − safety).
 *
 * Dit is de bron van waarheid voor de voorraad-check aan de kassa (maatboog):
 * eigen winkel, magazijn én andere winkels komen zo uit dezelfde verse Neon-basis,
 * i.p.v. een aparte (verouderende) per-filiaal SRS-blob-snapshot. Efficiënt: één
 * baseline-index + één pos-delta-query + één web-reserverings-scan voor de hele set.
 *
 * Bekende beperking (bewust, low-impact & veilig): we lopen alleen over filialen die
 * het artikel in de SRS-baseline (qty>0) hebben. Een NIET-eigen filiaal met baseline 0
 * maar een positieve core-posDelta (bv. een retour/telling in een winkel die dit
 * artikel niet in de baseline had) wordt zo niet getoond → onder-telling, nooit
 * over-verkoop, en zelfherstellend bij de eerstvolgende SRS-sync. De EIGEN winkel
 * vangt dit al apart af in de kassa (article-search own-overlay).
 */
export async function availableByBranch(keys: string[], opts: { channel?: StockChannel } = {}): Promise<Map<string, BranchAvailability[]>> {
  const clean = [...new Set(keys.map(norm).filter(Boolean))];
  const out = new Map<string, BranchAvailability[]>();
  if (!clean.length) return out;
  const { skuOf, aliasesOf, sumOver } = keyResolvers(await resolveStockAliases(clean));
  const skus = [...new Set(clean.map(skuOf))];
  const [stock, posByLoc, webByLoc, safetyAlloc] = await Promise.all([
    stockForSkus(skus),
    posDeltaByLocationKey([...new Set(clean.flatMap(aliasesOf))]),
    webReservedAllLocations(),
    safetyAllocationFor(skus, { channel: opts.channel }),
  ]);
  for (const key of clean) {
    const sku = skuOf(key);
    const st = stock.get(sku);
    // stockForSkus levert voor een onbekend artikel de gedeelde EMPTY-sentinel (nooit
    // undefined) en voor een artikel met alleen 0-voorraadrijen een entry met lege
    // byBranch. In beide gevallen hebben we GEEN autoritatieve per-filiaal-data → de key
    // NIET emitteren, zodat storegents netjes terugvalt op de blob-bron (geen lege lijst
    // die alle filialen op 0 zou zetten).
    if (!st || !st.byBranch.length) continue;
    const list: BranchAvailability[] = [];
    for (const b of st.byBranch) {
      const loc = lower(b.store);
      const posDelta = sumOver(posByLoc.get(loc), key);
      const webReserved = sumOver(webByLoc.get(loc), key);
      const safety = safetyAlloc.get(safetyKey(b.branchId, sku)) || 0;
      list.push({
        branchId: b.branchId,
        store: b.store,
        baseline: b.qty,
        posDelta,
        webReserved,
        safety,
        available: Math.max(0, b.qty + posDelta - webReserved - safety),
      });
    }
    // Antwoord onder de OORSPRONKELIJKE sleutel — storegents zoekt terug op wat
    // het zelf stuurde (vaak de EAN), niet op de canonieke sku.
    out.set(key, list);
  }
  return out;
}

/** Recente core-mutaties (nieuwste eerst), optioneel op locatie. */
export async function listMovements(location?: string, limit = 100) {
  const db = getDb();
  const loc = norm(location);
  const rows = await db.execute<Record<string, unknown>>(sql`
    select id, location, stock_key, delta, channel, reason, ref, created_at
    from store_stock_movements
    ${loc ? sql`where location = ${loc}` : sql``}
    order by created_at desc
    limit ${Math.max(1, Math.min(500, limit))}
  `);
  return rows.rows;
}
