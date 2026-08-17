/**
 * lib/punten-acties.ts
 *
 * Eigen puntenacties: "koop dit en krijg extra punten". Regels als DATA, niet als
 * code — je maakt ze in de portal aan en ze werken meteen, zonder release.
 *
 * Waarom geen SQL-tekst in de definitie (zoals bij doelgroepen): een vrij
 * queryveld in een kolom is een injectiedeur die vanzelf een keer opengaat. De
 * voorwaarden hieronder zijn een vaste, korte lijst die we zelf vertalen.
 *
 * WAT DIT NIET IS: een kortingsmotor. Een actie geeft PUNTEN, geen euro's van de
 * orderprijs af. Dat is bewust — punten kosten pas geld bij het inwisselen, en
 * dan alleen vanaf de drempel; een korting kost meteen marge.
 *
 * De rekenregels zelf staan in lib/punten-acties-regels.js, zodat `node --test`
 * erbij kan. Dit bestand levert de database- en instellingen-kant.
 *
 * Idempotentie: elke toekenning krijgt refType "punten_actie" en refId
 * "<orderId>:<slug>". Dezelfde order kan dus maar één keer per actie punten
 * opleveren, ook als de betaalwebhook twee keer langskomt.
 */
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { orderLines, productVariants, products } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { loopt, puntenVoorActie, schoneActies as schoonRegels } from "@/lib/punten-acties-regels";

/** Waar de actie op slaat. Leeg veld = die eis telt niet mee. */
export type ActieVoorwaarde = {
  /** Categorie zoals SRS 'm kent: attributes->>'hoofdgroep_omschrijving'. */
  hoofdgroepen?: string[];
  /** Losse artikelnummers (SKU = de SRS-barcode; de join-sleutel van de catalogus). */
  skus?: string[];
  /** Merk (products.vendor). */
  merken?: string[];
  /** Drempel op de MATCHENDE regels, niet op de hele order. */
  minBestedingCents?: number;
};

export type ActieBeloning =
  /** Eén vast bedrag aan punten als de order matcht. */
  | { soort: "vast"; punten: number }
  /** Extra punten per euro over de matchende regels — bovenop de spaarsnelheid. */
  | { soort: "per_euro"; puntenPerEuro: number }
  /** Punten per gekocht stuk dat matcht. */
  | { soort: "per_artikel"; punten: number };

export type PuntenActie = {
  /** Vast en uniek: dit belandt in het grootboek en mag daarna nooit meer wijzigen. */
  slug: string;
  naam: string;
  actief: boolean;
  /** yyyy-mm-dd, op de besteldatum getoetst. Leeg = geen begin/eind. */
  van?: string;
  tot?: string;
  voorwaarde: ActieVoorwaarde;
  beloning: ActieBeloning;
  /** Plafond per order (0 = geen). Vangt een vertypte 'per artikel'-actie af. */
  maxPerOrder: number;
};

export type ActieTreffer = { slug: string; naam: string; punten: number };

/** Portal-invoer saneren (doorgeefluik naar de regels-module). */
export function schoneActies(raw: unknown): PuntenActie[] {
  return schoonRegels(raw) as PuntenActie[];
}

export async function actieveActies(op: Date = new Date()): Promise<PuntenActie[]> {
  const alle = ((await getSettings()).puntenActies ?? []) as PuntenActie[];
  return alle.filter((a) => loopt(a, op));
}

type Regel = { sku: string; qty: number; bedragCents: number; hoofdgroep: string; merk: string };

/**
 * De orderregels mét hun catalogus-kenmerken. Joint op SKU en NIET op handle:
 * order_lines.product_handle stamt uit de Shopify-tijd en matcht vrijwel niets
 * (87 van 60.143 regels), terwijl de SKU er 31.454 raakt.
 */
async function regelsVanOrder(orderId: string): Promise<Regel[]> {
  const db = getDb();
  const rijen = await db
    .select({
      sku: orderLines.sku,
      qty: orderLines.quantity,
      prijs: orderLines.unitPriceCents,
      hoofdgroep: sql<string>`coalesce(${products.attributes}->>'hoofdgroep_omschrijving', '')`,
      merk: sql<string>`coalesce(${products.vendor}, '')`,
    })
    .from(orderLines)
    .leftJoin(productVariants, eq(productVariants.sku, orderLines.sku))
    .leftJoin(products, eq(products.id, productVariants.productId))
    .where(eq(orderLines.orderId, orderId));

  return rijen.map((r) => {
    const qty = Math.max(0, Number(r.qty) || 0);
    return {
      sku: String(r.sku || ""),
      qty,
      bedragCents: Math.max(0, Number(r.prijs) || 0) * qty,
      hoofdgroep: String(r.hoofdgroep || ""),
      merk: String(r.merk || ""),
    };
  });
}

/**
 * Alle actie-punten voor één order. Puur lezend — het bijschrijven gebeurt in
 * lib/loyalty-claim, zodat álle punten via dezelfde idempotente route lopen.
 */
export async function actiePuntenVoorOrder(orderId: string, besteldOp?: Date | null): Promise<ActieTreffer[]> {
  const oid = String(orderId || "").trim();
  if (!oid) return [];
  const acties = await actieveActies(besteldOp instanceof Date && !isNaN(besteldOp.getTime()) ? besteldOp : new Date());
  if (!acties.length) return [];

  const regels = await regelsVanOrder(oid);
  if (!regels.length) return [];

  const treffers: ActieTreffer[] = [];
  for (const a of acties) {
    const punten = puntenVoorActie(a, regels);
    if (punten > 0) treffers.push({ slug: a.slug, naam: a.naam, punten });
  }
  return treffers;
}
