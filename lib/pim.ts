import { sql, type SQL } from "drizzle-orm";
import { getDb } from "@/db";
import { setProductContentOverride } from "@/lib/product-content";
import { setSeoOverride, getSeoOverride } from "@/lib/seo-overrides";
import {
  PIM_VELDEN,
  PIM_LAGEN,
  PIM_CHECK_META,
  PIM_MAX_SCORE,
  valideerVeld,
  veldVoor,
  veldLabel,
  metaSlotSleutel,
} from "@/lib/pim-regels";

/**
 * De PIM-kern: welke productvelden een mens mag zetten, hoe die bewerking de
 * SRS-import overleeft, en hoe compleet een artikel is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WAAROM DIT BESTAND BESTAAT
 *
 * De catalogus komt uit SRS en de import doet een blinde upsert: title,
 * description_html, vendor, product_type, status, seo_* en attributes werden
 * onvoorwaardelijk overschreven met wat de feed zei. De kolom
 * `products.handmatige_velden` was daar het antwoord op — maar die werd nergens
 * gelezen. Het slot zat op de deur, er zat alleen geen schoot in.
 *
 * Dat is niet theoretisch: het is precies hoe de onzin-omschrijvingen destijds
 * terugkwamen na een her-import. Dus: bewerken en beschermen horen bij elkaar.
 * Wie hier een veld zet, zet het slot er automatisch op (`vergrendelBijBewerken`),
 * en lib/catalog-import.ts slaat vergrendelde velden over.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWEE LAGEN, EN WAAROM DAT ZO BLIJFT
 *
 * Niet alles wat de bezoeker leest staat in `products`. De PDP leest:
 *   - omschrijving  → app_settings `pcontent:<handle>` (override) vóór products
 *   - SEO-titel/-omschrijving → app_settings `seoOverrides` vóór products
 *
 * Die override-laag bestond al (AI-productteksten) en is per constructie
 * import-vast. Het PIM schrijft voor die drie velden dus naar de override —
 * anders bewerk je iets wat de site niet toont. De rest (titel, merk, type,
 * status, kleurlabel, metavelden) heeft geen override-laag: daar ís het
 * productrecord de waarheid, en daar doet het slot het werk.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ALIAS-AFSPRAAK. Alle SQL-fragmenten hieronder gaan uit van `products p`.
 * Elke query die ze gebruikt moet die alias aanhouden.
 */

/* ══════════════════════════════════════════════════════════════════════════
   1. Bewerkbare velden — definities komen uit lib/pim-regels.js
   ══════════════════════════════════════════════════════════════════════════ */

export { PIM_VELDEN, PIM_LAGEN, PIM_MAX_SCORE, veldLabel, valideerVeld, scoreUit } from "@/lib/pim-regels";

export type PimLaagSleutel = "descriptionHtml" | "seoTitle" | "seoDescription";

/* ══════════════════════════════════════════════════════════════════════════
   2. Compleetheid
   ══════════════════════════════════════════════════════════════════════════ */

export type PimCheck = {
  sleutel: string;
  label: string;
  /** Zwaarte in de score. 3 = het artikel functioneert niet zonder, 1 = verrijking. */
  gewicht: number;
  uitleg: string;
  /** Booleaanse expressie over `products p`. */
  conditie: SQL;
};

/**
 * De SQL achter elke check uit PIM_CHECK_META, op dezelfde sleutel.
 *
 * Waar een artikel aan moet voldoen om "af" te zijn is een DATA-meting, geen
 * voorraadmeting: of er vandaag toevallig niets op voorraad ligt zegt niets over
 * de kwaliteit van de productgegevens, en zou de score elke ochtend laten
 * schommelen zonder dat iemand iets deed.
 *
 * De condities lezen de EFFECTIEVE waarde (override vóór bron) — hetzelfde als
 * wat de bezoeker ziet. Anders meldt het overzicht "SEO ontbreekt" terwijl de
 * pagina een prima meta-titel toont.
 *
 * Splitsing meta/SQL is bewust: de labels en gewichten staan in een JS-bestand
 * zodat `node --test` erbij kan, de SQL hier omdat drizzle niet in dat testpad
 * past. test/pim-regels.test.js bewaakt dat de twee lijsten gelijk blijven.
 */
const PIM_CHECK_SQL: Record<string, SQL> = {
  foto: sql`p.has_image`,
  sku: sql`exists (select 1 from product_variants v where v.product_id = p.id and v.sku <> '')`,
  prijs: sql`exists (select 1 from product_variants v where v.product_id = p.id and v.price_cents > 0)`,
  omschrijving: sql`length(regexp_replace(${effectieveOmschrijvingSql()}, '<[^>]*>', '', 'g')) >= 120`,
  seoTitel: sql`${effectieveSeoSql("title")} <> ''`,
  seoOmschrijving: sql`${effectieveSeoSql("description")} <> ''`,
  merk: sql`coalesce(nullif(p.vendor, ''), nullif(p.attributes ->> 'merk', ''), '') <> ''`,
  categorie: sql`coalesce(nullif(p.product_type, ''), nullif(p.attributes ->> 'hoofdgroep_omschrijving', ''), '') <> ''`,
  materiaal: sql`coalesce(nullif(p.attributes ->> 'materiaal', ''), nullif(p.attributes ->> 'samenstelling_materiaal', ''), nullif(p.attributes ->> 'samenstelling', ''), '') <> ''`,
  pasvorm: sql`coalesce(p.attributes ->> 'pasvorm', '') <> ''`,
  kleur: sql`p.variant_color_label <> ''`,
  modelbeeld: sql`p.model_image_url <> ''`,
};

/** Meta + SQL, in de volgorde van PIM_CHECK_META. */
export const PIM_CHECKS: PimCheck[] = PIM_CHECK_META.map((c) => {
  const conditie = PIM_CHECK_SQL[c.sleutel];
  if (!conditie) throw new Error(`PIM: check "${c.sleutel}" heeft geen SQL-conditie.`);
  return { ...c, conditie };
});

/** De effectieve omschrijving: de override wint, anders de brontekst. */
function effectieveOmschrijvingSql(): SQL {
  return sql`coalesce(
    nullif((select s.data ->> 'descriptionHtml' from app_settings s where s.id = 'pcontent:' || p.handle), ''),
    nullif(p.description_html, ''),
    ''
  )`;
}

/** De effectieve SEO-waarde: de override-map wint, anders de kolom op products. */
function effectieveSeoSql(sleutel: "title" | "description"): SQL {
  const kolom = sleutel === "title" ? sql`p.seo_title` : sql`p.seo_description`;
  return sql`coalesce(
    nullif((select s.data -> ('/products/' || p.handle) ->> ${sleutel} from app_settings s where s.id = 'seoOverrides'), ''),
    nullif(${kolom}, ''),
    ''
  )`;
}

/**
 * Score 0-100 over `products p`. Gebruik dit fragment overal waar een score
 * getoond, gesorteerd of gefilterd wordt — één definitie, anders vertelt de
 * lijst een ander verhaal dan het detailscherm.
 */
export function compleetheidScoreSql(): SQL {
  const delen = PIM_CHECKS.map((c) => sql`(case when ${c.conditie} then ${c.gewicht} else 0 end)`);
  return sql`round(100.0 * (${sql.join(delen, sql` + `)}) / ${PIM_MAX_SCORE})::int`;
}

/** Per check een boolean, als jsonb — voor het detailscherm ("wat mist er nog"). */
export function compleetheidChecksSql(): SQL {
  const paren = PIM_CHECKS.map((c) => sql`${c.sleutel}, (${c.conditie})`);
  return sql`jsonb_build_object(${sql.join(paren, sql`, `)})`;
}

/** De checks zonder SQL — voor de portal, die alleen labels en gewichten nodig heeft. */
export function pimCheckLabels() {
  return PIM_CHECKS.map(({ sleutel, label, gewicht, uitleg }) => ({ sleutel, label, gewicht, uitleg }));
}

/* ══════════════════════════════════════════════════════════════════════════
   3. Opslaan
   ══════════════════════════════════════════════════════════════════════════ */

export type PimPatch = {
  /** Kolommen op products, sleutel uit PIM_VELDEN. */
  velden?: Record<string, string>;
  /** Metavelden (attributes). Lege waarde = sleutel verwijderen → weer de bron volgen. */
  metavelden?: Record<string, string>;
  /** Override-laag: omschrijving en SEO. Leeg = override weg, terug naar de bron. */
  lagen?: Partial<Record<PimLaagSleutel, string>>;
  /** Expliciet slot zetten of weghalen, los van een bewerking. */
  slot?: Record<string, boolean>;
};

export type PimOpslagResultaat = {
  ok: boolean;
  error?: string;
  gewijzigd: number;
  /** Velden die nu vergrendeld zijn. */
  handmatig: string[];
};

const kap = (v: unknown, n: number) => String(v ?? "").slice(0, n);

/** Logboek-waarden mogen lang zijn, maar geen 8kB omschrijving in tweevoud. */
const LOG_MAX = 2000;

type ProductRij = {
  id: string;
  handle: string;
  attributes: Record<string, unknown> | null;
  handmatige_velden: unknown;
  [k: string]: unknown;
};

/**
 * Eén artikel opslaan. Bewerken vergrendelt automatisch: wie hier een veld zet
 * bedoelt dat het zo blijft staan, ook na de volgende SRS-import. Ontgrendelen
 * kan expliciet via `slot`.
 *
 * Schrijft per gewijzigd veld één logboekregel. Geeft `gewijzigd: 0` als er
 * niets veranderd is — dan is er ook niets gelogd (anders staat het logboek vol
 * met "opgeslagen, niets veranderd").
 */
export async function slaProductOp(handle: string, patch: PimPatch, actor: string): Promise<PimOpslagResultaat> {
  const db = getDb();
  const huidig = (
    await db.execute<ProductRij>(sql`
      select id, handle, title, vendor, product_type, status, variant_color_label,
             description_html, seo_title, seo_description, attributes, handmatige_velden
      from products where handle = ${handle} limit 1`)
  ).rows[0];
  if (!huidig) return { ok: false, error: "Product niet gevonden.", gewijzigd: 0, handmatig: [] };

  const slot = new Set(
    Array.isArray(huidig.handmatige_velden) ? (huidig.handmatige_velden as unknown[]).map(String) : [],
  );
  const attrs = { ...((huidig.attributes || {}) as Record<string, unknown>) };
  const log: { veld: string; actie: string; oud: string; nieuw: string }[] = [];
  const setDelen: SQL[] = [];

  /* ── Kolommen op products ─────────────────────────────────────────────── */
  for (const [sleutel, ruw] of Object.entries(patch.velden || {})) {
    const controle = valideerVeld(sleutel, ruw);
    if (!controle.ok) return { ok: false, error: controle.error, gewijzigd: 0, handmatig: [...slot] };
    const veld = veldVoor(sleutel)!;
    const nieuw = controle.waarde;
    const oud = String(huidig[veld.kolom] ?? "");
    if (oud === nieuw) continue;
    setDelen.push(sql`${sql.identifier(veld.kolom)} = ${nieuw}`);
    slot.add(veld.sleutel);
    log.push({ veld: veld.sleutel, actie: "bewerkt", oud, nieuw });
  }

  /* ── Metavelden (attributes) ──────────────────────────────────────────── */
  let attrsGewijzigd = false;
  for (const [ruweSleutel, ruw] of Object.entries(patch.metavelden || {})) {
    const sleutel = String(ruweSleutel).trim().slice(0, 120);
    if (!sleutel) continue;
    const nieuw = kap(ruw, 2000).trim();
    const oud = String(attrs[sleutel] ?? "");
    if (oud === nieuw) continue;
    if (nieuw) attrs[sleutel] = nieuw;
    else delete attrs[sleutel];
    attrsGewijzigd = true;
    slot.add(metaSlotSleutel(sleutel));
    log.push({ veld: metaSlotSleutel(sleutel), actie: "bewerkt", oud, nieuw });
  }
  if (attrsGewijzigd) setDelen.push(sql`attributes = ${JSON.stringify(attrs)}::jsonb`);

  /* ── Override-laag: dit is wat de bezoeker leest ──────────────────────── */
  const lagen = patch.lagen || {};
  if (lagen.descriptionHtml !== undefined) {
    const nieuw = kap(lagen.descriptionHtml, 8000);
    const oud = String(
      (
        await db.execute<{ v: string }>(
          sql`select coalesce(data ->> 'descriptionHtml', '') v from app_settings where id = ${`pcontent:${handle}`}`,
        )
      ).rows[0]?.v ?? "",
    );
    if (oud !== nieuw) {
      await setProductContentOverride(handle, { descriptionHtml: nieuw });
      log.push({ veld: "override:descriptionHtml", actie: "bewerkt", oud, nieuw });
    }
  }
  if (lagen.seoTitle !== undefined || lagen.seoDescription !== undefined) {
    const bestaand = await getSeoOverride(`/products/${handle}`);
    const patchSeo: { title?: string; description?: string } = {};
    if (lagen.seoTitle !== undefined) {
      const nieuw = kap(lagen.seoTitle, 200).trim();
      const oud = String(bestaand?.title || "");
      if (oud !== nieuw) {
        patchSeo.title = nieuw;
        log.push({ veld: "seo:title", actie: "bewerkt", oud, nieuw });
      }
    }
    if (lagen.seoDescription !== undefined) {
      const nieuw = kap(lagen.seoDescription, 320).trim();
      const oud = String(bestaand?.description || "");
      if (oud !== nieuw) {
        patchSeo.description = nieuw;
        log.push({ veld: "seo:description", actie: "bewerkt", oud, nieuw });
      }
    }
    if (Object.keys(patchSeo).length) await setSeoOverride(`/products/${handle}`, patchSeo);
  }

  /* ── Expliciet slot ───────────────────────────────────────────────────── */
  for (const [veld, aan] of Object.entries(patch.slot || {})) {
    const geldig = !!veldVoor(veld) || veld.startsWith("attr:");
    if (!geldig) continue;
    if (aan && !slot.has(veld)) {
      slot.add(veld);
      log.push({ veld, actie: "vergrendeld", oud: "", nieuw: "" });
    } else if (!aan && slot.has(veld)) {
      slot.delete(veld);
      log.push({ veld, actie: "ontgrendeld", oud: "", nieuw: "" });
    }
  }

  /* ── Wegschrijven ─────────────────────────────────────────────────────── */
  const slotLijst = [...slot].sort();
  const slotWas = (Array.isArray(huidig.handmatige_velden) ? (huidig.handmatige_velden as unknown[]).map(String) : []).sort();
  const slotVeranderd = slotLijst.length !== slotWas.length || slotLijst.some((v, i) => v !== slotWas[i]);
  if (slotVeranderd) setDelen.push(sql`handmatige_velden = ${JSON.stringify(slotLijst)}::jsonb`);

  if (setDelen.length) {
    await db.execute(sql`
      update products set ${sql.join(setDelen, sql`, `)}, updated_at = now() where id = ${huidig.id}`);
  }
  if (log.length) await logWijzigingen(huidig.id, handle, log, actor);

  return { ok: true, gewijzigd: log.length, handmatig: slotLijst };
}

/* ══════════════════════════════════════════════════════════════════════════
   4. Bulk
   ══════════════════════════════════════════════════════════════════════════ */

export type PimBulkActie =
  | { soort: "veld"; sleutel: string; waarde: string }
  | { soort: "metaveld"; sleutel: string; waarde: string }
  | { soort: "ontgrendel"; sleutel: string };

/**
 * Dezelfde bewerking op meerdere artikelen. Loopt bewust per artikel via
 * slaProductOp: de validatie, het slot en het logboek zijn dan gegarandeerd
 * identiek aan een losse bewerking. Eén UPDATE ... WHERE handle IN (...) zou
 * sneller zijn en drie dingen stilletjes overslaan.
 *
 * Bovengrens van 500 handles per aanroep: daarboven loopt een serverless-functie
 * eerder in zijn tijdslimiet dan dat de gebruiker antwoord krijgt.
 */
export async function bulkBewerk(
  handles: string[],
  actie: PimBulkActie,
  actor: string,
): Promise<{ ok: boolean; error?: string; gelukt: number; mislukt: { handle: string; error: string }[] }> {
  const lijst = [...new Set(handles.map((h) => String(h || "").trim()).filter(Boolean))];
  if (!lijst.length) return { ok: false, error: "Geen artikelen geselecteerd.", gelukt: 0, mislukt: [] };
  if (lijst.length > 500) return { ok: false, error: "Maximaal 500 artikelen per keer.", gelukt: 0, mislukt: [] };

  let patch: PimPatch;
  if (actie.soort === "veld") {
    const veld = veldVoor(actie.sleutel);
    if (!veld) return { ok: false, error: `Onbekend veld: ${actie.sleutel}.`, gelukt: 0, mislukt: [] };
    if (!veld.bulk) {
      return { ok: false, error: `${veld.label} kan niet in bulk gezet worden — dat is per artikel.`, gelukt: 0, mislukt: [] };
    }
    patch = { velden: { [actie.sleutel]: actie.waarde } };
  } else if (actie.soort === "metaveld") {
    patch = { metavelden: { [actie.sleutel]: actie.waarde } };
  } else {
    patch = { slot: { [actie.sleutel]: false } };
  }

  let gelukt = 0;
  const mislukt: { handle: string; error: string }[] = [];
  for (const handle of lijst) {
    try {
      const r = await slaProductOp(handle, patch, actor);
      if (r.ok) gelukt += 1;
      else mislukt.push({ handle, error: r.error || "Opslaan mislukt." });
    } catch (e) {
      mislukt.push({ handle, error: (e as Error).message });
    }
  }
  return { ok: true, gelukt, mislukt };
}

/* ══════════════════════════════════════════════════════════════════════════
   5. Logboek
   ══════════════════════════════════════════════════════════════════════════ */

async function logWijzigingen(
  productId: string,
  handle: string,
  regels: { veld: string; actie: string; oud: string; nieuw: string }[],
  actor: string,
): Promise<void> {
  if (!regels.length) return;
  const db = getDb();
  const waarden = regels.map(
    (r) =>
      sql`(${productId}::uuid, ${handle}, ${r.veld}, ${r.actie}, ${kap(r.oud, LOG_MAX)}, ${kap(r.nieuw, LOG_MAX)}, ${kap(actor, 200)})`,
  );
  /* Het logboek mag een bewerking nooit terugdraaien: als deze insert faalt
     (tabel nog niet gemigreerd op deze omgeving) is de wijziging zelf al
     geschreven en is een 500 teruggeven misleidend. */
  try {
    await db.execute(sql`
      insert into product_wijzigingen (product_id, handle, veld, actie, oude_waarde, nieuwe_waarde, actor)
      values ${sql.join(waarden, sql`, `)}`);
  } catch {
    /* stil: zie hierboven */
  }
}

export type PimLogRegel = {
  veld: string;
  actie: string;
  oudeWaarde: string;
  nieuweWaarde: string;
  actor: string;
  wanneer: string;
};

/** De tijdlijn van één artikel, nieuwste eerst. */
export async function leesLogboek(handle: string, limiet = 50): Promise<PimLogRegel[]> {
  try {
    const db = getDb();
    const rows = await db.execute<{
      veld: string; actie: string; oude_waarde: string; nieuwe_waarde: string; actor: string; wanneer: string;
    }>(sql`
      select veld, actie, oude_waarde, nieuwe_waarde, actor,
             to_char(created_at, 'YYYY-MM-DD HH24:MI') wanneer
      from product_wijzigingen where handle = ${handle}
      order by created_at desc limit ${Math.min(200, Math.max(1, limiet))}`);
    return rows.rows.map((r) => ({
      veld: r.veld,
      actie: r.actie,
      oudeWaarde: r.oude_waarde || "",
      nieuweWaarde: r.nieuwe_waarde || "",
      actor: r.actor || "",
      wanneer: r.wanneer,
    }));
  } catch {
    /* Tabel nog niet gemigreerd — een leeg logboek is beter dan een kapot scherm. */
    return [];
  }
}
