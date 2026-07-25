import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { events } from "@/db/schema";
import { getMenu } from "@/lib/menu-server";

/**
 * Navigatie- en lijst-inzichten: wat DOET de klant met het menu, de filters en
 * de productlijsten — en wat zouden we daaraan moeten veranderen.
 *
 * De site meet dit sinds vandaag (nav_click / product_click / filter / sort /
 * size_click). Dit bestand vertaalt die ruwe events naar concrete adviezen:
 * menu-items die niemand aanklikt, filters die niemand gebruikt, posities in de
 * lijst waar juist wél geklikt wordt, en maten die klanten zoeken maar die
 * uitverkocht zijn (direct inkoopsignaal).
 *
 * Bewust GEEN automatische aanpassingen: bij dit verkeersvolume zou een
 * zelfsturend menu vooral ruis versterken. Eerst meten en tonen; pas ingrijpen
 * als een signaal over meerdere weken standhoudt.
 */

const since = (days: number) => sql`created_at > now() - (${days} || ' days')::interval`;

export type NavInsights = {
  days: number;
  /** Totaal aantal navigatie-kliks in de periode (0 = nog geen data). */
  totalNavClicks: number;
  menu: { label: string; href: string; clicks: number }[];
  footer: { label: string; clicks: number }[];
  tiles: { label: string; clicks: number }[];
  /** Menu-items die bestaan maar (bijna) nooit worden aangeklikt. */
  ongebruikteMenuItems: string[];
  filters: { facet: string; value: string; clicks: number }[];
  sorts: { value: string; clicks: number }[];
  /** Waar in de lijst wordt geklikt — hoge posities = de ranking werkt. */
  clickPositions: { bucket: string; clicks: number }[];
  /** Maten die klanten aanklikken terwijl ze uitverkocht zijn. */
  gemisteMaten: { handle: string; size: string; clicks: number }[];
  /** Zoekopdrachten zonder resultaat (kandidaten voor synoniemen/inkoop). */
  nulResultaten: { query: string; n: number }[];
};

export async function getNavInsights(days = 30): Promise<NavInsights> {
  const db = getDb();
  const q = <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) => db.execute<T>(s).then((r) => r.rows);

  const [nav, filters, sorts, positions, sizes, noResults, menuDoc] = await Promise.all([
    q<{ source: string; label: string; href: string; n: number }>(sql`
      select coalesce(props->>'source','') source, coalesce(props->>'label','') label,
             coalesce(props->>'href','') href, count(*)::int n
      from ${events} where type = 'nav_click' and ${since(days)}
      group by 1, 2, 3 order by n desc limit 60`),
    q<{ facet: string; value: string; n: number }>(sql`
      select coalesce(props->>'facet','') facet, coalesce(props->>'value','') value, count(*)::int n
      from ${events} where type = 'filter' and coalesce(props->>'on','true') <> 'false' and ${since(days)}
      group by 1, 2 order by n desc limit 25`),
    q<{ value: string; n: number }>(sql`
      select coalesce(props->>'value','') value, count(*)::int n
      from ${events} where type = 'sort' and ${since(days)} group by 1 order by n desc limit 10`),
    q<{ bucket: string; n: number }>(sql`
      select case
               when (props->>'position')::int <= 4 then '1-4 (bovenaan)'
               when (props->>'position')::int <= 12 then '5-12'
               when (props->>'position')::int <= 24 then '13-24'
               else '25+ (diep gescrold)'
             end bucket,
             count(*)::int n
      from ${events}
      where type = 'product_click' and props->>'position' ~ '^[0-9]+$' and ${since(days)}
      group by 1 order by min((props->>'position')::int)`),
    q<{ handle: string; size: string; n: number }>(sql`
      select handle, coalesce(props->>'size','') size, count(*)::int n
      from ${events}
      where type = 'size_click' and coalesce(props->>'inStock','false') = 'false' and ${since(days)}
      group by 1, 2 order by n desc limit 15`),
    q<{ query: string; n: number }>(sql`
      select query, count(*)::int n from ${events}
      where type = 'search_no_results' and query <> '' and ${since(days)}
      group by 1 order by n desc limit 15`),
    getMenu().catch(() => []),
  ]);

  const menu = nav.filter((r) => r.source === "menu").map((r) => ({ label: r.label, href: r.href, clicks: r.n }));
  const footer = nav.filter((r) => r.source === "footer").map((r) => ({ label: r.label, clicks: r.n }));
  const tiles = nav.filter((r) => r.source === "home_tile").map((r) => ({ label: r.label, clicks: r.n }));

  // Menu-items zonder enige klik: alleen zinvol als er überhaupt geklikt wordt.
  const geklikt = new Set(menu.map((m) => m.label.toLowerCase()));
  const alleLabels: string[] = [];
  for (const item of menuDoc) {
    alleLabels.push(item.label);
    for (const col of item.columns ?? []) for (const l of col.links) alleLabels.push(l.label);
  }
  const totalNavClicks = nav.reduce((n, r) => n + r.n, 0);
  const ongebruikteMenuItems = totalNavClicks >= 25
    ? [...new Set(alleLabels)].filter((l) => l && l !== "#" && !geklikt.has(l.toLowerCase())).slice(0, 20)
    : [];

  return {
    days,
    totalNavClicks,
    menu: menu.slice(0, 15),
    footer: footer.slice(0, 10),
    tiles: tiles.slice(0, 10),
    ongebruikteMenuItems,
    filters: filters.map((f) => ({ facet: f.facet, value: f.value, clicks: f.n })),
    sorts: sorts.map((s) => ({ value: s.value, clicks: s.n })),
    clickPositions: positions.map((p) => ({ bucket: p.bucket, clicks: p.n })),
    gemisteMaten: sizes.map((s) => ({ handle: s.handle, size: s.size, clicks: s.n })),
    nulResultaten: noResults.map((r) => ({ query: r.query, n: r.n })),
  };
}
