import { sql } from "drizzle-orm";

/**
 * Bron van waarheid voor "de nieuwe collectie": de échte webshop-collectie
 * **New arrivals** (`/collections/nieuwe-collectie-gents`) — niet een heuristiek
 * op een 'new'-attribuut of leeftijd. Zo genereren de beeld-generators precies
 * de producten die op de New arrivals-PLP staan.
 *
 * De SQL-conditie verwacht dat de products-tabel als `p` gealiast is (zoals in
 * alle generators en de studio-API). Composeerbaar in een grotere `sql`-query.
 */
export const NEW_COLLECTION_HANDLE = "nieuwe-collectie-gents";

export const newCollectionCond = sql`exists (
  select 1 from product_collections pc
  join collections c on c.id = pc.collection_id
  where pc.product_id = p.id and c.handle = ${NEW_COLLECTION_HANDLE}
)`;
