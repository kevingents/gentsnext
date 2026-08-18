import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * Voorraad-sleutels komen uit verschillende hoeken in verschillende vormen: de
 * webshop vraagt op SKU (2900…), maar de kassa/scanner (storegents
 * article-search) keyt op `barcode || sku` — voor ~48% van de catalogus is dat
 * de leveranciers-EAN (8721…), níet de sku. De baseline (srs_stock →
 * lib/stock.ts) en de web-reserveringen sleutelen op sku, dus een EAN-query
 * leverde daar "systeem 0": stockForSkus(EAN) → EMPTY → available/by-branch
 * emitten niets → storegents valt stil terug op de (verouderende, soms kapotte)
 * SRS-blob-snapshot. Gemeten op prod (18 aug, Den Bosch): géén enkele
 * coreNet-vlag in de maatboog-respons terwijl de Neon-baseline gewoon klopte.
 *
 * Deze resolver vertaalt élke binnenkomende sleutelvorm naar het artikel:
 *   binnenkomend (lowercase) → { sku: canonieke SRS-sku, aliases: [sku,
 *   barcode, supplier_ean] (lowercase, uniek) }
 * De sku dient voor baseline/safety-lookups; de aliassen voor het
 * mutatie-grootboek en reserveringen, want dáár kunnen historische regels nog
 * onder de EAN geboekt staan (stockKey was tot de sku-eerst-fix barcode-eerst,
 * en nooit-naar-SRS-gsyncte correcties blijven eeuwig meetellen).
 *
 * Onbekende sleutel of DB-storing → de sleutel blijft zichzelf (exact het
 * gedrag van vóór deze resolver, dus nooit slechter).
 */

export type ResolvedStockKey = {
  /** Canonieke SRS-sku (originele schrijfwijze uit product_variants) — voor stockForSkus/safetyKey. */
  sku: string;
  /** Alle bekende sleutelvormen van deze variant, lowercase — voor movement-/reserveringslookups. */
  aliases: string[];
};

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();

/* Korte memo: de kassa-maatboog vraagt available + by-branch vlak na elkaar met
   dezelfde sleutelset op; de onderliggende variant-koppeling verandert hooguit
   bij een catalogus-sync. Zelfde patroon als de safety-stock-memo (30 s). */
const MEMO_TTL = 30_000;
const _memo = new Map<string, { at: number; p: Promise<Map<string, ResolvedStockKey>> }>();

export async function resolveStockAliases(keys: string[]): Promise<Map<string, ResolvedStockKey>> {
  const clean = [...new Set(keys.map(lower).filter(Boolean))].sort();
  if (!clean.length) return new Map();
  const memoKey = clean.join(",");
  const hit = _memo.get(memoKey);
  // Kopie per aanroeper — de gedeelde map mag niet onder een ander vandaan muteren.
  if (hit && Date.now() - hit.at < MEMO_TTL) return new Map(await hit.p);
  const p = lookupAliases(clean).catch(() => {
    _memo.delete(memoKey); // een mislukte ronde niet 30 s vasthouden
    return fallbackSelf(clean);
  });
  if (_memo.size > 200) _memo.clear();
  _memo.set(memoKey, { at: Date.now(), p });
  return new Map(await p);
}

function fallbackSelf(clean: string[]): Map<string, ResolvedStockKey> {
  const out = new Map<string, ResolvedStockKey>();
  for (const k of clean) out.set(k, { sku: k, aliases: [k] });
  return out;
}

async function lookupAliases(clean: string[]): Promise<Map<string, ResolvedStockKey>> {
  const out = fallbackSelf(clean);
  const db = getDb();
  const inList = sql.join(clean.map((k) => sql`${k}`), sql`, `);
  /* order by sku: bij een (foutieve) dubbele barcode over varianten wint
     deterministisch de laagste sku i.p.v. de toevallige rijvolgorde. */
  const rows = await db.execute<{ sku: string; barcode: string; supplier_ean: string }>(sql`
    select sku, coalesce(barcode, '') as barcode, coalesce(supplier_ean, '') as supplier_ean
    from product_variants
    where lower(trim(sku)) in (${inList})
       or lower(trim(barcode)) in (${inList})
       or lower(trim(supplier_ean)) in (${inList})
    order by sku
  `);
  for (const r of rows.rows) {
    const sku = norm(r.sku);
    if (!sku) continue;
    const aliases = [...new Set([lower(sku), lower(r.barcode), lower(r.supplier_ean)].filter(Boolean))];
    for (const a of aliases) {
      const cur = out.get(a);
      // Alleen nog-onopgeloste sleutels invullen (cur.sku === a = de fallback).
      if (cur && cur.sku === a && cur.aliases.length === 1) out.set(a, { sku, aliases });
    }
  }
  return out;
}
