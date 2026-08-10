import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productVariants } from "@/db/schema";
import { colorFamily } from "@/lib/colors";
import { getSiteUrl } from "@/lib/site-url";
import { DEFAULT_LOCALE, localizedPath, type Locale } from "@/lib/i18n";

/**
 * Alternatieven voor een artikel dat NIET meer leverbaar is.
 *
 * Context: vóór een annulering zijn alle winkels al nagekeken — het artikel is
 * echt weg. De klant kreeg tot nu toe alleen geld terug; hier zoeken we 2-3
 * vergelijkbare artikelen die hij wél kan krijgen.
 *
 * Wat "vergelijkbaar" betekent, in volgorde van hardheid:
 *  - HARDE eisen: zelfde hoofdgroep (een pak vervang je niet door een das), NU
 *    op voorraad in zijn maat, met foto. Een suggestie die niet leverbaar is of
 *    geen beeld heeft, maakt de teleurstelling alleen maar groter.
 *  - ZACHTE voorkeuren, in deze volgorde: dezelfde subgroep (stijl), dezelfde
 *    kleurfamilie, en zo dicht mogelijk bij de prijs die hij al betaald had.
 *
 * Stijl wint van kleur omdat een stijlfout erger is dan een kleurafwijking: op
 * hoofdgroep alleen kreeg een klant die een gewoon wit overhemd ("Lange mouw")
 * bestelde smokinghemden voorgesteld — zelfde categorie, zelfde maat, zelfde
 * prijs, totaal andere gelegenheid. Het blijft een RANGSCHIKKING en geen filter:
 * bij kleine subgroepen (Jacquet, Gilet MM) is iets tonen beter dan niets.
 *
 * De prijsband is bewust ruim (60–160%): liever een net iets duurder pak tonen
 * dan een lege mail. Levert de strenge ronde te weinig op, dan versoepelen we
 * stapsgewijs (band eraf, dan de maat eraf) in plaats van niets te tonen.
 *
 * Verwant maar bewust apart: findInStockAlternative (lib/stock-notify) doet
 * hetzelfde voor "je maat is al 14 dagen niet terug", maar levert één handle
 * zonder foto/prijs. Deze functie levert wat een mailkaartje nodig heeft.
 */

export type AlternativeItem = {
  handle: string;
  title: string;
  imageUrl: string;
  imageAlt: string;
  minPriceCents: number;
  hasPriceRange: boolean;
};

/** Eén niet-leverbare orderregel, zoals hij in de order staat. */
export type CancelledLine = {
  productHandle: string;
  title?: string;
  size?: string | null;
  color?: string | null;
  unitPriceCents?: number | null;
};

const PRICE_MIN_FACTOR = 0.6;
const PRICE_MAX_FACTOR = 1.6;

/**
 * Link naar een alternatief die de doorklik meetelt (/api/r → 302 naar de PDP).
 * `src` scheidt de bronnen: "mail" (annuleringsmail) vs "bestelpagina".
 * Altijd absoluut, want dezelfde helper vult ook links in e-mail.
 */
export function alternativeUrl(opts: { handle: string; src: string; locale?: Locale }): string {
  const path = localizedPath(`/products/${opts.handle}`, opts.locale ?? DEFAULT_LOCALE);
  const q = new URLSearchParams({ to: path, ev: "alt_click", src: opts.src, h: opts.handle });
  return `${getSiteUrl()}/api/r?${q.toString()}`;
}

type Pass = {
  hoofdgroep: string;
  /** Stijl binnen de hoofdgroep (bv. "Lange mouw", "2-delig"); leeg = onbekend. */
  subgroep: string;
  excludeHandles: string[];
  size: string;
  colorFam: string;
  targetCents: number;
  /** Prijsband toepassen (strenge ronde) of loslaten (versoepelde ronde). */
  useBand: boolean;
  limit: number;
};

async function runPass(p: Pass): Promise<AlternativeItem[]> {
  const db = getDb();

  // Alleen varianten die ECHT te krijgen zijn; met maat als die bekend is.
  const sizeCond: SQL = p.size ? sql` and v.size = ${p.size}` : sql``;
  const excludeCond: SQL = p.excludeHandles.length
    ? sql` and p.handle not in (${sql.join(p.excludeHandles.map((h) => sql`${h}`), sql`, `)})`
    : sql``;
  const bandCond: SQL =
    p.useBand && p.targetCents > 0
      ? sql` and x.min_price between ${Math.round(p.targetCents * PRICE_MIN_FACTOR)} and ${Math.round(p.targetCents * PRICE_MAX_FACTOR)}`
      : sql``;
  // Zachte voorkeuren: eerst dezelfde stijl, dan dezelfde kleurfamilie, dan zo
  // dicht mogelijk bij de betaalde prijs. Ontbreekt een signaal, dan vervalt
  // alleen die sortering.
  const subOrder: SQL = p.subgroep ? sql`x.sub_match asc, ` : sql``;
  const colorOrder: SQL = p.colorFam ? sql`x.color_match asc, ` : sql``;
  const priceOrder: SQL = p.targetCents > 0 ? sql`abs(x.min_price - ${p.targetCents}) asc, ` : sql``;

  const rows = await db.execute<{
    handle: string;
    title: string;
    image_url: string;
    image_alt: string;
    min_price: number;
    max_price: number;
  }>(sql`
    select x.handle, x.title, x.image_url, x.image_alt, x.min_price, x.max_price
    from (
      select p.handle, p.title, p.stock_qty, p.source_created_at,
        coalesce((select pi.url from product_images pi where pi.product_id = p.id order by pi.position asc limit 1), '') image_url,
        coalesce((select pi.alt from product_images pi where pi.product_id = p.id order by pi.position asc limit 1), '') image_alt,
        (select min(pv.price_cents) from ${productVariants} pv where pv.product_id = p.id) min_price,
        (select max(pv.price_cents) from ${productVariants} pv where pv.product_id = p.id) max_price,
        (case when ${p.colorFam ? sql`exists (select 1 from ${productVariants} cv where cv.product_id = p.id and cv.color_family = ${p.colorFam})` : sql`false`} then 0 else 1 end) color_match,
        (case when p.attributes ->> 'subgroep' = ${p.subgroep} then 0 else 1 end) sub_match
      from ${products} p
      where p.status = 'active' and p.has_image = true and p.in_stock = true and p.is_group_primary = true
        and p.attributes ->> 'hoofdgroep_omschrijving' = ${p.hoofdgroep}${excludeCond}
        and exists (
          select 1 from ${productVariants} v
          where v.product_id = p.id and v.stock_qty > 0${sizeCond}
        )
    ) x
    where x.min_price > 0 and x.image_url <> ''${bandCond}
    order by ${subOrder}${colorOrder}${priceOrder}x.stock_qty desc nulls last, x.source_created_at desc nulls last
    limit ${p.limit}
  `);

  return rows.rows.map((r) => ({
    handle: r.handle,
    title: r.title,
    imageUrl: r.image_url,
    imageAlt: r.image_alt || r.title,
    minPriceCents: Number(r.min_price) || 0,
    hasPriceRange: Number(r.max_price) > Number(r.min_price),
  }));
}

/**
 * Zoekt maximaal `limit` alternatieven voor de geannuleerde regels.
 *
 * De "hoofdregel" (duurste geannuleerde regel) bepaalt categorie, maat, kleur en
 * prijsklasse: bij een niet compleet leverbaar pak wil de klant een ander pak in
 * maat 50 zien, niet een broek én een colbert los. Alle producten uit de order
 * zelf vallen af — die heeft hij al, of ze zijn net geannuleerd.
 *
 * Retourneert een lege lijst als er niets passends is; de aanroeper moet het
 * alternatieven-blok dan gewoon weglaten.
 */
export async function findAlternativesForCancelled(input: {
  cancelled: CancelledLine[];
  /** Alle handles in de order (ook de wél verzonden regels) — nooit voorstellen. */
  orderHandles?: string[];
  limit?: number;
}): Promise<AlternativeItem[]> {
  const limit = Math.max(1, Math.min(6, input.limit ?? 3));
  const cancelled = (input.cancelled || []).filter((l) => l && String(l.productHandle || "").trim());
  if (!cancelled.length) return [];

  // Hoofdregel = duurste geannuleerde regel (bij een pak: het pak zelf).
  const main = [...cancelled].sort((a, b) => (Number(b.unitPriceCents) || 0) - (Number(a.unitPriceCents) || 0))[0];
  const db = getDb();
  const orig = await db.execute<{ hg: string; sub: string }>(sql`
    select attributes ->> 'hoofdgroep_omschrijving' hg, coalesce(attributes ->> 'subgroep', '') sub
    from ${products} where handle = ${main.productHandle} limit 1
  `);
  const hoofdgroep = String(orig.rows[0]?.hg || "").trim();
  if (!hoofdgroep) return []; // zonder categorie is elke suggestie een gok
  const subgroep = String(orig.rows[0]?.sub || "").trim();

  const excludeHandles = [
    ...new Set(
      [...cancelled.map((l) => l.productHandle), ...(input.orderHandles || [])]
        .map((h) => String(h || "").trim())
        .filter(Boolean),
    ),
  ];
  const size = String(main.size || "").trim();
  const colorFam = main.color ? colorFamily(String(main.color)) : "";
  const targetCents = Math.max(0, Math.round(Number(main.unitPriceCents) || 0));

  // Strengste ronde eerst; alleen versoepelen als we nog niet genoeg hebben.
  const passes: Pass[] = [
    { hoofdgroep, subgroep, excludeHandles, size, colorFam, targetCents, useBand: true, limit },
    { hoofdgroep, subgroep, excludeHandles, size, colorFam, targetCents, useBand: false, limit },
    { hoofdgroep, subgroep, excludeHandles, size: "", colorFam, targetCents, useBand: false, limit },
  ];

  const out: AlternativeItem[] = [];
  const seen = new Set<string>();
  for (const pass of passes) {
    if (out.length >= limit) break;
    const found = await runPass({ ...pass, limit }).catch((e) => {
      console.error("[alternatives] zoekfout:", (e as Error).message);
      return [] as AlternativeItem[];
    });
    for (const item of found) {
      if (seen.has(item.handle)) continue;
      seen.add(item.handle);
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}
