import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { OP_WEBSITE_SQL } from "@/lib/catalog";

/**
 * Beeldstatus van de catalogus — welk product staat met wat voor foto online?
 *
 * Aanleiding (situatie eind juli 2026): honderden actieve producten met voorraad
 * hadden als énige beeld een door AI verzonnen packshot, en daarnaast stonden er
 * honderden helemaal zonder beeld — onvindbaar, want de winkel eist has_image.
 * Dit overzicht maakt de drie groepen zichtbaar met de voorraad die eraan hangt,
 * zodat de keuze (laten fotograferen, laten staan, of offline halen) op cijfers
 * rust in plaats van op gevoel. De cijfers komen live uit de database; wat er op
 * een bepaalde datum in Shopify stond, hoort in het gesprek en niet hier.
 */

export type BeeldGroep = "echt" | "ai" | "geen";

export type BeeldStatusRegel = {
  handle: string;
  title: string;
  hoofdgroep: string;
  stockQty: number;
  groep: BeeldGroep;
  /** Staat het product nu daadwerkelijk op de website? */
  opWebsite: boolean;
};

export type BeeldStatus = {
  totalen: Record<BeeldGroep, { producten: number; stuks: number }>;
  /** Per hoofdgroep hoeveel artikelen alleen een AI-beeld hebben. */
  aiPerHoofdgroep: { hoofdgroep: string; producten: number; stuks: number }[];
  /** De AI-only artikelen, meeste voorraad eerst — daar is fotograferen het meest waard. */
  aiRegels: BeeldStatusRegel[];
  /** Artikelen zonder enig beeld, meeste voorraad eerst. */
  geenRegels: BeeldStatusRegel[];
};

/**
 * De groepsindeling, één keer gedefinieerd en door alle queries hieronder
 * gedeeld — zodat de tellingen en de lijsten niet uiteen kúnnen lopen:
 *   echt = minstens één geïmporteerde productfoto (source leeg)
 *   ai   = alleen beeld met source 'ai-packshot'
 *   geen = helemaal geen product_images-rij
 */
const BASIS = sql`
  select p.handle, p.title,
    p.attributes->>'hoofdgroep_omschrijving' hoofdgroep,
    p.stock_qty,
    case
      when exists (select 1 from product_images i where i.product_id = p.id and coalesce(i.source,'') = '') then 'echt'
      when exists (select 1 from product_images i where i.product_id = p.id and i.source = 'ai-packshot') then 'ai'
      else 'geen'
    end as groep,
    (${sql.raw(OP_WEBSITE_SQL)}) op_website
  from products p
  where p.status = 'active'`;

type TotaalRij = { groep: BeeldGroep; producten: number; stuks: number };
type HgRij = { hoofdgroep: string | null; producten: number; stuks: number };
type LijstRij = { handle: string; title: string | null; hoofdgroep: string | null; stock_qty: number | null; groep: BeeldGroep; op_website: boolean };

function naarRegel(r: LijstRij): BeeldStatusRegel {
  return {
    handle: r.handle,
    title: (r.title || "").trim() || r.handle,
    hoofdgroep: (r.hoofdgroep || "").trim() || "Overig",
    stockQty: Number(r.stock_qty) || 0,
    groep: r.groep,
    opWebsite: Boolean(r.op_website),
  };
}

/**
 * Aggregatie in de database, niet in JS: de pagina is force-dynamic, dus dit
 * draait bij elk bezoek. De hele actieve catalogus naar Node streamen om drie
 * tellers en twee top-100-lijsten te berekenen was onnodig werk per pageview.
 */
export async function getBeeldStatus(limiet = 100): Promise<BeeldStatus> {
  const db = getDb();
  const [totalenQ, perHgQ, aiQ, geenQ] = await Promise.all([
    db.execute<TotaalRij>(sql`
      with basis as (${BASIS})
      select groep, count(*)::int producten, coalesce(sum(stock_qty), 0)::int stuks
      from basis group by groep`),
    db.execute<HgRij>(sql`
      with basis as (${BASIS})
      select hoofdgroep, count(*)::int producten, coalesce(sum(stock_qty), 0)::int stuks
      from basis where groep = 'ai' group by hoofdgroep`),
    db.execute<LijstRij>(sql`
      with basis as (${BASIS})
      select * from basis where groep = 'ai'
      order by stock_qty desc nulls last, title limit ${limiet}`),
    db.execute<LijstRij>(sql`
      with basis as (${BASIS})
      select * from basis where groep = 'geen'
      order by stock_qty desc nulls last, title limit ${limiet}`),
  ]);

  const leeg = () => ({ producten: 0, stuks: 0 });
  const totalen: Record<BeeldGroep, { producten: number; stuks: number }> = { echt: leeg(), ai: leeg(), geen: leeg() };
  for (const r of totalenQ.rows) {
    totalen[r.groep] = { producten: Number(r.producten) || 0, stuks: Number(r.stuks) || 0 };
  }

  const aiPerHoofdgroep = perHgQ.rows
    .map((r) => ({ hoofdgroep: (r.hoofdgroep || "").trim() || "Overig", producten: Number(r.producten) || 0, stuks: Number(r.stuks) || 0 }))
    .sort((a, b) => b.producten - a.producten || a.hoofdgroep.localeCompare(b.hoofdgroep, "nl"));

  return {
    totalen,
    aiPerHoofdgroep,
    aiRegels: aiQ.rows.map(naarRegel),
    geenRegels: geenQ.rows.map(naarRegel),
  };
}
