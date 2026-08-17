import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { productImages, products } from "@/db/schema";
import { shopifyGeconfigureerd, shopifyGraphql } from "@/lib/shopify-sync";

/**
 * Productfoto's uit Shopify bijhalen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WAAROM DIT BESTAAT
 *
 * Gemeld op 14 aug: `pak-3-delig-double-breasted-ecru` staat actief op de site,
 * 240 stuks voorraad, en zonder énige foto — terwijl Shopify er elf heeft. De
 * beelden werden daar op 4 augustus geüpload; onze laatste catalogus-import liep
 * op 28 juli.
 *
 * Niets haalde die foto's daarna op. De nachtelijke cron `sync-catalog` draait
 * `lib/catalog-flags.ts`, en die LEEST alleen `product_images` om `has_image` te
 * berekenen. Beelden binnenhalen deed uitsluitend de handmatige import. Zet
 * iemand foto's in Shopify, dan blijven ze daar tot iemand aan een script denkt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SMAL GEHOUDEN
 *
 * Dit is expres géén tweede catalogus-import. Het raakt alleen `product_images`
 * en de `has_image`-vlag — geen titels, prijzen, statussen of metavelden. Een
 * losse job die stiekem ook productdata overschrijft is precies hoe je het
 * handmatig-slot uit lib/pim.ts weer ondermijnt.
 *
 * Beelden met `source = 'ai-packshot'` blijven staan tot er échte foto's zijn,
 * en wijken dan — zelfde regel als de import, zodat een product niet even
 * zonder beeld valt.
 */

/** Shopify laat er meer toe, maar twintig beelden per product is al royaal. */
const MAX_BEELDEN = 20;
/** `nodes(ids:)` accepteert 250; 50 houdt de querykosten ruim onder het quotum. */
const BATCH = 50;

export type MediaSyncResultaat = {
  bekeken: number;
  bijgewerkt: number;
  ongewijzigd: number;
  beeldenErbij: number;
  beeldenEraf: number;
  /** Producten die Shopify niet (meer) kent. */
  nietInShopify: number;
  /** Producten die bij Shopify ook geen beeld hebben. */
  ookDaarGeenBeeld: number;
  voorbeelden: { handle: string; van: number; naar: number }[];
};

type Doel = { id: string; handle: string; shopifyId: string };

const leeg = (): MediaSyncResultaat => ({
  bekeken: 0,
  bijgewerkt: 0,
  ongewijzigd: 0,
  beeldenErbij: 0,
  beeldenEraf: 0,
  nietInShopify: 0,
  ookDaarGeenBeeld: 0,
  voorbeelden: [],
});

/**
 * Welke producten we gaan nakijken.
 *
 * `sinds` vraagt het aan Shopify ("wat is daar gewijzigd") en vangt dus ook
 * artikelen die bij ons al beeld hebben maar waar een foto is bijgekomen.
 * `alleenZonderBeeld` vraagt het aan onszelf en is de opruimactie voor de
 * achterstand. Zonder allebei: de hele levende catalogus.
 */
async function bepaalDoelen(opties: {
  handles?: string[];
  alleenZonderBeeld?: boolean;
  sinds?: Date;
  limiet?: number;
}): Promise<Doel[]> {
  const db = getDb();
  /* Lijsten als expliciete IN-opsomming, niet als `= any($1)`: een JS-array
     komt via neon-http als één losse waarde binnen en dan matcht de query op
     niets — zonder foutmelding die dat zegt. */
  const inLijst = (waarden: string[]) => sql.join(waarden.map((w) => sql`${w}`), sql`, `);

  const conds = [sql`p.status <> 'archived'`, sql`p.shopify_product_id is not null`];
  if (opties.handles?.length) conds.push(sql`p.handle in (${inLijst(opties.handles)})`);
  if (opties.alleenZonderBeeld) {
    conds.push(sql`not exists (select 1 from product_images i where i.product_id = p.id and i.source = '')`);
  }
  const limiet = Math.min(Math.max(opties.limiet ?? 5000, 1), 20000);

  if (opties.sinds) {
    /* Andersom: eerst Shopify vragen wat er veranderde, dan die id's bij ons
       opzoeken. Zo mis je geen artikel dat bij ons al beeld heeft. */
    const ids = await shopifyGewijzigdeProducten(opties.sinds, limiet);
    if (!ids.length) return [];
    conds.push(sql`p.shopify_product_id in (${inLijst(ids)})`);
  }

  const rows = await db.execute<{ id: string; handle: string; shopify_product_id: string }>(sql`
    select p.id, p.handle, p.shopify_product_id
    from products p where ${sql.join(conds, sql` and `)}
    order by p.stock_qty desc
    limit ${limiet}`);
  return rows.rows.map((r) => ({ id: r.id, handle: r.handle, shopifyId: r.shopify_product_id }));
}

/** De Shopify-product-id's die sinds `sinds` gewijzigd zijn. */
async function shopifyGewijzigdeProducten(sinds: Date, limiet: number): Promise<string[]> {
  const q = `updated_at:>'${sinds.toISOString()}'`;
  const ids: string[] = [];
  let cursor: string | null = null;
  while (ids.length < limiet) {
    const d = await shopifyGraphql(
      `query($cursor:String,$q:String!){ products(first:100, after:$cursor, query:$q){
         pageInfo{ hasNextPage endCursor } nodes{ id } } }`,
      { cursor, q },
    );
    const nodes = d?.products?.nodes ?? [];
    for (const n of nodes) if (n?.id) ids.push(n.id);
    if (!d?.products?.pageInfo?.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return ids;
}

/**
 * Haalt en schrijft de beelden. Vergelijkt eerst: is de lijst identiek, dan
 * raken we de rijen niet aan. Dat scheelt niet alleen schrijfwerk — een
 * delete-plus-insert bij elke run laat `product_images.id` en daarmee elke
 * verwijzing naar een beeld dagelijks verspringen.
 */
export async function synchroniseerProductMedia(
  opties: {
    handles?: string[];
    alleenZonderBeeld?: boolean;
    sinds?: Date;
    limiet?: number;
    droogdraaien?: boolean;
  } = {},
): Promise<MediaSyncResultaat | { error: string }> {
  if (!shopifyGeconfigureerd()) {
    return { error: "SHOPIFY_SHOP_DOMAIN en/of SHOPIFY_ADMIN_ACCESS_TOKEN ontbreken." };
  }

  let doelen: Doel[];
  try {
    doelen = await bepaalDoelen(opties);
  } catch (e) {
    return { error: `Shopify bevragen mislukt: ${(e as Error).message}` };
  }
  const uit = leeg();
  if (!doelen.length) return uit;

  const db = getDb();
  const opId = new Map(doelen.map((d) => [d.shopifyId, d]));

  /* Wat wij nu hebben, per product — alleen de gesyncte beelden. */
  const huidig = new Map<string, { url: string; alt: string }[]>();
  for (const blok of chunk(doelen.map((d) => d.id), 500)) {
    const rows = await db
      .select({ productId: productImages.productId, url: productImages.url, alt: productImages.alt })
      .from(productImages)
      .where(and(inArray(productImages.productId, blok), eq(productImages.source, "")))
      .orderBy(productImages.position);
    for (const r of rows) {
      const lijst = huidig.get(r.productId) ?? [];
      lijst.push({ url: r.url, alt: r.alt });
      huidig.set(r.productId, lijst);
    }
  }

  for (const blok of chunk(doelen, BATCH)) {
    let d: { nodes: unknown[] };
    try {
      d = await shopifyGraphql(
        `query($ids:[ID!]!){ nodes(ids:$ids){ ... on Product { id
           images(first:${MAX_BEELDEN}){ nodes{ url altText } } } } }`,
        { ids: blok.map((b) => b.shopifyId) },
      );
    } catch (e) {
      return { error: `Shopify bevragen mislukt: ${(e as Error).message}` };
    }

    for (const n of (d?.nodes ?? []) as ({ id: string; images?: { nodes: { url: string; altText: string | null }[] } } | null)[]) {
      if (!n) {
        uit.nietInShopify += 1;
        uit.bekeken += 1;
        continue;
      }
      const doel = opId.get(n.id);
      if (!doel) continue;
      uit.bekeken += 1;

      /* Opslaan mét de ?v= zoals Shopify 'm geeft — alle 5.308 bestaande rijen
         staan zo, en meerdere lezers doen zelf split_part(url,'?',1). Vergelijken
         doen we ZONDER, want die parameter verandert bij elke herverwerking
         zonder dat het beeld anders wordt. Vergeleken mét ?v= lijkt elk product
         gewijzigd en herschrijft deze job elke nacht de hele catalogus. */
      const nieuw = (n.images?.nodes ?? [])
        .filter((i) => i?.url)
        .map((i) => ({ url: i.url, alt: i.altText || "" }));

      if (!nieuw.length) {
        uit.ookDaarGeenBeeld += 1;
        uit.ongewijzigd += 1;
        continue;
      }

      const oud = huidig.get(doel.id) ?? [];
      if (gelijk(oud, nieuw)) {
        uit.ongewijzigd += 1;
        continue;
      }

      uit.bijgewerkt += 1;
      uit.beeldenErbij += Math.max(0, nieuw.length - oud.length);
      uit.beeldenEraf += Math.max(0, oud.length - nieuw.length);
      if (uit.voorbeelden.length < 15) uit.voorbeelden.push({ handle: doel.handle, van: oud.length, naar: nieuw.length });

      if (opties.droogdraaien) continue;

      /* Per product vervangen, niet in bulk vooraf wissen: valt de job halverwege
         om, dan staat er hooguit één artikel even zonder beeld in plaats van
         honderden. */
      await db.delete(productImages).where(and(eq(productImages.productId, doel.id), eq(productImages.source, "")));
      await db.insert(productImages).values(
        nieuw.map((i, k) => ({ productId: doel.id, url: i.url, alt: i.alt, position: k })),
      );
      /* Echte foto's winnen van een AI-packshot — zelfde regel als de import. */
      await db.delete(productImages).where(and(eq(productImages.productId, doel.id), eq(productImages.source, "ai-packshot")));
      await db
        .update(products)
        .set({ hasImage: true, updatedAt: sql`now()` })
        .where(eq(products.id, doel.id));
    }
  }

  return uit;
}

/** Zelfde beelden in dezelfde volgorde, met dezelfde alt-tekst — ?v= telt niet mee. */
function gelijk(a: { url: string; alt: string }[], b: { url: string; alt: string }[]): boolean {
  if (a.length !== b.length) return false;
  const kaal = (u: string) => u.split("?")[0];
  return a.every((x, i) => kaal(x.url) === kaal(b[i].url) && x.alt === b[i].alt);
}

function chunk<T>(lijst: T[], n: number): T[][] {
  const uit: T[][] = [];
  for (let i = 0; i < lijst.length; i += n) uit.push(lijst.slice(i, i + n));
  return uit;
}
