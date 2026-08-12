import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { stockForSkus } from "@/lib/stock";
import { getSettings } from "@/lib/settings";
import { isFulfillable, isWarehouse, safetyBudgets, type StockChannel } from "@/lib/fulfillment-config";
import { safetyKey, verdeelBudget } from "@/lib/veiligheidsvoorraad-regels";

/**
 * Veiligheidsvoorraad = een budget PER ARTIKEL, niet per maat per filiaal.
 *
 * Kevin, 12 aug: "de veiligheidsmarge is 2 stuks totaal over alle maten". Zo was
 * het bedoeld; zo werkte het niet. Elke rekenplek trok de marge af van ELKE
 * (filiaal, sku)-regel, en een sku is één maat. Voor een overhemd met 5 gevulde
 * maten in 17 winkels hield de site daarmee geen 2 stuks vast maar ~44 —
 * catalogusbreed 44.855 van de 55.999 stuks winkelvoorraad (80%), waardoor 262
 * producten mét voorraad online volledig uitverkocht stonden.
 *
 * Nu: per artikel (= product, dus artikelnummer + kleur, met de hele maatboog
 * eronder) ligt `retailSafetyStock` vast over álle winkels samen en
 * `warehouseSafetyStock` over alle magazijnen samen. Het winkelkanaal (kassa)
 * heeft z'n eigen budget (`storeChannelSafetyStock`, default 0).
 *
 * VERDELING — dunste regel eerst. Het budget gaat naar de (filiaal, maat)-regels
 * met de mínste stuks, want daar zit precies het risico dat de marge afdekt: één
 * stuk aan het rek kan een displaystuk of een mistelling zijn. De diepte blijft
 * zo online verkoopbaar. Bij gelijke stand: laagste filiaalnummer, dan sku — puur
 * om de uitkomst DETERMINISTISCH te maken. Dat is essentieel: de PDP, de allocatie
 * en de kassa-lezing rekenen los van elkaar en moeten exact dezelfde stuks
 * vasthouden, anders verkoopt de site iets wat de allocatie niet mag pakken.
 *
 * Alleen LEVERBARE filialen doen mee (magazijn ∪ retail). Het budget op een
 * klachten-/transfiliaal-regel leggen zou de marge laten verdampen op voorraad
 * die toch nooit verzonden wordt.
 *
 * De verdeling loopt over de BRUTO SRS-baseline, niet over het netto getal ná
 * kassa-delta/reserveringen. Dat houdt 'm stabiel: elke consument trekt z'n eigen
 * dynamiek er daarna zelf af en iedereen komt op dezelfde vastgelegde stuks uit.
 * Gevolg (bewust, in lijn met store-core): een regel met baseline 1 en een
 * positieve kassa-delta kan op 0 uitkomen → onder-telling, nooit over-verkoop, en
 * zelfherstellend bij de eerstvolgende SRS-sync.
 */

/** `${branchId}|${lower(sku)}` → aantal stuks dat als veiligheidsvoorraad vastligt. */
export type SafetyAllocation = Map<string, number>;

export type SafetyRow = { branchId: string; sku: string; qty: number };

export { safetyKey, verdeelBudget };

type Groepering = {
  /** product-id → alle sku's van dat artikel (de hele maatboog). */
  groepen: Map<string, string[]>;
  /** opgegeven sleutel (barcode/afwijkende schrijfwijze) → de sku waar 'ie bij hoort. */
  alias: Map<string, string>;
  /** sleutels zonder product: die vormen hun eigen "artikel". */
  los: string[];
};

/**
 * Artikelsleutel → alle sku's van hetzelfde product. De opgegeven sleutels komen
 * uit verschillende hoeken (webshop: sku; kassa/scanner: barcode || sku), dus we
 * matchen op allebei en onthouden de alias — anders vindt een aanroeper die met
 * een barcode zoekt z'n eigen allocatie niet terug.
 */
async function artikelGroepen(keys: string[]): Promise<Groepering> {
  const groepen = new Map<string, string[]>();
  const alias = new Map<string, string>();
  const geraakt = new Set<string>();
  const lower = keys.map((k) => k.toLowerCase());
  const inList = sql.join(lower.map((k) => sql`${k}`), sql`, `);
  try {
    const db = getDb();
    const treffers = await db.execute<{ sku: string; barcode: string; product_id: string }>(sql`
      select sku, coalesce(barcode, '') as barcode, product_id::text as product_id
      from product_variants
      where lower(trim(sku)) in (${inList}) or lower(trim(barcode)) in (${inList})`);
    const productIds = new Set<string>();
    for (const r of treffers.rows) {
      productIds.add(String(r.product_id));
      const sku = String(r.sku || "").trim();
      const barcode = String(r.barcode || "").trim();
      for (const k of keys) {
        const kl = k.toLowerCase();
        if (kl !== sku.toLowerCase() && kl !== barcode.toLowerCase()) continue;
        geraakt.add(kl);
        if (sku && kl !== sku.toLowerCase()) alias.set(kl, sku);
      }
    }
    if (productIds.size) {
      const ids = [...productIds];
      const boog = await db.execute<{ sku: string; product_id: string }>(sql`
        select sku, product_id::text as product_id
        from product_variants
        where product_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
      for (const r of boog.rows) {
        const pid = String(r.product_id);
        const lijst = groepen.get(pid) || [];
        const sku = String(r.sku || "").trim();
        if (sku) lijst.push(sku);
        groepen.set(pid, lijst);
      }
    }
  } catch {
    // DB onbereikbaar → geen groepering; val terug op sleutel-voor-sleutel. De
    // marge is dan hooguit strenger, nooit ruimer (nooit over-verkoop).
  }
  return { groepen, alias, los: keys.filter((k) => !geraakt.has(k.toLowerCase())) };
}

/* Korte memo op (sleutels, kanaal). De pickup-checker vraagt dezelfde artikelen
   voor 19 winkels achter elkaar op en de PDP per render — zonder memo waren dat
   2 extra DB-rondes per aanroep. De onderliggende bronnen zijn zelf al gecached
   (voorraadindex 5 min, settings 30 s), dus 30 s hier verandert niets aan de
   versheid. Klein gehouden: boven de 200 sets gooien we 'm leeg. */
const MEMO_TTL = 30_000;
const _memo = new Map<string, { at: number; p: Promise<SafetyAllocation> }>();

/**
 * Leg de veiligheidsvoorraad vast voor de artikelen achter deze sleutels.
 * Lege map = niets vastgelegd (budget 0, of geen voorraad) → elke consument
 * trekt dan gewoon 0 af.
 */
export async function safetyAllocationFor(
  keys: string[],
  opts: { channel?: StockChannel } = {},
): Promise<SafetyAllocation> {
  const clean = [...new Set(keys.map((k) => String(k || "").trim()).filter(Boolean))].sort();
  if (!clean.length) return new Map();
  const memoKey = `${opts.channel ?? "web"}|${clean.join(",")}`;
  const hit = _memo.get(memoKey);
  // Elke aanroeper krijgt z'n eigen kopie: de gedeelde map mag nooit door één
  // consument gemuteerd worden onder de andere vandaan.
  if (hit && Date.now() - hit.at < MEMO_TTL) return new Map(await hit.p);
  const p = berekenAllocatie(clean, opts).catch((e) => {
    _memo.delete(memoKey); // een mislukte ronde niet 30 s lang vasthouden
    throw e;
  });
  if (_memo.size > 200) _memo.clear();
  _memo.set(memoKey, { at: Date.now(), p });
  return new Map(await p);
}

async function berekenAllocatie(
  clean: string[],
  opts: { channel?: StockChannel },
): Promise<SafetyAllocation> {
  const out: SafetyAllocation = new Map();
  const settings = await getSettings();
  // Budgetten per artikel. Allebei 0 → niets te verdelen; sla de DB-ronde over
  // (de kassa draait op storeChannelSafetyStock = 0 en blijft zo even snel).
  const { retail, warehouse } = safetyBudgets(settings, opts.channel ?? "web");
  if (retail <= 0 && warehouse <= 0) return out;

  const { groepen, alias, los } = await artikelGroepen(clean);
  const artikelen: string[][] = [...groepen.values(), ...los.map((k) => [k])];
  const alleSkus = [...new Set(artikelen.flat())];
  if (!alleSkus.length) return out;
  const voorraad = await stockForSkus(alleSkus);

  for (const skus of artikelen) {
    const magazijn: SafetyRow[] = [];
    const winkel: SafetyRow[] = [];
    for (const sku of skus) {
      const st = voorraad.get(sku);
      if (!st) continue;
      for (const b of st.byBranch) {
        if (!isFulfillable(b.branchId)) continue;
        (isWarehouse(b.branchId) ? magazijn : winkel).push({ branchId: b.branchId, sku, qty: b.qty });
      }
    }
    verdeelBudget(winkel, retail, out);
    verdeelBudget(magazijn, warehouse, out);
  }

  // Aliassen bijschrijven: wie met een barcode zoekt moet dezelfde stuks vinden
  // als wie met de sku zoekt (de allocatie zelf staat op de sku).
  for (const [aliasKey, sku] of alias) {
    for (const [k, n] of [...out]) {
      const [branchId, opSku] = k.split("|");
      if (opSku === sku.toLowerCase()) out.set(safetyKey(branchId, aliasKey), n);
    }
  }
  return out;
}
